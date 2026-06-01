import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { MeetingStatus, LeadStatus, ConversationStatus, MeetingOutcome } from '@prospix/shared-types';
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

function formatTime(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(date));
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
    const db = getDb(req);
    const cacheKey = `swr:tenant:${tenantId}:dashboard:today`;

    const data = await withSWR(cacheKey, 60, async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const scheduledStatuses = [MeetingStatus.SCHEDULED, MeetingStatus.CONFIRMED];

      const [
        meetingsTodayRes,
        conversationsReadyRes,
        pendingManualRes,
        needCallbackRes,
        newLeadsTodayRes,
        nextMeetingRes,
      ] = await Promise.all([
        db.from('meetings')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .gte('scheduled_for', todayStart.toISOString())
          .lte('scheduled_for', todayEnd.toISOString())
          .in('status', scheduledStatuses),
        db.from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', ConversationStatus.ACTIVE)
          .eq('ai_handling', true),
        db.from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .in('status', [ConversationStatus.PAUSED, ConversationStatus.ESCALATED])
          .eq('ai_handling', false),
        db.from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', LeadStatus.CONTACTED)
          .is('deleted_at', null),
        db.from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .gte('created_at', todayStart.toISOString())
          .lte('created_at', todayEnd.toISOString())
          .is('deleted_at', null),
        db.from('meetings')
          .select('scheduled_for')
          .eq('tenant_id', tenantId)
          .gte('scheduled_for', new Date().toISOString())
          .in('status', scheduledStatuses)
          .order('scheduled_for', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        meetings_today: meetingsTodayRes.count ?? 0,
        conversations_ready: conversationsReadyRes.count ?? 0,
        pending_manual_conversations: pendingManualRes.count ?? 0,
        need_callback: needCallbackRes.count ?? 0,
        new_leads_today: newLeadsTodayRes.count ?? 0,
        next_meeting_time: nextMeetingRes.data ? formatTime(nextMeetingRes.data.scheduled_for) : null,
      };
    });

    return reply.send({ data });
  });

  // GET /v1/tenant/dashboard/funnel - CRM funnel counts and conversion rates
  app.get('/funnel', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const db = getDb(req);
    const { period } = req.query as { period?: string };
    const cacheKey = `swr:tenant:${tenantId}:dashboard:funnel:${period || 'all'}`;

    const data = await withSWR(cacheKey, 60, async () => {
      // Calculate date range based on period
      let dateFilter: string | undefined;
      if (period === 'week') {
        const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0);
        dateFilter = d.toISOString();
      } else if (period === 'month') {
        const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
        dateFilter = d.toISOString();
      } else if (period === '90d') {
        const d = new Date(); d.setDate(d.getDate() - 90); d.setHours(0, 0, 0, 0);
        dateFilter = d.toISOString();
      }

      // Supabase doesn't support groupBy natively, so fetch all statuses and count in-memory
      let query = db.from('leads')
        .select('status')
        .eq('tenant_id', tenantId);

      if (dateFilter) {
        query = query.gte('created_at', dateFilter);
      }

      const { data: leadRows, error } = await query;
      if (error) throw error;

      const counts: Record<string, number> = {
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
      (leadRows || []).forEach((row) => {
        const status = row.status as string;
        if (status in counts) {
          counts[status]!++;
        }
        totalLeads++;
      });

      // Calculate conversion rates
      const winRate = totalLeads > 0 ? (counts.CLOSED_WON! / totalLeads) * 100 : 0;
      const qualifiedRate = totalLeads > 0 ? ((counts.QUALIFIED! + counts.NEGOTIATING! + counts.CLOSED_WON!) / totalLeads) * 100 : 0;

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
    const db = getDb(req);
    const { period } = req.query as { period?: string };
    const cacheKey = `swr:tenant:${tenantId}:dashboard:performance:${period || 'all'}`;

    const data = await withSWR(cacheKey, 60, async () => {
      // Calculate date range based on period
      let dateFilter: string | undefined;
      if (period === 'week') {
        const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0);
        dateFilter = d.toISOString();
      } else if (period === 'month') {
        const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
        dateFilter = d.toISOString();
      } else if (period === '90d') {
        const d = new Date(); d.setDate(d.getDate() - 90); d.setHours(0, 0, 0, 0);
        dateFilter = d.toISOString();
      }

      // Supabase doesn't support aggregate, so we fetch the relevant rows and compute in-memory
      let query = db.from('meetings')
        .select('policy_value_cents, commission_cents, id')
        .eq('tenant_id', tenantId)
        .eq('outcome', MeetingOutcome.CLOSED);

      if (dateFilter) {
        query = query.gte('outcome_marked_at', dateFilter);
      }

      const { data: meetings, error } = await query;
      if (error) throw error;

      let totalPolicyCents = 0;
      let totalCommissionCents = 0;
      let salesCount = 0;

      (meetings || []).forEach((m) => {
        totalPolicyCents += m.policy_value_cents || 0;
        totalCommissionCents += m.commission_cents || 0;
        salesCount++;
      });

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
    const db = getDb(req);
    const cacheKey = `swr:tenant:${tenantId}:dashboard:ai-usage`;

    const data = await withSWR(cacheKey, 60, async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      // Fetch or create monthly usage record
      const { data: usage } = await db
        .from('tenant_usage')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period_month', startOfMonth.toISOString())
        .maybeSingle();

      const llmCost = usage ? Number(usage.llm_cost_cents) : 0;
      const whatsappCost = usage ? Number(usage.whatsapp_cost_cents) : 0;
      const mapsCost = usage ? Number(usage.google_maps_cost_cents) : 0;
      const totalCost = llmCost + whatsappCost + mapsCost;

      const { data: tenant } = await db
        .from('tenants')
        .select('plan')
        .eq('id', tenantId)
        .single();

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

  // GET /v1/tenant/dashboard/weekly-captures - Lead capture counts for each of the last 7 days
  app.get('/weekly-captures', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const db = getDb(req);
    const cacheKey = `swr:tenant:${tenantId}:dashboard:weekly-captures`;

    const data = await withSWR(cacheKey, 300, async () => {
      // Get leads grouped by day for last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const { data: leads, error } = await db
        .from('leads')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .gte('created_at', sevenDaysAgo.toISOString());

      if (error) throw error;

      // Build day-by-day counts
      const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        d.setHours(0, 0, 0, 0);
        return { date: d, label: dayNames[d.getDay()], count: 0 };
      });

      (leads || []).forEach((lead) => {
        const created = new Date(lead.created_at);
        created.setHours(0, 0, 0, 0);
        const match = days.find(d => d.date.getTime() === created.getTime());
        if (match) match.count++;
      });

      return days.map(d => ({ label: d.label, value: d.count }));
    });

    return reply.send({ data });
  });

  // GET /v1/tenant/dashboard/hot-leads - Top 5 leads by fitScore
  app.get('/hot-leads', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const db = getDb(req);
    const cacheKey = `swr:tenant:${tenantId}:dashboard:hot-leads`;

    const data = await withSWR(cacheKey, 120, async () => {
      const { data: leads, error } = await db
        .from('leads')
        .select('id, name, profession, whatsapp, address, fit_score, status, google_rating, google_reviews_count, registration_number, metadata, tags, created_at, contacted_at, first_response_at')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .not('status', 'in', '("ARCHIVED","OPTED_OUT","CLOSED_LOST")')
        .not('fit_score', 'is', null)
        .order('fit_score', { ascending: false })
        .limit(5);

      if (error) throw error;

      return (leads || []).map((l) => ({
        id: l.id,
        name: l.name || 'Lead sem nome',
        profession: l.profession,
        whatsapp: l.whatsapp,
        city: (l.address as any)?.city || '',
        fitScore: Number(l.fit_score) || 0,
        status: l.status,
        googleRating: l.google_rating ? Number(l.google_rating) : null,
        googleReviewsCount: l.google_reviews_count,
        registrationNumber: l.registration_number,
        metadata: l.metadata,
        tags: l.tags,
        createdAt: l.created_at,
        contactedAt: l.contacted_at || null,
        firstResponseAt: l.first_response_at || null,
      }));
    });

    return reply.send({ data });
  });
};

export default dashboardRoutes;
