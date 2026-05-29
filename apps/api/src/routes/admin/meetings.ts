/**
 * Endpoints admin para Meetings / Agenda (Reuniões).
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /meetings       · lista reuniões cross-tenant com filtros, paginação e includes
 *  - GET /meetings/stats · estatísticas: hoje/semana/mês, por status, por outcome, no-show rate, receita, top tenants
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Enums & Query schemas                                               */
/* ------------------------------------------------------------------ */

const MeetingStatusEnum = z.enum([
  'SCHEDULED',
  'CONFIRMED',
  'HAPPENED',
  'NO_SHOW',
  'RESCHEDULED',
  'CANCELLED',
]);

const meetingsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: MeetingStatusEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminMeetingsRoutes(app: FastifyInstance): void {
  /**
   * GET /meetings
   * Cross-tenant meeting listing with filters, pagination, and includes.
   */
  app.get('/meetings', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = meetingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId, status, from, to, limit, offset } = parsed.data;

    try {
      const where: Prisma.MeetingWhereInput = {};

      if (tenantId) {
        where.tenantId = tenantId;
      }
      if (status) {
        where.status = status;
      }
      if (from || to) {
        where.scheduledFor = {};
        if (from) where.scheduledFor.gte = from;
        if (to) where.scheduledFor.lte = to;
      }

      const [items, total] = await Promise.all([
        prisma.meeting.findMany({
          where,
          orderBy: { scheduledFor: 'desc' },
          take: limit,
          skip: offset,
          include: {
            tenant: {
              select: { id: true, name: true, slug: true },
            },
            lead: {
              select: { id: true, name: true, whatsapp: true, profession: true },
            },
          },
        }),
        prisma.meeting.count({ where }),
      ]);

      return reply.send({
        data: {
          items: items.map((m) => ({
            id: m.id,
            tenantId: m.tenantId,
            tenantName: m.tenant?.name ?? null,
            tenantSlug: m.tenant?.slug ?? null,
            leadId: m.leadId,
            leadName: m.lead?.name ?? null,
            leadWhatsapp: m.lead?.whatsapp ?? null,
            leadProfession: m.lead?.profession ?? null,
            conversationId: m.conversationId,
            googleEventId: m.googleEventId,
            scheduledFor: m.scheduledFor.toISOString(),
            durationMinutes: m.durationMinutes,
            location: m.location,
            attendees: m.attendees,
            status: m.status,
            outcome: m.outcome,
            policyValueCents: m.policyValueCents,
            commissionCents: m.commissionCents,
            notes: m.notes,
            referralsCount: m.referralsCount,
            outcomeMarkedAt: m.outcomeMarkedAt?.toISOString() ?? null,
            createdAt: m.createdAt.toISOString(),
            updatedAt: m.updatedAt.toISOString(),
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/meetings · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar reuniões.' });
    }
  });

  /**
   * GET /meetings/stats
   * Meeting statistics: today/week/month counts, status breakdown, outcome breakdown,
   * no-show rate, revenue totals, top tenants.
   */
  app.get('/meetings/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const now = new Date();

      // Start of today (UTC)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

      // Start of 7 days ago
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Start of 30 days ago
      const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        meetingsToday,
        meetingsWeek,
        meetingsMonth,
        statusBreakdown,
        outcomeBreakdown,
        totalMeetingsForNoShow,
        noShowCount,
        revenueAgg,
        topTenants,
      ] = await Promise.all([
        // Meetings today
        prisma.meeting.count({
          where: { scheduledFor: { gte: startOfToday } },
        }),

        // Meetings this week (7d)
        prisma.meeting.count({
          where: { scheduledFor: { gte: startOfWeek } },
        }),

        // Meetings this month (30d)
        prisma.meeting.count({
          where: { scheduledFor: { gte: startOfMonth } },
        }),

        // By status breakdown
        prisma.meeting.groupBy({
          by: ['status'],
          _count: { id: true },
        }),

        // By outcome breakdown
        prisma.meeting.groupBy({
          by: ['outcome'],
          where: { outcome: { not: null } },
          _count: { id: true },
        }),

        // Total meetings (for no-show rate denominator)
        prisma.meeting.count(),

        // No-show count
        prisma.meeting.count({
          where: { status: 'NO_SHOW' },
        }),

        // Revenue aggregation for CLOSED outcomes
        prisma.meeting.aggregate({
          where: { outcome: 'CLOSED' },
          _sum: {
            policyValueCents: true,
            commissionCents: true,
          },
        }),

        // Top 5 tenants by meeting count
        prisma.$queryRaw<Array<{ tenant_id: string; tenant_name: string; meeting_count: bigint }>>`
          SELECT m."tenant_id" AS tenant_id, t."name" AS tenant_name, COUNT(m."id")::bigint AS meeting_count
          FROM meetings m
          JOIN tenants t ON m."tenant_id" = t."id"
          GROUP BY m."tenant_id", t."name"
          ORDER BY meeting_count DESC
          LIMIT 5
        `,
      ]);

      const noShowRate = totalMeetingsForNoShow > 0
        ? Math.round((noShowCount / totalMeetingsForNoShow) * 10000) / 100
        : 0;

      return reply.send({
        data: {
          meetingsToday,
          meetingsWeek,
          meetingsMonth,
          noShowRate,
          noShowCount,
          totalMeetings: totalMeetingsForNoShow,
          statusBreakdown: statusBreakdown.map((r) => ({
            status: r.status,
            count: r._count.id,
          })),
          outcomeBreakdown: outcomeBreakdown.map((r) => ({
            outcome: r.outcome,
            count: r._count.id,
          })),
          revenue: {
            totalPolicyValueCents: revenueAgg._sum.policyValueCents ?? 0,
            totalCommissionCents: revenueAgg._sum.commissionCents ?? 0,
          },
          topTenants: topTenants.map((r) => ({
            tenantId: r.tenant_id,
            tenantName: r.tenant_name,
            meetingCount: Number(r.meeting_count),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/meetings/stats · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de reuniões.' });
    }
  });
}
