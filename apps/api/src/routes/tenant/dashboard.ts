import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { MeetingStatus, LeadStatus, ConversationStatus, MeetingOutcome } from '@prisma/client';
import { getAIPlanLimitCents } from '../../ai/quota.js';

// Helper SWR function
async function withSWR<T>(
  cacheKey: string,
  freshTTLSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await redis.get(cacheKey);

  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { data: T; expiresAt: number };
      const now = Date.now();

      // If still fresh, return immediately
      if (now < parsed.expiresAt) {
        return parsed.data;
      }

      // If stale, trigger background revalidation (async) but return stale data now
      Promise.resolve()
        .then(async () => {
          const freshData = await fetcher();
          await redis.set(
            cacheKey,
            JSON.stringify({
              data: freshData,
              expiresAt: Date.now() + freshTTLSeconds * 1000,
            }),
            'EX',
            86400 // keep stale in cache for up to 24h
          );
        })
        .catch((err) => {
          logger.error({ err, cacheKey }, 'SWR background revalidation failed');
        });

      return parsed.data;
    } catch (_) {
      // JSON parse error, fallback to sync fetch
    }
  }

  // Cache miss: sync fetch and save
  const data = await fetcher();
  await redis.set(
    cacheKey,
    JSON.stringify({
      data,
      expiresAt: Date.now() + freshTTLSeconds * 1000,
    }),
    'EX',
    86400
  );

  return data;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // Enforce tenant context
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }
  });

  // GET /v1/tenant/dashboard/today - Overview of today's operational metrics
  app.get('/today', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const cacheKey = `swr:tenant:${tenantId}:dashboard:today`;

    const data = await withSWR(cacheKey, 60, async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const scheduledStatuses = [MeetingStatus.SCHEDULED, MeetingStatus.CONFIRMED];

      const [
        meetingsToday,
        conversationsReady,
        pendingManualConversations,
        needCallback,
        newLeadsToday,
        nextMeeting,
      ] = await Promise.all([
        prisma.meeting.count({
          where: {
            tenantId,
            scheduledFor: { gte: todayStart, lte: todayEnd },
            status: { in: scheduledStatuses },
          },
        }),
        prisma.conversation.count({
          where: {
            tenantId,
            status: ConversationStatus.ACTIVE,
            aiHandling: true,
          },
        }),
        prisma.conversation.count({
          where: {
            tenantId,
            status: { in: [ConversationStatus.PAUSED, ConversationStatus.ESCALATED] },
            aiHandling: false,
          },
        }),
        prisma.lead.count({
          where: {
            tenantId,
            status: LeadStatus.CONTACTED,
            deletedAt: null,
          },
        }),
        prisma.lead.count({
          where: {
            tenantId,
            createdAt: { gte: todayStart, lte: todayEnd },
            deletedAt: null,
          },
        }),
        prisma.meeting.findFirst({
          where: {
            tenantId,
            scheduledFor: { gte: new Date() },
            status: { in: scheduledStatuses },
          },
          orderBy: { scheduledFor: 'asc' },
          select: { scheduledFor: true },
        }),
      ]);

      return {
        meetings_today: meetingsToday,
        conversations_ready: conversationsReady,
        pending_manual_conversations: pendingManualConversations,
        need_callback: needCallback,
        new_leads_today: newLeadsToday,
        next_meeting_time: nextMeeting ? formatTime(nextMeeting.scheduledFor) : null,
      };
    });

    return reply.send({ data });
  });

  // GET /v1/tenant/dashboard/funnel - CRM funnel counts and conversion rates
  app.get('/funnel', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const { period } = req.query as { period?: string };
    const cacheKey = `swr:tenant:${tenantId}:dashboard:funnel:${period || 'all'}`;

    const data = await withSWR(cacheKey, 60, async () => {
      // Calculate date range based on period
      let dateFilter: { gte?: Date } | undefined;
      if (period === 'week') {
        const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0);
        dateFilter = { gte: d };
      } else if (period === 'month') {
        const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
        dateFilter = { gte: d };
      } else if (period === '90d') {
        const d = new Date(); d.setDate(d.getDate() - 90); d.setHours(0, 0, 0, 0);
        dateFilter = { gte: d };
      }

      // Count leads in each status
      const leadCounts = await prisma.lead.groupBy({
        by: ['status'],
        where: { tenantId, ...(dateFilter && { createdAt: dateFilter }) },
        _count: { id: true },
      });

      const counts = {
        CAPTURED: 0,
        ENRICHED: 0,
        NEW: 0,
        CONTACTED: 0,
        QUALIFIED: 0,
        NEGOTIATING: 0,
        CLOSED_WON: 0,
        CLOSED_LOST: 0,
        ARCHIVED: 0,
      };

      let totalLeads = 0;
      leadCounts.forEach((group) => {
        const status = group.status as keyof typeof counts;
        if (status in counts) {
          counts[status] = group._count.id;
        }
        totalLeads += group._count.id;
      });

      // Calculate conversion rates
      const winRate = totalLeads > 0 ? (counts.CLOSED_WON / totalLeads) * 100 : 0;
      const qualifiedRate = totalLeads > 0 ? ((counts.QUALIFIED + counts.NEGOTIATING + counts.CLOSED_WON) / totalLeads) * 100 : 0;

      return {
        stages: counts,
        total_leads: totalLeads,
        metrics: {
          win_rate_percent: Number(winRate.toFixed(1)),
          qualified_rate_percent: Number(qualifiedRate.toFixed(1)),
        },
      };
    });

    return reply.send({ data });
  });

  // GET /v1/tenant/dashboard/performance - Revenue, commission and financial outcomes
  app.get('/performance', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const { period } = req.query as { period?: string };
    const cacheKey = `swr:tenant:${tenantId}:dashboard:performance:${period || 'all'}`;

    const data = await withSWR(cacheKey, 60, async () => {
      // Calculate date range based on period
      let dateFilter: { gte?: Date } = {};
      if (period === 'week') {
        const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0);
        dateFilter = { gte: d };
      } else if (period === 'month') {
        const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
        dateFilter = { gte: d };
      } else if (period === '90d') {
        const d = new Date(); d.setDate(d.getDate() - 90); d.setHours(0, 0, 0, 0);
        dateFilter = { gte: d };
      }

      // Sum of closed meeting policy values and commissions
      const financialAggregate = await prisma.meeting.aggregate({
        where: {
          tenantId,
          outcome: MeetingOutcome.CLOSED,
          ...(dateFilter.gte && { outcomeMarkedAt: { gte: dateFilter.gte } }),
        },
        _sum: {
          policyValueCents: true,
          commissionCents: true,
        },
        _count: {
          id: true,
        },
      });

      const totalPolicyCents = financialAggregate._sum.policyValueCents || 0;
      const totalCommissionCents = financialAggregate._sum.commissionCents || 0;
      const salesCount = financialAggregate._count.id;

      return {
        total_policy_cents: totalPolicyCents,
        total_commission_cents: totalCommissionCents,
        sales_count: salesCount,
        goals: {
          configured: false,
          target_cents: null,
          progress_percent: null,
          goal_reached: false,
        },
      };
    });

    return reply.send({ data });
  });

  // GET /v1/tenant/dashboard/ai-usage - LLM, maps, and WhatsApp costs aggregate
  app.get('/ai-usage', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const cacheKey = `swr:tenant:${tenantId}:dashboard:ai-usage`;

    const data = await withSWR(cacheKey, 60, async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      // Fetch or create monthly usage record
      const usage = await prisma.tenantUsage.findUnique({
        where: {
          tenantId_periodMonth: {
            tenantId,
            periodMonth: startOfMonth,
          },
        },
      });

      const llmCost = usage ? Number(usage.llmCostCents) : 0;
      const whatsappCost = usage ? Number(usage.whatsappCostCents) : 0;
      const mapsCost = usage ? Number(usage.googleMapsCostCents) : 0;
      const totalCost = llmCost + whatsappCost + mapsCost;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { plan: true },
      });
      const maxLimitCents = getAIPlanLimitCents(tenant?.plan);
      const limitUsedPercent = maxLimitCents > 0 ? (totalCost / maxLimitCents) * 100 : 0;

      return {
        llm_cost_cents: llmCost,
        whatsapp_cost_cents: whatsappCost,
        maps_cost_cents: mapsCost,
        total_costs_cents: totalCost,
        limit: {
          max_limit_cents: maxLimitCents,
          used_percent: Number(limitUsedPercent.toFixed(1)),
          remaining_cents: Math.max(0, maxLimitCents - totalCost),
        },
      };
    });

    return reply.send({ data });
  });
};

export default dashboardRoutes;
