/**
 * Admin Performance Analytics — Cross-tenant KPIs and trends.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /performance/overview    · KPIs globais agregados
 *  - GET /performance/trends      · Tendências mensais (últimos 6 meses)
 *  - GET /performance/ranking     · Ranking de tenants por performance
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
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
   * GET /performance/overview — Global KPIs
   */
  app.get('/performance/overview', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = overviewQuerySchema.parse(req.query);
      const tenantFilter = query.tenantId ? { tenantId: query.tenantId } : {};

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalLeads,
        leadsToday,
        leadsWeek,
        leadsMonth,
        leadsByStatus,
        totalMeetings,
        meetingsHappened,
        meetingsNoShow,
        meetingsClosedWon,
        revenueAgg,
        totalConversations,
        escalatedConversations,
        avgMessagesResult,
        activeCampaigns,
        totalTenants,
      ] = await Promise.all([
        // Lead counts
        prisma.lead.count({ where: tenantFilter }),
        prisma.lead.count({ where: { ...tenantFilter, createdAt: { gte: todayStart } } }),
        prisma.lead.count({ where: { ...tenantFilter, createdAt: { gte: weekStart } } }),
        prisma.lead.count({ where: { ...tenantFilter, createdAt: { gte: monthStart } } }),

        // Leads by key status
        prisma.lead.groupBy({
          by: ['status'],
          where: tenantFilter,
          _count: { id: true },
        }),

        // Meeting counts
        prisma.meeting.count({ where: tenantFilter }),
        prisma.meeting.count({ where: { ...tenantFilter, status: 'HAPPENED' } }),
        prisma.meeting.count({ where: { ...tenantFilter, status: 'NO_SHOW' } }),
        prisma.meeting.count({
          where: { ...tenantFilter, status: 'HAPPENED', outcome: 'CLOSED' },
        }),

        // Revenue
        prisma.meeting.aggregate({
          where: { ...tenantFilter, status: 'HAPPENED', outcome: 'CLOSED' },
          _sum: { policyValueCents: true, commissionCents: true },
        }),

        // Conversations
        prisma.conversation.count({ where: tenantFilter }),
        prisma.conversation.count({ where: { ...tenantFilter, status: 'ESCALATED' } }),

        // Avg messages per conversation
        prisma.message.groupBy({
          by: ['conversationId'],
          where: tenantFilter as any,
          _count: { id: true },
        }).then((groups) => {
          if (groups.length === 0) return 0;
          const total = groups.reduce((sum, g) => sum + g._count.id, 0);
          return Math.round(total / groups.length * 10) / 10;
        }),

        // Active campaigns
        prisma.campaign.count({ where: { ...tenantFilter, status: 'ACTIVE' } }),

        // Tenants count
        prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      ]);

      // Derived metrics
      const statusMap: Record<string, number> = {};
      for (const s of leadsByStatus) {
        statusMap[s.status] = s._count.id;
      }

      const captured = statusMap['CAPTURED'] ?? 0;
      const contacted = statusMap['CONTACTED'] ?? 0;
      const conversing = statusMap['CONVERSING'] ?? 0;
      const qualified = statusMap['QUALIFIED'] ?? 0;
      const meetingScheduled = statusMap['MEETING_SCHEDULED'] ?? 0;
      const closedWon = statusMap['CLOSED_WON'] ?? 0;

      const overallConversionRate = totalLeads > 0
        ? Math.round((closedWon / totalLeads) * 10000) / 100
        : 0;

      const contactRate = captured > 0
        ? Math.round((contacted / captured) * 10000) / 100
        : 0;

      const qualificationRate = conversing > 0
        ? Math.round((qualified / conversing) * 10000) / 100
        : 0;

      const closeRate = meetingScheduled > 0
        ? Math.round((closedWon / meetingScheduled) * 10000) / 100
        : 0;

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
            policyValueCents: revenueAgg._sum.policyValueCents ?? 0,
            commissionCents: revenueAgg._sum.commissionCents ?? 0,
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
   * GET /performance/trends — Monthly trends (last N months)
   */
  app.get('/performance/trends', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = trendsQuerySchema.parse(req.query);
      const tenantFilter = query.tenantId ? `AND tu.tenant_id = '${query.tenantId}'` : '';

      // Use TenantUsage for monthly aggregation (denormalized, fast)
      const rows = await prisma.$queryRawUnsafe<Array<{
        period: string;
        leads_captured: bigint;
        conversations_started: bigint;
        meetings_scheduled: bigint;
        meetings_closed: bigint;
        llm_cost_cents: bigint;
        whatsapp_cost_cents: bigint;
        maps_cost_cents: bigint;
        whatsapp_sent: bigint;
        active_tenants: bigint;
      }>>(`
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
      `);

      const trends = rows.map((r) => ({
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
   * GET /performance/ranking — Tenant ranking
   */
  app.get('/performance/ranking', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = rankingQuerySchema.parse(req.query);

      const rows = await prisma.$queryRawUnsafe<Array<{
        tenant_id: string;
        tenant_name: string;
        total_leads: bigint;
        contacted: bigint;
        conversing: bigint;
        qualified: bigint;
        meeting_scheduled: bigint;
        closed_won: bigint;
        closed_lost: bigint;
        total_meetings: bigint;
        meetings_happened: bigint;
        meetings_no_show: bigint;
        revenue_cents: bigint;
        commission_cents: bigint;
      }>>(`
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
        ORDER BY ${
          query.sortBy === 'leads' ? 'total_leads' :
          query.sortBy === 'meetings' ? 'total_meetings' :
          query.sortBy === 'closedWon' ? 'closed_won' :
          query.sortBy === 'revenue' ? 'revenue_cents' :
          'closed_won'  // conversion sorts by closed_won as proxy
        } DESC
        LIMIT ${query.limit}
      `);

      const ranking = rows.map((r, idx) => {
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
