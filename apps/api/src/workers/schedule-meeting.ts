import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { createEvent, listEvents } from '../integrations/google-calendar.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { LeadStatus, MeetingStatus } from '@prospix/shared-types';

export interface ScheduleMeetingPayload extends BaseJobPayload {
  lead_id: string;
  scheduled_for: string; // ISO 8601
  duration: number; // minutos
  location?: string;
}

export interface ScheduleMeetingResult {
  success: boolean;
  meeting_id?: string;
  google_event_id?: string;
  conflict?: boolean;
  alternatives?: string[];
}

export class ScheduleMeetingWorker extends BaseWorker<ScheduleMeetingPayload, ScheduleMeetingResult> {
  name = 'schedule-meeting';
  concurrency = 5;

  async process(job: Job<ScheduleMeetingPayload>): Promise<ScheduleMeetingResult> {
    const { tenant_id, lead_id, scheduled_for, duration, location } = job.data;
    const targetStart = new Date(scheduled_for);
    const targetEnd = new Date(targetStart.getTime() + duration * 60 * 1000);

    // 1. Fetch Lead
    const { data: lead, error: leadErr } = await dbAdmin
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead || lead.tenant_id !== tenant_id) {
      throw new Error(`Lead ${lead_id} not found or tenant mismatch`);
    }

    // 2. Fetch Tenant Secrets & Calendar Config
    const secrets = await getDecryptedSecrets(tenant_id);
    const { data: secretRecord } = await dbAdmin
      .from('tenant_secrets')
      .select('*')
      .eq('tenant_id', tenant_id)
      .single();

    if (!secrets?.googleOauthRefresh || !secretRecord?.google_calendar_id) {
      logger.warn({ tenant_id, lead_id }, 'Google Calendar integration not fully configured for this tenant');
      return { success: false, conflict: false };
    }

    const calendarId = secretRecord.google_calendar_id;
    const refreshToken = secrets.googleOauthRefresh;

    // 3. Conflict Check (Get events for the target day)
    // We check from 4 hours before targetStart to 4 hours after targetEnd to get full window context
    const timeMin = new Date(targetStart.getTime() - 4 * 60 * 60 * 1000);
    const timeMax = new Date(targetEnd.getTime() + 4 * 60 * 60 * 1000);

    const eventsResult = await listEvents({
      calendarId,
      refreshToken,
      timeMin,
      timeMax,
    });

    if (!eventsResult.ok) {
      throw new Error(`Failed to list calendar events: ${eventsResult.error.message}`);
    }

    const events = eventsResult.value;
    const bufferMs = 15 * 60 * 1000; // 15 mins buffer

    const hasConflict = events.some((evt) => {
      if (!evt.start?.dateTime || !evt.end?.dateTime) return false;
      const evtStart = new Date(evt.start.dateTime).getTime();
      const evtEnd = new Date(evt.end.dateTime).getTime();

      return targetStart.getTime() - bufferMs < evtEnd && targetEnd.getTime() + bufferMs > evtStart;
    });

    if (hasConflict) {
      logger.info({ tenant_id, lead_id, scheduled_for }, 'Time slot conflict detected. Proposing alternatives.');

      const alternatives: string[] = [];
      let potentialStart = new Date(targetStart.getTime());

      while (alternatives.length < 2) {
        potentialStart = new Date(potentialStart.getTime() + 30 * 60 * 1000);
        const potEnd = new Date(potentialStart.getTime() + duration * 60 * 1000);

        const hour = potentialStart.getHours();
        if (hour < 9 || hour >= 18) {
          potentialStart.setDate(potentialStart.getDate() + 1);
          potentialStart.setHours(9, 0, 0, 0);
          continue;
        }

        const conflict = events.some((evt) => {
          if (!evt.start?.dateTime || !evt.end?.dateTime) return false;
          const evtStart = new Date(evt.start.dateTime).getTime();
          const evtEnd = new Date(evt.end.dateTime).getTime();
          return potentialStart.getTime() - bufferMs < evtEnd && potEnd.getTime() + bufferMs > evtStart;
        });

        if (!conflict) {
          alternatives.push(potentialStart.toISOString());
        }
      }

      return {
        success: false,
        conflict: true,
        alternatives,
      };
    }

    // 4. Create Event on Google Calendar
    const eventSummary = `Prospix: Reunião com ${lead.name || 'Lead'}`;
    const eventDescription = `Reunião de negócios agendada via Prospix AI.\nLead ID: ${lead.id}\nStatus: Agendado`;

    const createResult = await createEvent({
      calendarId,
      refreshToken,
      event: {
        summary: eventSummary,
        description: eventDescription,
        start: targetStart,
        end: targetEnd,
        attendees: lead.email ? [{ email: lead.email }] : undefined,
      },
    });

    if (!createResult.ok) {
      throw new Error(`Failed to create google calendar event: ${createResult.error.message}`);
    }

    const googleEventId = createResult.value.id;

    // 5. Database Records
    const { data: meeting, error: meetingErr } = await dbAdmin
      .from('meetings')
      .insert({
        tenant_id: tenant_id,
        lead_id: lead_id,
        google_event_id: googleEventId,
        scheduled_for: targetStart.toISOString(),
        duration_minutes: duration,
        location: location || 'Google Meet',
        status: MeetingStatus.SCHEDULED,
      } as any)
      .select()
      .single();

    if (meetingErr) throw meetingErr;

    const { error: leadUpdateErr } = await dbAdmin
      .from('leads')
      .update({ status: LeadStatus.MEETING_SCHEDULED })
      .eq('id', lead_id);
    if (leadUpdateErr) throw leadUpdateErr;

    const { error: eventErr } = await dbAdmin
      .from('lead_events')
      .insert({
        tenant_id: tenant_id,
        lead_id: lead_id,
        event_type: 'meeting.scheduled',
        payload: {
          meeting_id: meeting.id,
          scheduled_for: scheduled_for,
          google_event_id: googleEventId,
        },
      } as any);
    if (eventErr) throw eventErr;

    // 6. Schedule reminders delayed jobs via BullMQ
    // D-1 Reminder (24h before meeting)
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const targetTime = targetStart.getTime();

    if (targetTime - now > oneDayMs) {
      const delay = targetTime - oneDayMs - now;
      // Put a delayed job on notify queue
      const { createTenantQueue } = await import('../lib/queue.js');
      const reminderQueue = createTenantQueue(tenant_id, 'send-notification');
      await reminderQueue.add(
        'reminder-d1',
        {
          tenant_id,
          lead_id,
          meeting_id: meeting.id,
          type: 'meeting_reminder_24h',
        },
        { delay }
      );
    }

    // 1h Reminder (1h before meeting)
    const oneHourMs = 60 * 60 * 1000;
    if (targetTime - now > oneHourMs) {
      const delay = targetTime - oneHourMs - now;
      const { createTenantQueue } = await import('../lib/queue.js');
      const reminderQueue = createTenantQueue(tenant_id, 'send-notification');
      await reminderQueue.add(
        'reminder-h1',
        {
          tenant_id,
          lead_id,
          meeting_id: meeting.id,
          type: 'meeting_reminder_1h',
        },
        { delay }
      );
    }

    return {
      success: true,
      meeting_id: meeting.id,
      google_event_id: googleEventId,
    };
  }
}
