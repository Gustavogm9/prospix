import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { createTenantQueue } from '../../lib/queue.js';
import { validateEvolutionWebhookSignature } from '../../integrations/evolution.js';
import { LeadStatus, ConversationStatus, MessageDeliveryStatus } from '@prisma/client';
import { tenantContextStorage } from '../../lib/tenant-context-storage.js';
import { Readable } from 'stream';
import crypto from 'crypto';

function createExternalEventJobId(...parts: Array<string | null | undefined>): string {
  const hash = crypto
    .createHash('sha256')
    .update(parts.filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 32);

  return `external-evolution-${hash}`;
}

export const evolutionWebhookRoutes: FastifyPluginAsync = async (app) => {
  
  // Hook to capture rawBody for HMAC checking using a synchronous Promise stream reader
  // to fully eliminate race conditions and keep it fully portable.
  app.addHook('preParsing', async (request: any, _reply, payload) => {
    const rawBodyBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      payload.on('data', (chunk: Buffer) => chunks.push(chunk));
      payload.on('end', () => resolve(Buffer.concat(chunks)));
      payload.on('error', (err) => reject(err));
    });

    request.rawBody = rawBodyBuffer.toString('utf8');

    // Create a new readable stream containing the original raw body buffer
    // so the subsequent Fastify JSON parsers can consume it normally.
    const newPayload = new Readable();
    newPayload._read = () => {};
    newPayload.push(rawBodyBuffer);
    newPayload.push(null);
    return newPayload;
  });

  async function findTenantSecretByEvolutionInstance(instanceName: string) {
    return tenantContextStorage.run({ tenantId: null, bypassRls: true }, async () => {
      return prisma.tenantSecret.findFirst({
        where: { evolutionInstanceName: instanceName },
      });
    });
  }

  // Helper to resolve tenant and validate HMAC signature
  async function resolveTenantAndValidate(req: FastifyRequest, reply: FastifyReply, instanceName: string): Promise<string | null> {
    // 1. Fetch tenant secret record using RLS bypass context
    const secretRecord = await findTenantSecretByEvolutionInstance(instanceName);

    if (!secretRecord) {
      logger.warn({ instanceName }, '⚠️ Webhook received for unconfigured Evolution API instance');
      reply.code(404).send({ error: 'Tenant secrets not found' });
      return null;
    }

    const tenantId = secretRecord.tenantId;

    // HMAC verification if webhook secret is configured.
    // In production, every Evolution instance must have a webhook secret.
    const webhookSecret = secretRecord.evolutionWebhookSecret;
    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        logger.error({ tenantId, instanceName }, '❌ Evolution webhook secret missing in production');
        reply.code(401).send({ error: 'Unauthorized', message: 'Evolution webhook secret is required in production' });
        return null;
      }

      return tenantId;
    }

    const signature = (req.headers['x-evolution-signature'] as string) || (req.headers['signature'] as string);
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    const isValid = validateEvolutionWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      logger.error({ tenantId, instanceName }, '❌ Webhook HMAC signature verification failed');
      reply.code(401).send({ error: 'Unauthorized', message: 'HMAC signature is invalid' });
      return null;
    }

    return tenantId;
  }

  // ── Handler Functions ──────────────────────────────────────────────────────

  async function handleInboundMessage(req: FastifyRequest, reply: FastifyReply) {
    const body = req.body as any;
    const instance = body.instance;
    const event = body.event;

    if (!instance || event !== 'messages.upsert') {
      return reply.code(200).send({ success: true, ignored: true, reason: 'unsupported_event' });
    }

    const tenantId = await resolveTenantAndValidate(req, reply, instance);
    if (!tenantId) return; // Response handled by helper

    const messageData = body.data;
    if (!messageData || messageData.key?.fromMe) {
      // Ignora mensagens enviadas pelo próprio número do whatsapp (outbound)
      return reply.code(200).send({ success: true, ignored: true, reason: 'outbound_ignored' });
    }

    const remoteJid = messageData.key.remoteJid || '';
    const number = remoteJid.split('@')[0];
    const messageId = messageData.key.id;
    const pushName = messageData.pushName || 'Lead do WhatsApp';

    // Retrieve text message content
    const text = messageData.message?.conversation || messageData.message?.extendedTextMessage?.text || '';
    if (!text) {
      logger.info({ messageId }, '👻 Empty message content, ignoring (media or other)');
      return reply.code(200).send({ success: true, ignored: true, reason: 'empty_content' });
    }

    // 2. Wrap all database operations and queue dispatch inside the RLS tenant context scope
    return tenantContextStorage.run({ tenantId }, async () => {
      // A. Idempotency Check: search if message was already registered
      const existingMsg = await prisma.message.findUnique({
        where: { whatsappMessageId: messageId },
      });

      if (existingMsg) {
        logger.info({ messageId }, '🔄 Duplicate webhook received (idempotency triggered)');
        return reply.code(200).send({ success: true, duplicate: true });
      }

      // B. Fetch or create Lead
      let lead = await prisma.lead.findUnique({
        where: {
          tenantId_whatsapp: {
            tenantId,
            whatsapp: number,
          },
        },
      });

      if (!lead) {
        logger.info({ number, tenantId }, '🆕 Lead not found, creating in webhook dynamically');
        lead = await prisma.lead.create({
          data: {
            tenantId,
            whatsapp: number,
            name: pushName,
            source: 'MANUAL',
            status: LeadStatus.CONTACTED,
          },
        });
      }

      // C. Fetch or create active Conversation
      let conversation = await prisma.conversation.findFirst({
        where: {
          tenantId,
          leadId: lead.id,
          status: ConversationStatus.ACTIVE,
        },
      });

      if (!conversation) {
        logger.info({ leadId: lead.id }, '🆕 Active conversation not found, creating a new one');
        conversation = await prisma.conversation.create({
          data: {
            tenantId,
            leadId: lead.id,
            status: ConversationStatus.ACTIVE,
            aiHandling: true,
          },
        });
      }

      // D. Enqueue processing in process-inbound queue asynchronously
      const processQueue = createTenantQueue(tenantId, 'process-inbound');
      await processQueue.add('inbound-message', {
        tenant_id: tenantId,
        conversation_id: conversation.id,
        lead_id: lead.id,
        message_content: text,
        message_direction: 'INBOUND',
        whatsapp_message_id: messageId,
        push_name: pushName,
      }, {
        jobId: createExternalEventJobId(tenantId, event, messageId),
      });

      logger.info({ tenantId, conversationId: conversation.id, messageId }, '📥 Inbound message queued for processing');
      return reply.code(200).send({ success: true, queued: true });
    });
  }

  async function handleStatusUpdate(req: FastifyRequest, reply: FastifyReply) {
    const body = req.body as any;
    const instance = body.instance;
    const event = body.event;

    if (!instance || event !== 'messages.update') {
      return reply.code(200).send({ success: true, ignored: true });
    }

    const tenantId = await resolveTenantAndValidate(req, reply, instance);
    if (!tenantId) return;

    const statusData = body.data;
    if (!statusData || !statusData.key) {
      return reply.code(200).send({ success: true, ignored: true });
    }

    const messageId = statusData.key.id;
    const rawStatus = statusData.status;

    // Map Evolution status to message Delivery Status
    let status: MessageDeliveryStatus = MessageDeliveryStatus.SENT;
    if (rawStatus === 'DELIVERED') {
      status = MessageDeliveryStatus.DELIVERED;
    } else if (rawStatus === 'READ') {
      status = MessageDeliveryStatus.READ;
    } else if (rawStatus === 'ERROR' || rawStatus === 'FAILED') {
      status = MessageDeliveryStatus.FAILED;
    }

    // Wrap the message updates inside the RLS tenant context scope
    return tenantContextStorage.run({ tenantId }, async () => {
      // Search and update message
      const msg = await prisma.message.findUnique({
        where: { whatsappMessageId: messageId },
      });

      if (msg) {
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            deliveryStatus: status,
            deliveredAt: status === MessageDeliveryStatus.DELIVERED ? new Date() : undefined,
            readAt: status === MessageDeliveryStatus.READ ? new Date() : undefined,
            failedReason: status === MessageDeliveryStatus.FAILED ? 'Evolution API delivery failed' : undefined,
          },
        });
        logger.info({ messageId, status }, '✅ Message delivery status updated');
      }

      return reply.code(200).send({ success: true });
    });
  }

  async function handleInstanceUpdate(req: FastifyRequest, reply: FastifyReply) {
    const body = req.body as any;
    const instance = body.instance;
    const event = body.event;

    if (!instance) {
      return reply.code(200).send({ success: true, ignored: true });
    }

    const tenantId = await resolveTenantAndValidate(req, reply, instance);
    if (!tenantId) return;

    logger.info({ tenantId, event, body }, '🔌 Evolution Instance status webhook received');

    // Wrap instance state modifications inside the RLS tenant context scope
    return tenantContextStorage.run({ tenantId }, async () => {
      // If quality rating is present in payload, cache it in Redis
      if (body.data?.quality_rating || body.quality_rating) {
        const rating = body.data?.quality_rating || body.quality_rating;
        const qualityRatingKey = `whatsapp:quality:${tenantId}`;
        await redis.set(qualityRatingKey, rating.toLowerCase());
        logger.info({ tenantId, rating }, '📈 WhatsApp Quality Rating cached in Redis');
      }

      return reply.code(200).send({ success: true });
    });
  }

  // ── Routes Definitions ─────────────────────────────────────────────────────

  // Unified Dispatcher - Receives all events under a single URL setup
  app.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as any;
    const event = body.event;

    logger.info({ event }, '🔌 Unified Evolution Webhook received event');

    if (event === 'messages.upsert') {
      return handleInboundMessage(req, reply);
    } else if (event === 'messages.update') {
      return handleStatusUpdate(req, reply);
    } else {
      return handleInstanceUpdate(req, reply);
    }
  });

  // Legacy direct endpoints for backward compatibility
  app.post('/inbound', handleInboundMessage);
  app.post('/status', handleStatusUpdate);
  app.post('/instance', handleInstanceUpdate);
};

export default evolutionWebhookRoutes;
