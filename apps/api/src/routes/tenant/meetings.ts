import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { MeetingStatus, MeetingOutcome, LeadStatus } from '@prisma/client';
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
    const meetings = await prisma.meeting.findMany({
      where: { tenantId: req.tenantId! },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            email: true,
            whatsapp: true,
          },
        },
      },
      orderBy: { scheduledFor: 'desc' },
    });
    return reply.send({ data: meetings });
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
    const parseRes = updateOutcomeSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const { outcome, policy_value_cents, commission_cents, status } = parseRes.data;

    // Find meeting ensuring it belongs to the active tenant
    const meeting = await prisma.meeting.findFirst({
      where: { id, tenantId: req.tenantId! },
    });

    if (!meeting) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Meeting not found' });
    }

    // Update meeting details
    const updatedMeeting = await prisma.$transaction(async (tx) => {
      const updated = await tx.meeting.update({
        where: { id },
        data: {
          outcome,
          policyValueCents: policy_value_cents,
          commissionCents: commission_cents,
          status: status || (outcome ? MeetingStatus.HAPPENED : undefined),
        },
      });

      // If marked as CLOSED (CLOSED_WON), update the associated lead status
      if (outcome === MeetingOutcome.CLOSED) {
        await tx.lead.update({
          where: { id: meeting.leadId },
          data: {
            status: LeadStatus.CLOSED_WON,
            closedAt: new Date(),
          },
        });

        // Track event
        await tx.leadEvent.create({
          data: {
            tenantId: req.tenantId!,
            leadId: meeting.leadId,
            eventType: 'sale_closed',
            actorId: req.userId || undefined,
            payload: {
              description: `Venda fechada com sucesso! Valor da apólice: R$ ${(policy_value_cents || 0) / 100}, Comissão: R$ ${(commission_cents || 0) / 100}`,
              policy_value_cents,
              commission_cents,
            },
          },
        });
      } else if (status === MeetingStatus.NO_SHOW) {
        // Track no-show event
        await tx.leadEvent.create({
          data: {
            tenantId: req.tenantId!,
            leadId: meeting.leadId,
            eventType: 'meeting_no_show',
            actorId: req.userId || undefined,
            payload: {
              description: 'Lead não compareceu à reunião agendada.',
            },
          },
        });
      }

      return updated;
    });

    logger.info({ meetingId: id, outcome }, 'Meeting outcome updated successfully');
    return reply.send({ data: updatedMeeting });
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

    // Fetch existing meeting
    const oldMeeting = await prisma.meeting.findFirst({
      where: { id: meetingId, tenantId: req.tenantId! },
    });

    if (!oldMeeting) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Original meeting not found' });
    }

    // atomic transaction to cancel old and clone into new
    const result = await prisma.$transaction(async (tx) => {
      // 1. Cancel old meeting
      await tx.meeting.update({
        where: { id: oldMeeting.id },
        data: {
          status: MeetingStatus.CANCELLED,
        },
      });

      // 2. Clone new linked meeting
      const newMeeting = await tx.meeting.create({
        data: {
          tenantId: req.tenantId!,
          leadId: oldMeeting.leadId,
          googleEventId: null, // to be populated by worker/integrations
          scheduledFor: new Date(newTime),
          durationMinutes: oldMeeting.durationMinutes,
          location: oldMeeting.location,
          status: MeetingStatus.SCHEDULED,
          outcome: null,
          rescheduledFromId: oldMeeting.id,
        },
      });

      // 3. Register lead event
      await tx.leadEvent.create({
        data: {
          tenantId: req.tenantId!,
          leadId: oldMeeting.leadId,
          eventType: 'meeting_rescheduled',
          actorId: req.userId || undefined,
          payload: {
            description: `Reunião remarcada de ${oldMeeting.scheduledFor.toISOString()} para ${newMeeting.scheduledFor.toISOString()}`,
            old_meeting_id: oldMeeting.id,
            new_meeting_id: newMeeting.id,
          },
        },
      });

      return newMeeting;
    });

    // Enqueue the schedule-meeting worker to handle calendar scheduling and notification
    const meetingQueue = createTenantQueue(req.tenantId!, 'schedule-meeting');
    await meetingQueue.add('reschedule-sync', {
      tenant_id: req.tenantId!,
      lead_id: oldMeeting.leadId,
      meeting_id: result.id,
      rescheduled_from: oldMeeting.id,
    });

    logger.info({ oldMeetingId: oldMeeting.id, newMeetingId: result.id }, 'Meeting rescheduled successfully');
    return reply.code(201).send({ data: result });
  });
};

export default meetingsRoutes;
