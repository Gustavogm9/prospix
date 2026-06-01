/**
 * Endpoints admin para Meetings Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /meetings       → lista reuniões cross-tenant com filtros, paginação e includes
 *  - GET /meetings/stats → estatísticas: hoje/semana/mês, por status, por outcome, no-show rate, receita, top tenants
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
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
      let query = dbAdmin
        .from('meetings')
        .select('*, tenants(id, name, slug), leads(id, name, whatsapp, profession)')
        .order('scheduled_for', { ascending: false })
        .range(offset, offset + limit - 1);

      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (status) query = query.eq('status', status);
      if (from) query = query.gte('scheduled_for', from.toISOString());
      if (to) query = query.lte('scheduled_for', to.toISOString());

      const { data: items, error } = await query;
      if (error) throw error;

      // Count
      let countQuery = dbAdmin.from('meetings').select('*', { count: 'exact', head: true });
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (status) countQuery = countQuery.eq('status', status);
      if (from) countQuery = countQuery.gte('scheduled_for', from.toISOString());
      if (to) countQuery = countQuery.lte('scheduled_for', to.toISOString());

      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      return reply.send({
        data: {
          items: (items ?? []).map((m: any) => ({
            id: m.id,
            tenantId: m.tenant_id,
            tenantName: m.tenants?.name ?? null,
            tenantSlug: m.tenants?.slug ?? null,
            leadId: m.lead_id,
            leadName: m.leads?.name ?? null,
            leadWhatsapp: m.leads?.whatsapp ?? null,
            leadProfession: m.leads?.profession ?? null,
            conversationId: m.conversation_id,
            googleEventId: m.google_event_id,
            scheduledFor: m.scheduled_for,
            durationMinutes: m.duration_minutes,
            location: m.location,
            attendees: m.attendees,
            status: m.status,
            outcome: m.outcome,
            policyValueCents: m.policy_value_cents,
            commissionCents: m.commission_cents,
            notes: m.notes,
            referralsCount: m.referrals_count,
            outcomeMarkedAt: m.outcome_marked_at ?? null,
            createdAt: m.created_at,
            updatedAt: m.updated_at,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/meetings → GET failed');
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
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        meetingsTodayRes,
        meetingsWeekRes,
        meetingsMonthRes,
        totalMeetingsRes,
        noShowCountRes,
      ] = await Promise.all([
        dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).gte('scheduled_for', startOfToday.toISOString()),
        dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).gte('scheduled_for', startOfWeek.toISOString()),
        dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).gte('scheduled_for', startOfMonth.toISOString()),
        dbAdmin.from('meetings').select('*', { count: 'exact', head: true }),
        dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).eq('status', 'NO_SHOW'),
      ]);

      // Status breakdown
      let statusBreakdownRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `SELECT status, COUNT(id)::bigint AS cnt FROM meetings GROUP BY status`,
        });
        statusBreakdownRaw = data ?? [];
      } catch { /* ignore */ }

      // Outcome breakdown
      let outcomeBreakdownRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `SELECT outcome, COUNT(id)::bigint AS cnt FROM meetings WHERE outcome IS NOT NULL GROUP BY outcome`,
        });
        outcomeBreakdownRaw = data ?? [];
      } catch { /* ignore */ }

      // Revenue aggregation for CLOSED outcomes
      let revenueRaw: any[] = [{ total_policy: 0, total_commission: 0 }];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT COALESCE(SUM(policy_value_cents), 0)::bigint AS total_policy,
                   COALESCE(SUM(commission_cents), 0)::bigint AS total_commission
            FROM meetings WHERE outcome = 'CLOSED'
          `,
        });
        revenueRaw = data ?? [{ total_policy: 0, total_commission: 0 }];
      } catch { /* ignore */ }

      // Top 5 tenants by meeting count
      let topTenantsRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT m.tenant_id AS tenant_id, t.name AS tenant_name, COUNT(m.id)::bigint AS meeting_count
            FROM meetings m
            JOIN tenants t ON m.tenant_id = t.id
            GROUP BY m.tenant_id, t.name
            ORDER BY meeting_count DESC
            LIMIT 5
          `,
        });
        topTenantsRaw = data ?? [];
      } catch { /* ignore */ }

      const totalMeetingsForNoShow = totalMeetingsRes.count ?? 0;
      const noShowCount = noShowCountRes.count ?? 0;
      const noShowRate = totalMeetingsForNoShow > 0
        ? Math.round((noShowCount / totalMeetingsForNoShow) * 10000) / 100
        : 0;

      const rev = revenueRaw[0];

      return reply.send({
        data: {
          meetingsToday: meetingsTodayRes.count ?? 0,
          meetingsWeek: meetingsWeekRes.count ?? 0,
          meetingsMonth: meetingsMonthRes.count ?? 0,
          noShowRate,
          noShowCount,
          totalMeetings: totalMeetingsForNoShow,
          statusBreakdown: statusBreakdownRaw.map((r: any) => ({
            status: r.status,
            count: Number(r.cnt),
          })),
          outcomeBreakdown: outcomeBreakdownRaw.map((r: any) => ({
            outcome: r.outcome,
            count: Number(r.cnt),
          })),
          revenue: {
            totalPolicyValueCents: Number(rev.total_policy ?? 0),
            totalCommissionCents: Number(rev.total_commission ?? 0),
          },
          topTenants: topTenantsRaw.map((r: any) => ({
            tenantId: r.tenant_id,
            tenantName: r.tenant_name,
            meetingCount: Number(r.meeting_count),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/meetings/stats → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de reuniões.' });
    }
  });
}
