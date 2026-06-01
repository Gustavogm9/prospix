import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { classifyIntent } from '../ai/classifier.js';
import { executeScriptStep } from '../ai/script-engine.js';
import { buildSystemPrompt } from '../ai/prompt-builder.js';
import { callAIWithGuardrails } from '../ai/guardrails.js';
import { createTenantQueue } from '../lib/queue.js';
import { createSendWhatsappJobId } from './send-whatsapp-job.js';
import { LeadStatus, ConversationStatus, MessageDirection, MessageSender, MessageDeliveryStatus } from '@prospix/shared-types';
import { randomUUID } from 'crypto';
import { publishRealtimeEvent } from '../lib/realtime.js';

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

function isSupabaseUniqueViolation(err: unknown): boolean {
  const maybeError = err as { code?: string; message?: string } | null;
  if (!maybeError) return false;
  // Supabase/PostgREST unique violation code is 23505
  return maybeError.code === '23505' && (maybeError.message?.includes('whatsapp_message_id') ?? false);
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
        const { data: existingInbound } = await dbAdmin
          .from('messages')
          .select('id, tenant_id, conversation_id')
          .eq('whatsapp_message_id', whatsapp_message_id)
          .single();

        if (existingInbound) {
          if (existingInbound.tenant_id === tenant_id && existingInbound.conversation_id === conversation_id) {
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
          // Insert message
          const { error: msgErr } = await dbAdmin
            .from('messages')
            .insert({
              tenant_id: tenant_id,
              conversation_id: conversation_id,
              direction: MessageDirection.INBOUND,
              sender: MessageSender.LEAD,
              content: message_content,
              whatsapp_message_id: whatsapp_message_id,
              delivery_status: MessageDeliveryStatus.DELIVERED,
              intent_detected: params.intent,
              intent_confidence: params.confidence,
            } as any);
          if (msgErr) throw msgErr;

          // Update conversation counters
          const { data: conv } = await dbAdmin
            .from('conversations')
            .select('message_count')
            .eq('id', conversation_id)
            .single();

          const { error: convErr } = await dbAdmin
            .from('conversations')
            .update({
              last_message_at: new Date().toISOString(),
              last_inbound_at: new Date().toISOString(),
              message_count: (conv?.message_count || 0) + 1,
            })
            .eq('id', conversation_id);
          if (convErr) throw convErr;

          // Publish realtime event for inbound message
          await publishRealtimeEvent({
            type: 'message:created',
            tenantId: tenant_id,
            payload: {
              id: 'inbound-' + Date.now(),
              conversation_id,
              direction: 'INBOUND',
              sender: 'LEAD',
              content: message_content,
              whatsapp_message_id: whatsapp_message_id,
              created_at: new Date().toISOString(),
            },
          });
          return null;
        } catch (err) {
          if (!whatsapp_message_id || !isSupabaseUniqueViolation(err)) {
            throw err;
          }

          const { data: existingInbound } = await dbAdmin
            .from('messages')
            .select('id, tenant_id, conversation_id')
            .eq('whatsapp_message_id', whatsapp_message_id)
            .single();

          if (existingInbound?.tenant_id === tenant_id && existingInbound.conversation_id === conversation_id) {
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
      const { data: lead, error: leadErr } = await dbAdmin
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();

      if (leadErr || !lead || lead.tenant_id !== tenant_id) {
        throw new Error(`Lead ${lead_id} not found or tenant mismatch`);
      }

      // 2. Fetch conversation with messages
      const { data: conversation, error: convErr } = await dbAdmin
        .from('conversations')
        .select('*, messages(*)')
        .eq('id', conversation_id)
        .single();

      if (convErr || !conversation || conversation.tenant_id !== tenant_id) {
        throw new Error(`Conversation ${conversation_id} not found or tenant mismatch`);
      }

      const conversationMessages = (conversation.messages || []) as any[];

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
        conversationHistory: conversationMessages.map((m: any) => ({
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
      if (!conversation.ai_handling) {
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
      const previousLeadMsgs = conversationMessages.filter((m: any) => m.direction === MessageDirection.INBOUND);
      if (previousLeadMsgs.length > 0) {
        const lastMsg = previousLeadMsgs[previousLeadMsgs.length - 1];
        const lastConfidence = lastMsg!.intent_confidence ? Number(lastMsg!.intent_confidence) : 1.0;
        
        if (classification.confidence < 0.4 && lastConfidence < 0.4) {
          logger.info({ conversation_id }, '🚨 Escalating to human: low confidence (< 0.4) twice in a row');
          await this.handleEscalation(tenant_id, lead, conversation, 'consecutive_low_confidence');
          return { success: true, replied: false, escalated: true, escalationReason: 'consecutive_low_confidence', optout: false };
        }
      }

      // Trigger C: Conversation too long (> 10 messages) without scheduling
      if (conversation.message_count >= 10) {
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
      const { data: user } = await dbAdmin
        .from('users')
        .select('*')
        .eq('tenant_id', tenant_id)
        .eq('role', 'OWNER')
        .limit(1)
        .single();

      if (!user) {
        throw new Error(`No OWNER user found for tenant: ${tenant_id}`);
      }

      // Fetch active script for Prompt Builder context
      let script: any = null;
      if (conversation.script_id) {
        const { data: scriptData } = await dbAdmin
          .from('scripts')
          .select('*')
          .eq('id', conversation.script_id)
          .single();
        script = scriptData;
      }

      // Fetch tenant for ai_voice_profile
      const { data: tenantData } = await dbAdmin
        .from('tenants')
        .select('id, name, ai_voice_profile')
        .eq('id', tenant_id)
        .single();

      const systemPrompt = buildSystemPrompt({
        user: {
          name: user.name,
          years_career: user.preferences ? (user.preferences as any).years_career || 5 : 5,
        },
        tenant: {
          id: tenant_id,
          name: tenantData?.name || tenant_id,
          aiVoiceProfile: tenantData?.ai_voice_profile as any,
        },
        lead: {
          name: lead.name || 'Lead',
          profession: lead.profession || 'Dentista',
          address: lead.address,
          fit_score: lead.fit_score ? Number(lead.fit_score) : undefined,
        },
        conversation: {
          messages: conversationMessages.map((m: any) => ({
            sender: m.sender as 'AI' | 'USER' | 'LEAD',
            content: m.content,
            createdAt: m.created_at,
          })),
        },
        script: {
          name: script?.name || 'Roteiro Padrão',
          baseMessage: scriptResult.messageToSend || script?.base_message || undefined,
        },
        currentNode: {
          id: conversation.current_node_id || 'start',
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
      const { data: newMsg, error: newMsgErr } = await dbAdmin
        .from('messages')
        .insert({
          tenant_id: tenant_id,
          conversation_id: conversation_id,
          direction: MessageDirection.OUTBOUND,
          sender: MessageSender.AI,
          content: aiReplyResult.message_to_send,
          delivery_status: MessageDeliveryStatus.QUEUED,
          llm_model: aiReplyResult.llmModel,
          llm_tokens_input: aiReplyResult.tokensInput,
          llm_tokens_output: aiReplyResult.tokensOutput,
          llm_cost_cents: Math.round(aiReplyResult.costCents),
          llm_latency_ms: aiReplyResult.latencyMs,
          script_id: conversation.script_id,
          script_variation_id: scriptResult.variationId,
          script_node_id: conversation.current_node_id,
        } as any)
        .select()
        .single();

      if (newMsgErr) throw newMsgErr;

      // Publish realtime event for outbound AI reply
      await publishRealtimeEvent({
        type: 'message:created',
        tenantId: tenant_id,
        payload: {
          id: newMsg.id,
          conversation_id,
          direction: 'OUTBOUND',
          sender: 'AI',
          content: aiReplyResult.message_to_send,
          created_at: new Date().toISOString(),
        },
      });

      // Update conversation counters
      const { error: convUpdateErr } = await dbAdmin
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_outbound_at: new Date().toISOString(),
          message_count: (conversation.message_count || 0) + 1,
        })
        .eq('id', conversation_id);
      if (convUpdateErr) throw convUpdateErr;

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
    
    // Register opt-out record (upsert)
    const { error: upsertErr } = await dbAdmin
      .from('optouts')
      .upsert(
        {
          tenant_id: tenantId,
          whatsapp: lead.whatsapp,
          reason: 'lead_request',
          source: 'lead_request',
        },
        { onConflict: 'tenant_id,whatsapp' }
      );
    if (upsertErr) throw upsertErr;

    // Mark lead status as opted-out
    const { error: leadErr } = await dbAdmin
      .from('leads')
      .update({ status: LeadStatus.OPTED_OUT })
      .eq('id', lead.id);
    if (leadErr) throw leadErr;

    // Close conversation and turn off AI handling
    const { error: convErr } = await dbAdmin
      .from('conversations')
      .update({
        status: ConversationStatus.CLOSED,
        ai_handling: false,
      })
      .eq('id', conversation.id);
    if (convErr) throw convErr;

    // Insert confirmation msg in DB and send it
    const optoutConfirmation = 'Seu número foi removido das nossas listas de contatos com sucesso. Você não receberá mais mensagens automáticas. Obrigado!';
    const { data: newMsg, error: msgErr } = await dbAdmin
      .from('messages')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversation.id,
        direction: MessageDirection.OUTBOUND,
        sender: MessageSender.AI,
        content: optoutConfirmation,
        delivery_status: MessageDeliveryStatus.QUEUED,
      } as any)
      .select()
      .single();
    if (msgErr) throw msgErr;

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
    const { error: convErr } = await dbAdmin
      .from('conversations')
      .update({
        status: ConversationStatus.ESCALATED,
        ai_handling: false,
        escalated_reason: reason.substring(0, 64),
      })
      .eq('id', conversation.id);
    if (convErr) throw convErr;

    // Update lead status
    const { error: leadErr } = await dbAdmin
      .from('leads')
      .update({ status: LeadStatus.ESCALATED_HUMAN })
      .eq('id', lead.id);
    if (leadErr) throw leadErr;

    // Log lead event
    const { error: eventErr } = await dbAdmin
      .from('lead_events')
      .insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        event_type: 'lead.escalated_human',
        payload: {
          conversation_id: conversation.id,
          reason,
        },
      });
    if (eventErr) throw eventErr;
  }
}
