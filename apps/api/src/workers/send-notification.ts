import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { sendNotification } from '../services/notification-service.js';

export interface SendNotificationPayload extends BaseJobPayload {
  user_id?: string;
  lead_id?: string;
  meeting_id?: string;
  type: string;
  title?: string;
  body?: string;
  data?: Record<string, any>;
}

export interface SendNotificationResult {
  sent: boolean;
  notification_id?: string;
}

export class SendNotificationWorker extends BaseWorker<SendNotificationPayload, SendNotificationResult> {
  name = 'send-notification';
  concurrency = 10;

  async process(job: Job<SendNotificationPayload>): Promise<SendNotificationResult> {
    const { tenant_id, user_id, lead_id, meeting_id, type, title, body, data } = job.data;

    // Resolve target user_id
    let targetUserId = user_id;

    if (!targetUserId) {
      // Find the OWNER of the tenant to send notification to
      const { data: owner } = await dbAdmin
        .from('users')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('role', 'OWNER')
        .is('deleted_at', null)
        .limit(1)
        .single();

      if (!owner) {
        logger.warn({ tenant_id }, '⚠️ No OWNER user found for tenant. Cannot deliver notification.');
        return { sent: false };
      }
      targetUserId = owner.id;
    }

    // Build notification title/body based on type if not provided
    let resolvedTitle = title || '';
    let resolvedBody = body || '';
    const resolvedData: Record<string, any> = { ...(data || {}) };

    if (!title || !body) {
      switch (type) {
        case 'meeting_reminder_24h': {
          if (meeting_id) {
            const { data: meeting } = await dbAdmin
              .from('meetings')
              .select('*, leads(name)')
              .eq('id', meeting_id)
              .single();
            if (meeting) {
              const leadName = (meeting.leads as any)?.name || 'Lead';
              resolvedTitle = '📅 Lembrete: Reunião amanhã';
              resolvedBody = `Você tem uma reunião com ${leadName} amanhã. Verifique os detalhes no painel.`;
              resolvedData.meeting_id = meeting_id;
              resolvedData.lead_name = leadName;
            }
          }
          break;
        }
        case 'meeting_reminder_1h': {
          if (meeting_id) {
            const { data: meeting } = await dbAdmin
              .from('meetings')
              .select('*, leads(name)')
              .eq('id', meeting_id)
              .single();
            if (meeting) {
              const leadName = (meeting.leads as any)?.name || 'Lead';
              resolvedTitle = '⏰ Reunião em 1 hora!';
              resolvedBody = `Sua reunião com ${leadName} começa em 1 hora.`;
              resolvedData.meeting_id = meeting_id;
              resolvedData.lead_name = leadName;
            }
          }
          break;
        }
        case 'lead_escalated': {
          if (lead_id) {
            const { data: lead } = await dbAdmin
              .from('leads')
              .select('name')
              .eq('id', lead_id)
              .single();
            resolvedTitle = '🚨 Lead escalado para atendimento humano';
            resolvedBody = `O lead "${lead?.name || 'Lead'}" precisa de atenção manual.`;
            resolvedData.lead_id = lead_id;
          }
          break;
        }
        default: {
          resolvedTitle = resolvedTitle || `Notificação: ${type}`;
          resolvedBody = resolvedBody || 'Você tem uma nova notificação no Prospix.';
        }
      }
    }

    // Send notification
    const notification = await sendNotification({
      tenantId: tenant_id,
      userId: targetUserId!,
      type,
      title: resolvedTitle,
      body: resolvedBody,
      data: resolvedData,
    });

    return {
      sent: true,
      notification_id: (notification as any)?.id,
    };
  }
}
