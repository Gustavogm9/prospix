/**
 * Admin Performance Analytics - Cross-tenant KPIs and trends.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /performance/overview    → KPIs globais agregados
 *  - GET /performance/trends      → Tendências mensais (últimos 6 meses)
 *  - GET /performance/ranking     → Ranking de tenants por performance
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Query schemas                                                       */
/* ------------------------------------------------------------------ */

const overviewQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

const trendsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  months: z.coerce.number().int().min(1).max(24).optional().default(6),
});

const rankingQuerySchema = z.object({
  sortBy: z.enum(['leads', 'meetings', 'closedWon', 'revenue', 'conversion']).optional().default('leads'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminPerformanceRoutes(app: FastifyInstance): void {

  /**
   * GET /performance/overview - Global KPIs
   */
  app.get('/performance/overview', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = overviewQuerySchema.parse(req.query);
      const tenantId = query.tenantId;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Helper to add optional tenant filter
      const addTenantFilter = (q: any) => tenantId ? q.eq('tenant_id', tenantId) : q;

      const [
        totalLeadsRes,
        leadsTodayRes,
        leadsWeekRes,
        leadsMonthRes,
        totalMeetingsRes,
        meetingsHappenedRes,
        meetingsNoShowRes,
        meetingsClosedWonRes,
        totalConversationsRes,
        escalatedConversationsRes,
        activeCampaignsRes,
        totalTenantsRes,
      ] = await Promise.all([
        // Lead counts
        addTenantFilter(dbAdmin.from('leads').select('*', { count: 'exact', head: true })),
        addTenantFilter(dbAdmin.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString())),
        addTenantFilter(dbAdmin.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString())),
        addTenantFilter(dbAdmin.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString())),

        // Meeting counts
        addTenantFilter(dbAdmin.from('meetings').select('*', { count: 'exact', head: true })),
        addTenantFilter(dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).eq('status', 'HAPPENED')),
        addTenantFilter(dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).eq('status', 'NO_SHOW')),
        addTenantFilter(dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).eq('status', 'HAPPENED').eq('outcome', 'CLOSED')),

        // Conversations
        addTenantFilter(dbAdmin.from('conversations').select('*', { count: 'exact', head: true })),
        addTenantFilter(dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'ESCALATED')),

        // Active campaigns
        addTenantFilter(dbAdmin.from('campaigns').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE')),

        // Tenants count
        dbAdmin.from('tenants').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
      ]);

      const totalLeads = totalLeadsRes.count ?? 0;
      const leadsToday = leadsTodayRes.count ?? 0;
      const leadsWeek = leadsWeekRes.count ?? 0;
      const leadsMonth = leadsMonthRes.count ?? 0;
      const totalMeetings = totalMeetingsRes.count ?? 0;
      const meetingsHappened = meetingsHappenedRes.count ?? 0;
      const meetingsNoShow = meetingsNoShowRes.count ?? 0;
      const meetingsClosedWon = meetingsClosedWonRes.count ?? 0;
      const totalConversations = totalConversationsRes.count ?? 0;
      const escalatedConversations = escalatedConversationsRes.count ?? 0;
      const activeCampaigns = activeCampaignsRes.count ?? 0;
      const totalTenants = totalTenantsRes.count ?? 0;

      // Revenue aggregation
      const tenantRevenueFilter = tenantId ? `AND tenant_id = '${tenantId}'` : '';
      let revenueAgg: any = { policy_cents: 0, commission_cents: 0 };
      try {
        const { data: revenueRows } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT COALESCE(SUM(policy_value_cents), 0)::bigint AS policy_cents,
                   COALESCE(SUM(commission_cents), 0)::bigint AS commission_cents
            FROM meetings
            WHERE status = 'HAPPENED' AND outcome = 'CLOSED' ${tenantRevenueFilter}
          `,
        });
        revenueAgg = (revenueRows ?? [{ policy_cents: 0, commission_cents: 0 }])[0];
      } catch { /* ignore */ }

      // Leads by status (groupBy)
      let statusRows: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT status, COUNT(id)::bigint AS cnt FROM leads
            ${tenantId ? `WHERE tenant_id = '${tenantId}'` : ''}
            GROUP BY status
          `,
        });
        statusRows = data ?? [];
      } catch { /* ignore */ }

      // Avg messages per conversation
      let avgMessagesResult = 0;
      try {
        const { data: avgMsgRows } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT ROUND(AVG(msg_count)::numeric, 1) AS avg_messages
            FROM (
              SELECT conversation_id, COUNT(id) AS msg_count
              FROM messages
              ${tenantId ? `WHERE tenant_id = '${tenantId}'` : ''}
              GROUP BY conversation_id
            ) sub
          `,
        });
        avgMessagesResult = Number((avgMsgRows ?? [{ avg_messages: 0 }])[0]?.avg_messages ?? 0);
      } catch { /* ignore */ }

      // Derived metrics
      const statusMap: Record<string, number> = {};
      for (const s of statusRows) {
        statusMap[s.status] = Number(s.cnt);
      }

      const captured = statusMap['CAPTURED'] ?? 0;
      const contacted = statusMap['CONTACTED'] ?? 0;
      const conversing = statusMap['CONVERSING'] ?? 0;
      const qualified = statusMap['QUALIFIED'] ?? 0;
      const meetingScheduled = statusMap['MEETING_SCHEDULED'] ?? 0;
      const closedWon = statusMap['CLOSED_WON'] ?? 0;

      const overallConversionRate = totalLeads > 0 ? Math.round((closedWon / totalLeads) * 10000) / 100 : 0;
      const contactRate = captured > 0 ? Math.round((contacted / captured) * 10000) / 100 : 0;
      const qualificationRate = conversing > 0 ? Math.round((qualified / conversing) * 10000) / 100 : 0;
      const closeRate = meetingScheduled > 0 ? Math.round((closedWon / meetingScheduled) * 10000) / 100 : 0;
      const noShowRate = (meetingsHappened + meetingsNoShow) > 0
        ? Math.round((meetingsNoShow / (meetingsHappened + meetingsNoShow)) * 10000) / 100
        : 0;
      const escalationRate = totalConversations > 0
        ? Math.round((escalatedConversations / totalConversations) * 10000) / 100
        : 0;

      return reply.send({
        data: {
          leads: {
            total: totalLeads,
            today: leadsToday,
            week: leadsWeek,
            month: leadsMonth,
            captured,
            contacted,
            conversing,
            qualified,
            meetingScheduled,
            closedWon,
          },
          meetings: {
            total: totalMeetings,
            happened: meetingsHappened,
            noShow: meetingsNoShow,
            closedWon: meetingsClosedWon,
            noShowRate,
          },
          revenue: {
            policyValueCents: Number(revenueAgg.policy_cents ?? 0),
            commissionCents: Number(revenueAgg.commission_cents ?? 0),
          },
          conversations: {
            total: totalConversations,
            escalated: escalatedConversations,
            escalationRate,
            avgMessages: avgMessagesResult,
          },
          campaigns: {
            active: activeCampaigns,
          },
          rates: {
            overallConversion: overallConversionRate,
            contactRate,
            qualificationRate,
            closeRate,
          },
          tenants: {
            active: totalTenants,
          },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin:performance:overview failed');
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Falha ao carregar overview de performance.' });
    }
  });

  /**
   * GET /performance/trends - Monthly trends (last N months)
   */
  app.get('/performance/trends', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = trendsQuerySchema.parse(req.query);
      const tenantFilter = query.tenantId ? `AND tu.tenant_id = '${query.tenantId}'` : '';

      const { data: rows, error } = await dbAdmin.rpc('exec_sql' as any, {
        query: `
          SELECT
            TO_CHAR(tu.period_month, 'YYYY-MM') AS period,
            COALESCE(SUM(tu.leads_captured_count), 0) AS leads_captured,
            COALESCE(SUM(tu.conversations_started), 0) AS conversations_started,
            COALESCE(SUM(tu.meetings_scheduled), 0) AS meetings_scheduled,
            COALESCE(SUM(tu.meetings_closed), 0) AS meetings_closed,
            COALESCE(SUM(tu.llm_cost_cents), 0) AS llm_cost_cents,
            COALESCE(SUM(tu.whatsapp_cost_cents), 0) AS whatsapp_cost_cents,
            COALESCE(SUM(tu.google_maps_cost_cents), 0) AS maps_cost_cents,
            COALESCE(SUM(tu.whatsapp_messages_sent), 0) AS whatsapp_sent,
            COUNT(DISTINCT tu.tenant_id) AS active_tenants
          FROM tenant_usage tu
          WHERE tu.period_month >= DATE_TRUNC('month', NOW()) - INTERVAL '${query.months} months'
            ${tenantFilter}
          GROUP BY tu.period_month
          ORDER BY tu.period_month ASC
        `,
      });
      if (error) throw error;

      const trends = (rows ?? []).map((r: any) => ({
        period: r.period,
        leadsCaptured: Number(r.leads_captured),
        conversationsStarted: Number(r.conversations_started),
        meetingsScheduled: Number(r.meetings_scheduled),
        meetingsClosed: Number(r.meetings_closed),
        llmCostCents: Number(r.llm_cost_cents),
        whatsappCostCents: Number(r.whatsapp_cost_cents),
        mapsCostCents: Number(r.maps_cost_cents),
        totalCostCents: Number(r.llm_cost_cents) + Number(r.whatsapp_cost_cents) + Number(r.maps_cost_cents),
        whatsappSent: Number(r.whatsapp_sent),
        activeTenants: Number(r.active_tenants),
        conversionRate: Number(r.leads_captured) > 0
          ? Math.round((Number(r.meetings_closed) / Number(r.leads_captured)) * 10000) / 100
          : 0,
      }));

      return reply.send({ data: { trends } });
    } catch (err) {
      logger.error({ err }, 'admin:performance:trends failed');
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Falha ao carregar tendências.' });
    }
  });

  /**
   * GET /performance/ranking - Tenant ranking
   */
  app.get('/performance/ranking', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = rankingQuerySchema.parse(req.query);

      const orderCol =
        query.sortBy === 'leads' ? 'total_leads' :
        query.sortBy === 'meetings' ? 'total_meetings' :
        query.sortBy === 'closedWon' ? 'closed_won' :
        query.sortBy === 'revenue' ? 'revenue_cents' :
        'closed_won';

      const { data: rows, error } = await dbAdmin.rpc('exec_sql' as any, {
        query: `
          SELECT
            t.id AS tenant_id,
            t.name AS tenant_name,
            COUNT(DISTINCT l.id) AS total_leads,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CONTACTED') AS contacted,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CONVERSING') AS conversing,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'QUALIFIED') AS qualified,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'MEETING_SCHEDULED') AS meeting_scheduled,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CLOSED_WON') AS closed_won,
            COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CLOSED_LOST') AS closed_lost,
            COUNT(DISTINCT m.id) AS total_meetings,
            COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'HAPPENED') AS meetings_happened,
            COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'NO_SHOW') AS meetings_no_show,
            COALESCE(SUM(m.policy_value_cents) FILTER (WHERE m.outcome = 'CLOSED'), 0) AS revenue_cents,
            COALESCE(SUM(m.commission_cents) FILTER (WHERE m.outcome = 'CLOSED'), 0) AS commission_cents
          FROM tenants t
          LEFT JOIN leads l ON l.tenant_id = t.id
          LEFT JOIN meetings m ON m.tenant_id = t.id
          WHERE t.status = 'ACTIVE'
          GROUP BY t.id, t.name
          HAVING COUNT(DISTINCT l.id) > 0
          ORDER BY ${orderCol} DESC
          LIMIT ${query.limit}
        `,
      });
      if (error) throw error;

      const ranking = (rows ?? []).map((r: any, idx: number) => {
        const totalLeads = Number(r.total_leads);
        const closedWon = Number(r.closed_won);
        return {
          rank: idx + 1,
          tenantId: r.tenant_id,
          tenantName: r.tenant_name,
          totalLeads,
          contacted: Number(r.contacted),
          conversing: Number(r.conversing),
          qualified: Number(r.qualified),
          meetingScheduled: Number(r.meeting_scheduled),
          closedWon,
          closedLost: Number(r.closed_lost),
          totalMeetings: Number(r.total_meetings),
          meetingsHappened: Number(r.meetings_happened),
          meetingsNoShow: Number(r.meetings_no_show),
          revenueCents: Number(r.revenue_cents),
          commissionCents: Number(r.commission_cents),
          conversionRate: totalLeads > 0 ? Math.round((closedWon / totalLeads) * 10000) / 100 : 0,
          noShowRate: (Number(r.meetings_happened) + Number(r.meetings_no_show)) > 0
            ? Math.round((Number(r.meetings_no_show) / (Number(r.meetings_happened) + Number(r.meetings_no_show))) * 10000) / 100
            : 0,
        };
      });

      return reply.send({ data: { ranking } });
    } catch (err) {
      logger.error({ err }, 'admin:performance:ranking failed');
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Falha ao carregar ranking.' });
    }
  });
}
