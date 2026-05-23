import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { classifyIntent } from '../ai/classifier.js';
import { executeScriptStep } from '../ai/script-engine.js';
import { buildSystemPrompt } from '../ai/prompt-builder.js';
import { callAIWithGuardrails } from '../ai/guardrails.js';
import { createTenantQueue } from '../lib/queue.js';
import { createSendWhatsappJobId } from './send-whatsapp-job.js';
import { LeadStatus, ConversationStatus, MessageDirection, MessageSender, MessageDeliveryStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface ProcessInboundPayload extends BaseJobPayload {
  conversation_id: string;
  lead_id: string;
  message_content: string;
  message_direction: 'INBOUND';
  whatsapp_message_id?: string;
  push_name?: string;
}

export interface ProcessInboundResult {
  success: boolean;
  replied: boolean;
  escalated: boolean;
  escalationReason?: string;
  optout: boolean;
}

function isWhatsappMessageUniqueViolation(err: unknown): boolean {
  const maybeError = err as { code?: string; meta?: { target?: unknown } } | null;
  if (!maybeError || maybeError.code !== 'P2002') return false;

  const target = maybeError.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('whatsappMessageId') || target.includes('whatsapp_message_id');
  }

  return typeof target === 'string'
    && (target.includes('whatsappMessageId') || target.includes('whatsapp_message_id'));
}

function duplicateInboundResult(): ProcessInboundResult {
  return { success: true, replied: false, escalated: false, optout: false };
}

export async function withLock<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, 'EX', ttlSec, 'NX');
  if (!acquired) {
    throw new Error(`Lock unavailable for key: ${key}`);
  }

  try {
    return await fn();
  } finally {
    // Release lock safely
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1, key, token
    );
  }
}

export class ProcessInboundWorker extends BaseWorker<ProcessInboundPayload, ProcessInboundResult> {
  name = 'process-inbound';
  concurrency = 5;

  async process(job: Job<ProcessInboundPayload>): Promise<ProcessInboundResult> {
    const { tenant_id, conversation_id, lead_id, message_content, whatsapp_message_id } = job.data;
    const lockKey = `lock:conversation:${conversation_id}`;
    const isRetry = job.attemptsMade > 0;

    return withLock(lockKey, 60, async (): Promise<ProcessInboundResult> => {
      logger.info({ conversation_id, lead_id }, '📥 Processing inbound message with lock acquired');

      let inboundAlreadyPersisted = false;
      if (whatsapp_message_id) {
        const existingInbound = await prisma.message.findUnique({
          where: { whatsappMessageId: whatsapp_message_id },
          select: { id: true, tenantId: true, conversationId: true },
        });

        if (existingInbound) {
          if (existingInbound.tenantId === tenant_id && existingInbound.conversationId === conversation_id) {
            inboundAlreadyPersisted = true;
            if (isRetry) {
              logger.info(
                { tenant_id, conversation_id, whatsapp_message_id, job_id: job.id },
                'process-inbound:retry-continues-with-existing-message'
              );
            } else {
              logger.info(
                { tenant_id, conversation_id, whatsapp_message_id },
                'process-inbound:duplicate-message-skipped'
              );
              return duplicateInboundResult();
            }
          } else {
            throw new Error(`WhatsApp message ${whatsapp_message_id} already belongs to another tenant or conversation`);
          }
        }
      }

      async function persistInboundMessageOnce(params: {
        intent: string | null;
        confidence: number | null;
      }): Promise<ProcessInboundResult | null> {
        if (inboundAlreadyPersisted) return null;

        try {
          await prisma.$transaction(async (tx) => {
            await tx.message.create({
              data: {
                tenantId: tenant_id,
                conversationId: conversation_id,
                direction: MessageDirection.INBOUND,
                sender: MessageSender.LEAD,
                content: message_content,
                whatsappMessageId: whatsapp_message_id,
                deliveryStatus: MessageDeliveryStatus.DELIVERED,
                intentDetected: params.intent,
                intentConfidence: params.confidence,
              },
            });

            await tx.conversation.update({
              where: { id: conversation_id },
              data: {
                lastMessageAt: new Date(),
                lastInboundAt: new Date(),
                messageCount: { increment: 1 },
              },
            });
          });
          return null;
        } catch (err) {
          if (!whatsapp_message_id || !isWhatsappMessageUniqueViolation(err)) {
            throw err;
          }

          const existingInbound = await prisma.message.findUnique({
            where: { whatsappMessageId: whatsapp_message_id },
            select: { id: true, tenantId: true, conversationId: true },
          });

          if (existingInbound?.tenantId === tenant_id && existingInbound.conversationId === conversation_id) {
            logger.info(
              { tenant_id, conversation_id, whatsapp_message_id },
              'process-inbound:duplicate-message-race-skipped'
            );
            return duplicateInboundResult();
          }

          throw err;
        }
      }

      // 1. Fetch lead
      const lead = await prisma.lead.findUnique({
        where: { id: lead_id },
      });

      if (!lead || lead.tenantId !== tenant_id) {
        throw new Error(`Lead ${lead_id} not found or tenant mismatch`);
      }

      // 2. Fetch conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversation_id },
        include: { messages: true },
      });

      if (!conversation || conversation.tenantId !== tenant_id) {
        throw new Error(`Conversation ${conversation_id} not found or tenant mismatch`);
      }

      // 3. Core hard-coded opt-out check before calling AI
      const lowerMsg = message_content.toLowerCase().trim();
      const isHardOptout = /^(sair|parar|não quero mais|descadastre|stop)$/i.test(lowerMsg);

      if (isHardOptout) {
        logger.info({ lead_id, conversation_id }, '🛡️ Hard opt-out detected pre-AI');
        const duplicateResult = await persistInboundMessageOnce({
          intent: 'optout_request',
          confidence: 1,
        });
        if (duplicateResult) return duplicateResult;
        await this.handleOptout(tenant_id, lead, conversation);
        return { success: true, replied: true, escalated: false, optout: true };
      }

      // 4. Call classifier to detect intent
      const classification = await classifyIntent({
        tenantId: tenant_id,
        messageContent: message_content,
        conversationHistory: conversation.messages.map((m) => ({
          sender: m.sender as 'AI' | 'USER' | 'LEAD',
          content: m.content,
        })),
      });

      const duplicateResult = await persistInboundMessageOnce({
        intent: classification.intent,
        confidence: classification.confidence,
      });
      if (duplicateResult) return duplicateResult;

      // Check if opt-out intent was classified
      if (classification.intent === 'optout_request') {
        logger.info({ lead_id, conversation_id }, '🛡️ Opt-out intent classified by AI');
        await this.handleOptout(tenant_id, lead, conversation);
        return { success: true, replied: true, escalated: false, optout: true };
      }

      // 5. If AI handling is disabled (manual control), we stop here
      if (!conversation.aiHandling) {
        logger.info({ conversation_id }, '👤 Conversation handled manually by user. Skipping AI response.');
        return { success: true, replied: false, escalated: false, optout: false };
      }

      // 6. Check for human escalation triggers
      // Trigger A: Explicit asking callback or complaint intent
      if (classification.intent === 'asking_callback' || classification.intent === 'complaint') {
        logger.info({ conversation_id, intent: classification.intent }, '🚨 Escalating to human: explicit intent trigger');
        await this.handleEscalation(tenant_id, lead, conversation, classification.intent);
        return { success: true, replied: false, escalated: true, escalationReason: classification.intent, optout: false };
      }

      // Trigger B: Low confidence twice in a row
      const previousLeadMsgs = conversation.messages.filter((m) => m.direction === MessageDirection.INBOUND);
      if (previousLeadMsgs.length > 0) {
        const lastMsg = previousLeadMsgs[previousLeadMsgs.length - 1];
        const lastConfidence = lastMsg!.intentConfidence ? Number(lastMsg!.intentConfidence) : 1.0;
        
        if (classification.confidence < 0.4 && lastConfidence < 0.4) {
          logger.info({ conversation_id }, '🚨 Escalating to human: low confidence (< 0.4) twice in a row');
          await this.handleEscalation(tenant_id, lead, conversation, 'consecutive_low_confidence');
          return { success: true, replied: false, escalated: true, escalationReason: 'consecutive_low_confidence', optout: false };
        }
      }

      // Trigger C: Conversation too long (> 10 messages) without scheduling
      if (conversation.messageCount >= 10) {
        logger.info({ conversation_id }, '🚨 Escalating to human: conversation too long without scheduling');
        await this.handleEscalation(tenant_id, lead, conversation, 'conversation_limit_exceeded');
        return { success: true, replied: false, escalated: true, escalationReason: 'conversation_limit_exceeded', optout: false };
      }

      // 7. Run Script Engine step
      const scriptResult = await executeScriptStep({
        tenantId: tenant_id,
        conversationId: conversation_id,
        intent: classification.intent,
      });

      // Handle Script Action execution
      if (scriptResult.actionToExecute) {
        if (scriptResult.actionToExecute === 'escalate_to_human') {
          await this.handleEscalation(tenant_id, lead, conversation, 'script_escalation_node');
          return { success: true, replied: false, escalated: true, escalationReason: 'script_escalation_node', optout: false };
        } else if (scriptResult.actionToExecute === 'mark_optout') {
          await this.handleOptout(tenant_id, lead, conversation);
          return { success: true, replied: true, escalated: false, optout: true };
        }
      }

      // 8. Generate reply using Prompt Builder + AIRouter with Guardrails
      // Resolve active owner/user
      const user = await prisma.user.findFirst({
        where: { tenantId: tenant_id, role: 'OWNER' },
      });

      if (!user) {
        throw new Error(`No OWNER user found for tenant: ${tenant_id}`);
      }

      // Fetch active script for Prompt Builder context
      const script = conversation.scriptId
        ? await prisma.script.findUnique({ where: { id: conversation.scriptId } })
        : null;

      const systemPrompt = buildSystemPrompt({
        user: {
          name: user.name,
          years_career: user.preferences ? (user.preferences as any).years_career || 5 : 5,
        },
        tenant: {
          id: tenant_id,
          name: lead.tenantId, // fallback
          aiVoiceProfile: lead.tenantId ? (await prisma.tenant.findUnique({ where: { id: tenant_id } }))?.aiVoiceProfile as any : null,
        },
        lead: {
          name: lead.name || 'Lead',
          profession: lead.profession || 'Dentista',
          address: lead.address,
          fit_score: lead.fitScore ? Number(lead.fitScore) : undefined,
        },
        conversation: {
          messages: conversation.messages.map((m) => ({
            sender: m.sender as 'AI' | 'USER' | 'LEAD',
            content: m.content,
            createdAt: m.createdAt,
          })),
        },
        script: {
          name: script?.name || 'Roteiro Padrão',
          baseMessage: scriptResult.messageToSend || script?.baseMessage || undefined,
        },
        currentNode: {
          id: conversation.currentNodeId || 'start',
          type: 'message',
        },
      });

      // Call AI Router with Guardrails
      const aiReplyResult = await callAIWithGuardrails({
        tenantId: tenant_id,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `O lead disse: "${message_content}"` },
        ],
      });

      if (aiReplyResult.escalated) {
        // Escalate due to guardrail failures
        await this.handleEscalation(tenant_id, lead, conversation, aiReplyResult.escalatedReason || 'guardrail_failed');
        return {
          success: true,
          replied: false,
          escalated: true,
          escalationReason: aiReplyResult.escalatedReason,
          optout: false,
        };
      }

      // Save outbound reply to database
      const newMsg = await prisma.message.create({
        data: {
          tenantId: tenant_id,
          conversationId: conversation_id,
          direction: MessageDirection.OUTBOUND,
          sender: MessageSender.AI,
          content: aiReplyResult.message_to_send,
          deliveryStatus: MessageDeliveryStatus.QUEUED,
          llmModel: aiReplyResult.llmModel,
          llmTokensInput: aiReplyResult.tokensInput,
          llmTokensOutput: aiReplyResult.tokensOutput,
          llmCostCents: Math.round(aiReplyResult.costCents),
          llmLatencyMs: aiReplyResult.latencyMs,
          scriptId: conversation.scriptId,
          scriptVariationId: scriptResult.variationId,
          scriptNodeId: conversation.currentNodeId,
        },
      });

      // Update conversation counters
      await prisma.conversation.update({
        where: { id: conversation_id },
        data: {
          lastMessageAt: new Date(),
          lastOutboundAt: new Date(),
          messageCount: { increment: 1 },
        },
      });

      // 9. Enqueue message delivery in send-messages queue
      const sendQueue = createTenantQueue(tenant_id, 'send-messages');
      await sendQueue.add('send-whatsapp', {
        tenant_id,
        conversation_id,
        message_id: newMsg.id,
      }, {
        jobId: createSendWhatsappJobId(tenant_id, newMsg.id),
      });

      return {
        success: true,
        replied: true,
        escalated: false,
        optout: false,
      };
    });
  }

  private async handleOptout(tenantId: string, lead: any, conversation: any) {
    logger.info({ lead_id: lead.id }, '🛡️ Processing opt-out action and marking tables');
    
    // Register opt-out record
    await prisma.optout.upsert({
      where: {
        tenantId_whatsapp: {
          tenantId,
          whatsapp: lead.whatsapp,
        },
      },
      create: {
        tenantId,
        whatsapp: lead.whatsapp,
        reason: 'lead_request',
        source: 'lead_request',
      },
      update: {
        reason: 'lead_request',
        source: 'lead_request',
      },
    });

    // Mark lead status as opted-out
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: LeadStatus.OPTED_OUT },
    });

    // Close conversation and turn off AI handling
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: ConversationStatus.CLOSED,
        aiHandling: false,
      },
    });

    // Insert confirmation msg in DB and send it
    const optoutConfirmation = 'Seu número foi removido das nossas listas de contatos com sucesso. Você não receberá mais mensagens automáticas. Obrigado!';
    const newMsg = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        sender: MessageSender.AI,
        content: optoutConfirmation,
        deliveryStatus: MessageDeliveryStatus.QUEUED,
      },
    });

    // Enqueue sending
    const sendQueue = createTenantQueue(tenantId, 'send-messages');
    await sendQueue.add('send-whatsapp', {
      tenant_id: tenantId,
      conversation_id: conversation.id,
      message_id: newMsg.id,
      force_send_optout_confirmation: true,
    }, {
      jobId: createSendWhatsappJobId(tenantId, newMsg.id),
    });
  }

  private async handleEscalation(tenantId: string, lead: any, conversation: any, reason: string) {
    logger.info({ lead_id: lead.id, reason }, '🚨 Escalating conversation to human');

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: ConversationStatus.ESCALATED,
        aiHandling: false,
        escalatedReason: reason.substring(0, 64),
      },
    });

    // Update lead status
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: LeadStatus.ESCALATED_HUMAN },
    });

    // Log lead event
    await prisma.leadEvent.create({
      data: {
        tenantId,
        leadId: lead.id,
        eventType: 'lead.escalated_human',
        payload: {
          conversation_id: conversation.id,
          reason,
        },
      },
    });
  }
}
