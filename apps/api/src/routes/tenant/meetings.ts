import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { MeetingStatus, MeetingOutcome, LeadStatus } from '@prospix/shared-types';
import { createTenantQueue } from '../../lib/queue.js';

export const meetingsRoutes: FastifyPluginAsync = async (app) => {
  // Enforce tenant context
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }
  });

  // GET /v1/tenant/meetings - List meetings for the active tenant
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(req);
    const { data: meetings, error } = await db
      .from('meetings')
      .select('*, leads(id, name, email, whatsapp)')
      .eq('tenant_id', req.tenantId!)
      .order('scheduled_for', { ascending: false })
      .limit(100);

    if (error) throw error;
    return reply.send({ data: meetings });
  });

  // POST /v1/tenant/meetings - Create a manual meeting for a lead
  const createMeetingSchema = z.object({
    leadId: z.string().uuid('Invalid lead ID format'),
    scheduledFor: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(240).default(30),
    location: z.string().trim().max(500).optional(),
  });

  app.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseRes = createMeetingSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const tenantId = req.tenantId!;
    const db = getDb(req);
    const { leadId, durationMinutes, location } = parseRes.data;
    const scheduledFor = parseRes.data.scheduledFor;

    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (leadErr) throw leadErr;

    if (!lead) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Lead not found' });
    }

    const { data: conflictingMeeting } = await db
      .from('meetings')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('scheduled_for', scheduledFor)
      .in('status', [MeetingStatus.SCHEDULED, MeetingStatus.CONFIRMED])
      .maybeSingle();

    if (conflictingMeeting) {
      return reply.code(409).send({ error: 'SCHEDULE_CONFLICT', message: 'There is already a meeting at this time' });
    }

    // Sequential instead of $transaction
    const meetingId = crypto.randomUUID();
    const { data: created, error: createErr } = await db
      .from('meetings')
      .insert({
        id: meetingId,
        tenant_id: tenantId,
        lead_id: leadId,
        scheduled_for: scheduledFor,
        duration_minutes: durationMinutes,
        location: location || null,
        status: MeetingStatus.SCHEDULED,
        updated_at: new Date().toISOString(),
      })
      .select('*, leads(id, name, email, whatsapp)')
      .single();

    if (createErr) throw createErr;

    await db
      .from('leads')
      .update({ status: LeadStatus.MEETING_SCHEDULED, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    await db
      .from('lead_events')
      .insert({
        tenant_id: tenantId,
        lead_id: leadId,
        event_type: 'meeting_scheduled',
        actor_id: req.userId || undefined,
        payload: {
          meeting_id: created.id,
          scheduled_for: scheduledFor,
          source: 'manual',
        },
      });

    const meetingQueue = createTenantQueue(tenantId, 'schedule-meeting');
    await meetingQueue.add('manual-schedule-sync', {
      tenant_id: tenantId,
      lead_id: leadId,
      meeting_id: created.id,
    });

    logger.info({ meetingId: created.id, leadId }, 'Meeting scheduled manually');
    return reply.code(201).send({ data: created });
  });

  // PATCH /v1/tenant/meetings/:id - Update meeting outcome, goals and commissions
  const updateOutcomeSchema = z.object({
    outcome: z.nativeEnum(MeetingOutcome).optional(),
    policy_value_cents: z.number().int().nonnegative().optional(),
    commission_cents: z.number().int().nonnegative().optional(),
    status: z.nativeEnum(MeetingStatus).optional(),
  });

  app.patch('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db = getDb(req);
    const parseRes = updateOutcomeSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const { outcome, policy_value_cents, commission_cents, status } = parseRes.data;

    // Find meeting ensuring it belongs to the active tenant
    const { data: meeting, error: findErr } = await db
      .from('meetings')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId!)
      .maybeSingle();

    if (findErr) throw findErr;

    if (!meeting) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Meeting not found' });
    }

    // Sequential instead of $transaction
    const { data: updated, error: updateErr } = await db
      .from('meetings')
      .update({
        outcome,
        policy_value_cents,
        commission_cents,
        status: status || (outcome ? MeetingStatus.HAPPENED : undefined),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // If marked as CLOSED (CLOSED_WON), update the associated lead status
    if (outcome === MeetingOutcome.CLOSED) {
      await db
        .from('leads')
        .update({
          status: LeadStatus.CLOSED_WON,
          closed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', meeting.lead_id);

      // Track event
      await db
        .from('lead_events')
        .insert({
          tenant_id: req.tenantId!,
          lead_id: meeting.lead_id,
          event_type: 'sale_closed',
          actor_id: req.userId || undefined,
          payload: {
            description: `Venda fechada com sucesso! Valor da apólice: R$ ${(policy_value_cents || 0) / 100}, Comissão: R$ ${(commission_cents || 0) / 100}`,
            policy_value_cents,
            commission_cents,
          },
        });
    } else if (status === MeetingStatus.NO_SHOW) {
      // Track no-show event
      await db
        .from('lead_events')
        .insert({
          tenant_id: req.tenantId!,
          lead_id: meeting.lead_id,
          event_type: 'meeting_no_show',
          actor_id: req.userId || undefined,
          payload: {
            description: 'Lead não compareceu à reunião agendada.',
          },
        });
    }

    logger.info({ meetingId: id, outcome }, 'Meeting outcome updated successfully');
    return reply.send({ data: updated });
  });

  // POST /v1/tenant/meetings/reschedule - Reschedule meeting with linked clone
  const rescheduleSchema = z.object({
    meetingId: z.string().uuid(),
    newTime: z.string().datetime(),
  });

  app.post('/reschedule', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseRes = rescheduleSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const { meetingId, newTime } = parseRes.data;
    const db = getDb(req);

    // Fetch existing meeting
    const { data: oldMeeting, error: findErr } = await db
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('tenant_id', req.tenantId!)
      .maybeSingle();

    if (findErr) throw findErr;

    if (!oldMeeting) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Original meeting not found' });
    }

    // Sequential instead of atomic $transaction
    // 1. Cancel old meeting
    await db
      .from('meetings')
      .update({
        status: MeetingStatus.CANCELLED,
        updated_at: new Date().toISOString(),
      })
      .eq('id', oldMeeting.id);

    // 2. Clone new linked meeting
    const newMeetingId = crypto.randomUUID();
    const { data: newMeeting, error: createErr } = await db
      .from('meetings')
      .insert({
        id: newMeetingId,
        tenant_id: req.tenantId!,
        lead_id: oldMeeting.lead_id,
        google_event_id: null,
        scheduled_for: newTime,
        duration_minutes: oldMeeting.duration_minutes,
        location: oldMeeting.location,
        status: MeetingStatus.SCHEDULED,
        outcome: null,
        rescheduled_from_id: oldMeeting.id,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createErr) throw createErr;

    // 3. Register lead event
    await db
      .from('lead_events')
      .insert({
        tenant_id: req.tenantId!,
        lead_id: oldMeeting.lead_id,
        event_type: 'meeting_rescheduled',
        actor_id: req.userId || undefined,
        payload: {
          description: `Reunião remarcada de ${oldMeeting.scheduled_for} para ${newTime}`,
          old_meeting_id: oldMeeting.id,
          new_meeting_id: newMeeting.id,
        },
      });

    // Enqueue the schedule-meeting worker to handle calendar scheduling and notification
    const meetingQueue = createTenantQueue(req.tenantId!, 'schedule-meeting');
    await meetingQueue.add('reschedule-sync', {
      tenant_id: req.tenantId!,
      lead_id: oldMeeting.lead_id,
      meeting_id: newMeeting.id,
      rescheduled_from: oldMeeting.id,
    });

    logger.info({ oldMeetingId: oldMeeting.id, newMeetingId: newMeeting.id }, 'Meeting rescheduled successfully');
    return reply.code(201).send({ data: newMeeting });
  });
};

export default meetingsRoutes;
