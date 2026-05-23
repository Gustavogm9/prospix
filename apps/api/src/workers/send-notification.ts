import { Job } from 'bullmq';
import { UserRole } from '@prisma/client';
import { BaseJobPayload } from '@prospix/shared-types';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { sendNotification } from '../services/notification-service.js';
import { BaseWorker } from './_base-worker.js';

export interface SendNotificationPayload extends BaseJobPayload {
  type: string;
  user_id?: string;
  lead_id?: string;
  meeting_id?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  link?: string;
}

export interface SendNotificationResult {
  success: boolean;
  notified_user_id?: string;
  skipped?: boolean;
  reason?: string;
}

interface ReminderContext {
  leadName?: string | null;
  scheduledFor?: Date | null;
  location?: string | null;
}

function formatMeetingWhen(scheduledFor?: Date | null): string {
  if (!scheduledFor) return 'no horario agendado';

  return scheduledFor.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function buildNotificationContent(type: string, context: ReminderContext): Pick<SendNotificationPayload, 'title' | 'body'> | null {
  const leadName = context.leadName || 'Lead';
  const when = formatMeetingWhen(context.scheduledFor);
  const where = context.location ? ` em ${context.location}` : '';

  if (type === 'meeting_reminder_24h') {
    return {
      title: 'Lembrete: reuniao em 24h',
      body: `Voce tem uma reuniao com ${leadName} em ${when}${where}.`,
    };
  }

  if (type === 'meeting_reminder_1h') {
    return {
      title: 'Lembrete: reuniao em 1h',
      body: `Sua reuniao com ${leadName} comeca em ${when}${where}.`,
    };
  }

  return null;
}

export class SendNotificationWorker extends BaseWorker<SendNotificationPayload, SendNotificationResult> {
  name = 'send-notification';
  concurrency = 10;

  async process(job: Job<SendNotificationPayload>): Promise<SendNotificationResult> {
    const { tenant_id, type, lead_id, meeting_id, data, link } = job.data;
    let { user_id, title, body } = job.data;
    const reminderContext: ReminderContext = {};

    if (lead_id) {
      const lead = await prisma.lead.findUnique({
        where: { id: lead_id },
        select: { id: true, tenantId: true, name: true },
      });

      if (!lead || lead.tenantId !== tenant_id) {
        throw new Error(`Lead ${lead_id} not found or tenant mismatch`);
      }

      reminderContext.leadName = lead.name;
    }

    if (meeting_id) {
      const meeting = await prisma.meeting.findUnique({
        where: { id: meeting_id },
        select: { id: true, tenantId: true, scheduledFor: true, location: true },
      });

      if (!meeting || meeting.tenantId !== tenant_id) {
        throw new Error(`Meeting ${meeting_id} not found or tenant mismatch`);
      }

      reminderContext.scheduledFor = meeting.scheduledFor;
      reminderContext.location = meeting.location;
    }

    if (!user_id) {
      const owner = await prisma.user.findFirst({
        where: { tenantId: tenant_id, role: UserRole.OWNER, deletedAt: null },
        select: { id: true },
      });

      if (!owner) {
        logger.warn({ tenant_id, type }, 'No tenant owner found for notification job');
        return { success: true, skipped: true, reason: 'owner_not_found' };
      }

      user_id = owner.id;
    }

    if (!title || !body) {
      const content = buildNotificationContent(type, reminderContext);
      title = title || content?.title;
      body = body || content?.body;
    }

    if (!title || !body) {
      throw new Error(`Notification job ${type} requires title and body`);
    }

    await sendNotification({
      tenantId: tenant_id,
      userId: user_id,
      type,
      title,
      body,
      data: {
        ...(data || {}),
        lead_id,
        meeting_id,
      },
      link,
    });

    return {
      success: true,
      notified_user_id: user_id,
    };
  }
}
