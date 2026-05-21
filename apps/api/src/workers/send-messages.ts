import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { createEvolutionClient } from '../integrations/evolution.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { CampaignStatus, MessageDeliveryStatus, LeadStatus } from '@prisma/client';

export interface SendMessagesPayload extends BaseJobPayload {
  conversation_id: string;
  message_id: string;
}

export interface SendMessagesResult {
  sent: boolean;
  postponed: boolean;
  reason?: string;
}

export function getAquecimentoLimit(day: number): number {
  if (day <= 2) return 5;
  if (day <= 5) return 15;
  if (day <= 7) return 20;
  if (day <= 10) return 30;
  if (day <= 14) return 50;
  if (day <= 18) return 70;
  if (day <= 21) return 100;
  if (day <= 25) return 130;
  if (day <= 28) return 160;
  if (day <= 30) return 200;
  return 200; // Cap regime
}

export function getNextWindowStart(now = new Date()): Date {
  const date = new Date(now.getTime());
  const day = date.getDay();
  const hour = date.getHours();

  // 1. Sunday -> Next Monday 9:00 AM
  if (day === 0) {
    date.setDate(date.getDate() + 1);
    date.setHours(9, Math.floor(Math.random() * 30), 0, 0);
    return date;
  }

  // 2. Saturday after 12:00 PM -> Next Monday 9:00 AM
  if (day === 6 && hour >= 12) {
    date.setDate(date.getDate() + 2);
    date.setHours(9, Math.floor(Math.random() * 30), 0, 0);
    return date;
  }

  // 3. Weekday after 6:00 PM -> Next Day 9:00 AM (if next day is Sunday, jump to Monday)
  if (hour >= 18) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() === 0) {
      date.setDate(date.getDate() + 1);
    }
    date.setHours(9, Math.floor(Math.random() * 30), 0, 0);
    return date;
  }

  // 4. Weekday before 9:00 AM -> Today 9:00 AM
  if (hour < 9) {
    date.setHours(9, Math.floor(Math.random() * 30), 0, 0);
    return date;
  }

  // Default fallback: now + 30 mins
  return new Date(now.getTime() + 30 * 60 * 1000);
}

export class SendMessagesWorker extends BaseWorker<SendMessagesPayload, SendMessagesResult> {
  name = 'send-messages';
  concurrency = 1; // 1 concurrency per tenant enforces strict sequential ordering

  async process(job: Job<SendMessagesPayload>): Promise<SendMessagesResult> {
    const { tenant_id, conversation_id, message_id } = job.data;

    // 1. Fetch message and conversation
    const message = await prisma.message.findUnique({
      where: { id: message_id },
      include: { conversation: { include: { lead: true } } },
    });

    if (!message || message.tenantId !== tenant_id) {
      throw new Error(`Message ${message_id} not found or tenant mismatch`);
    }

    const { conversation } = message;
    const { lead } = conversation;

    // Check opt-out status first
    const isOptedOut = await prisma.optout.findFirst({
      where: { tenantId: tenant_id, whatsapp: lead.whatsapp },
    });

    if (isOptedOut || lead.status === LeadStatus.OPTED_OUT) {
      logger.warn({ tenant_id, lead_id: lead.id }, '🚫 Lead is opted out. Cancelling send job.');
      await prisma.message.update({
        where: { id: message_id },
        data: {
          deliveryStatus: MessageDeliveryStatus.FAILED,
          failedReason: 'lead_opted_out',
        },
      });
      return { sent: false, postponed: false, reason: 'lead_opted_out' };
    }

    // 2. Fetch Tenant and Secrets
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenant_id },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${tenant_id}`);
    }

    const decryptedSecrets = await getDecryptedSecrets(tenant_id);
    const secretRecord = await prisma.tenantSecret.findUnique({
      where: { tenantId: tenant_id },
    });

    if (!decryptedSecrets?.evolutionApiKey || !secretRecord?.evolutionInstanceName || !secretRecord?.evolutionBaseUrl) {
      logger.error({ tenant_id }, '❌ Evolution API secrets not configured properly for tenant');
      await prisma.message.update({
        where: { id: message_id },
        data: {
          deliveryStatus: MessageDeliveryStatus.FAILED,
          failedReason: 'evolution_secrets_unconfigured',
        },
      });
      return { sent: false, postponed: false, reason: 'secrets_missing' };
    }

    // 3. Validation: canSendMessage check (Warmup, off-hours, jitter)
    const evolutionClient = createEvolutionClient();
    const connStateResult = await evolutionClient.getConnectionState({
      instance: secretRecord.evolutionInstanceName,
      apiKey: decryptedSecrets.evolutionApiKey,
      baseUrl: secretRecord.evolutionBaseUrl,
    });

    if (!connStateResult.ok) {
      logger.warn({ tenant_id }, '⚠️ Failed to fetch instance connection state. Postponing message...');
      return this.rescheduleJob(job, 30 * 1000); // retry in 30s
    }

    if (connStateResult.value.state !== 'open') {
      logger.warn({ tenant_id, state: connStateResult.value.state }, '⚠️ WhatsApp instance is not open. Postponing...');
      return this.rescheduleJob(job, 60 * 1000); // retry in 60s
    }

    // Verify Quality Rating from Redis (Evolution hooks update this rating)
    const qualityRatingKey = `whatsapp:quality:${tenant_id}`;
    const qualityRating = await redis.get(qualityRatingKey);
    if (qualityRating === 'red') {
      logger.error({ tenant_id }, '🔴 WhatsApp Quality Rating is RED. Pausing campaigns.');
      
      // Pause campaign
      await prisma.campaign.updateMany({
        where: { tenantId: tenant_id, status: CampaignStatus.ACTIVE },
        data: { status: CampaignStatus.PAUSED },
      });

      await prisma.message.update({
        where: { id: message_id },
        data: {
          deliveryStatus: MessageDeliveryStatus.FAILED,
          failedReason: 'instance_quality_red',
        },
      });

      return { sent: false, postponed: false, reason: 'quality_red_paused' };
    }

    // Warmup Limit Validation
    const todayCountKey = `tenant-warmup-count:${tenant_id}:${new Date().toISOString().split('T')[0]}`;
    const todayCountRaw = await redis.get(todayCountKey);
    const todayCount = todayCountRaw ? parseInt(todayCountRaw, 10) : 0;
    const dailyLimit = getAquecimentoLimit(tenant.whatsappWarmupDay);

    if (todayCount >= dailyLimit) {
      logger.warn({ tenant_id, todayCount, dailyLimit }, '🚫 Daily warmup limit reached. Postponing...');
      
      // Reschedule for next calendar day (tomorrow 9:00 AM)
      const tomorrow9am = new Date();
      tomorrow9am.setDate(tomorrow9am.getDate() + 1);
      tomorrow9am.setHours(9, Math.floor(Math.random() * 30), 0, 0);
      const delayMs = tomorrow9am.getTime() - Date.now();

      return this.rescheduleJob(job, delayMs);
    }

    // Jitter Throttle (40-90s spread)
    const lastSendKey = `tenant-last-send:${tenant_id}`;
    const lastSendTimestamp = await redis.get(lastSendKey);
    if (lastSendTimestamp) {
      const secondsAgo = (Date.now() - parseInt(lastSendTimestamp, 10)) / 1000;
      const minJitter = 40 + Math.random() * 50; // random 40-90s jitter

      if (secondsAgo < minJitter) {
        const waitMs = Math.round((minJitter - secondsAgo) * 1000);
        logger.info({ tenant_id, secondsAgo, minJitter, waitMs }, '⏳ Throttling for jitter limit. Re-scheduling...');
        return this.rescheduleJob(job, waitMs);
      }
    }

    // Business Hours Validation (Off-hours policy)
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();

    const isSunday = day === 0;
    const isSaturdayAfternoon = day === 6 && hour >= 12;
    const isOffHours = hour < 9 || hour >= 18;

    if (isSunday || isSaturdayAfternoon || isOffHours) {
      logger.info({ tenant_id, hour, day }, '🌙 Out of business hours (off-hours). Storing in pending_outbound.');
      
      const nextStart = getNextWindowStart(now);
      const idempotencyKey = `pending-outbound:${message_id}`;

      await prisma.pendingOutbound.create({
        data: {
          tenantId: tenant_id,
          conversationId: conversation_id,
          content: message.content,
          scheduledFor: nextStart,
          idempotencyKey,
        },
      });

      await prisma.message.update({
        where: { id: message_id },
        data: {
          deliveryStatus: MessageDeliveryStatus.QUEUED,
          failedReason: 'postponed_off_hours',
        },
      });

      return { sent: false, postponed: true, reason: 'off_hours_scheduled_pending' };
    }

    // 4. Send Message via Evolution Client
    logger.info({ tenant_id, message_id, to: lead.whatsapp }, '🚀 Delivering message via Evolution API');

    const result = await evolutionClient.sendText({
      instance: secretRecord.evolutionInstanceName,
      apiKey: decryptedSecrets.evolutionApiKey,
      baseUrl: secretRecord.evolutionBaseUrl,
      number: lead.whatsapp,
      text: message.content,
    });

    if (!result.ok) {
      logger.error({ tenant_id, err: result.error.message }, '❌ Failed to deliver message');
      await prisma.message.update({
        where: { id: message_id },
        data: {
          deliveryStatus: MessageDeliveryStatus.FAILED,
          failedReason: result.error.message,
        },
      });
      return { sent: false, postponed: false, reason: result.error.message };
    }

    // 5. Success Registration & Counters
    const whatsappMessageId = result.value.messageId;

    await prisma.message.update({
      where: { id: message_id },
      data: {
        deliveryStatus: MessageDeliveryStatus.SENT,
        whatsappMessageId,
        deliveredAt: new Date(),
      },
    });

    // Update throttle caches in Redis
    await redis.set(lastSendKey, Date.now().toString());
    await redis.incr(todayCountKey);
    await redis.expire(todayCountKey, 86400); // 24h expire

    logger.info({ tenant_id, message_id, whatsappMessageId }, '✅ Message delivered and registered successfully');

    return { sent: true, postponed: false };
  }

  private async rescheduleJob(job: Job<SendMessagesPayload>, delayMs: number): Promise<SendMessagesResult> {
    const { createTenantQueue } = await import('../lib/queue.js');
    const queue = createTenantQueue(job.data.tenant_id, 'send-messages');
    await queue.add('send-whatsapp', job.data, { delay: delayMs });
    return { sent: false, postponed: true, reason: `rescheduled_delay_${delayMs}_ms` };
  }
}
