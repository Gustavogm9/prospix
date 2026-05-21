import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { createEvent, listEvents } from '../integrations/google-calendar.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { LeadStatus, MeetingStatus } from '@prisma/client';

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
    const lead = await prisma.lead.findUnique({
      where: { id: lead_id },
    });

    if (!lead || lead.tenantId !== tenant_id) {
      throw new Error(`Lead ${lead_id} not found or tenant mismatch`);
    }

    // 2. Fetch Tenant Secrets & Calendar Config
    const secrets = await getDecryptedSecrets(tenant_id);
    const secretRecord = await prisma.tenantSecret.findUnique({
      where: { tenantId: tenant_id },
    });

    if (!secrets?.googleOauthRefresh || !secretRecord?.googleCalendarId) {
      logger.warn({ tenant_id, lead_id }, 'Google Calendar integration not fully configured for this tenant');
      return { success: false, conflict: false };
    }

    const calendarId = secretRecord.googleCalendarId;
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

      // Conflict condition with 15m buffer:
      // An event conflicts if its window overlapping target window including buffers:
      // targetStart - 15m < evtEnd AND targetEnd + 15m > evtStart
      return targetStart.getTime() - bufferMs < evtEnd && targetEnd.getTime() + bufferMs > evtStart;
    });

    if (hasConflict) {
      logger.info({ tenant_id, lead_id, scheduled_for }, 'Time slot conflict detected. Proposing alternatives.');

      // Propose 2 alternatives
      // Alt 1: 15 mins after the latest end time among conflicting events
      // Alt 2: 1 hour after Alt 1 (or next day if out of business hours 9-18)
      const alternatives: string[] = [];
      let potentialStart = new Date(targetStart.getTime());

      // Simple heuristic: search forward in steps of 30 mins until finding slots
      while (alternatives.length < 2) {
        potentialStart = new Date(potentialStart.getTime() + 30 * 60 * 1000);
        const potEnd = new Date(potentialStart.getTime() + duration * 60 * 1000);

        // Keep inside business hours (9:00 to 18:00 tenant local time)
        const hour = potentialStart.getHours();
        if (hour < 9 || hour >= 18) {
          // Adjust to next day 9:00
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
    const meeting = await prisma.meeting.create({
      data: {
        tenantId: tenant_id,
        leadId: lead_id,
        googleEventId,
        scheduledFor: targetStart,
        durationMinutes: duration,
        location: location || 'Google Meet',
        status: MeetingStatus.SCHEDULED,
      },
    });

    await prisma.lead.update({
      where: { id: lead_id },
      data: { status: LeadStatus.MEETING_SCHEDULED },
    });

    await prisma.leadEvent.create({
      data: {
        tenantId: tenant_id,
        leadId: lead_id,
        eventType: 'meeting.scheduled',
        payload: {
          meeting_id: meeting.id,
          scheduled_for: scheduled_for,
          google_event_id: googleEventId,
        },
      },
    });

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
