/**
 * Endpoints admin para Campaign Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /campaigns       → lista campanhas cross-tenant com filtros
 *  - GET /campaigns/stats → estatísticas agregadas de campanhas
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Enums & Query schemas                                               */
/* ------------------------------------------------------------------ */

const CampaignStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
const ProfessionEnum = z.enum(['DOCTOR', 'LAWYER', 'DENTIST', 'ENTREPRENEUR', 'ENGINEER', 'ARCHITECT', 'ACCOUNTANT', 'OTHER']);

const campaignsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: CampaignStatusEnum.optional(),
  profession: ProfessionEnum.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminCampaignsRoutes(app: FastifyInstance): void {
  /**
   * GET /campaigns
   * Cross-tenant campaign listing with filters and pagination.
   */
  app.get('/campaigns', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = campaignsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId, status, profession, limit, offset } = parsed.data;

    try {
      let query = dbAdmin
        .from('campaigns')
        .select('*, tenants(id, name, slug)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (status) query = query.eq('status', status);
      if (profession) query = query.eq('profession', profession);

      const { data: items, error } = await query;
      if (error) throw error;

      // Count
      let countQuery = dbAdmin
        .from('campaigns')
        .select('*', { count: 'exact', head: true });
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (status) countQuery = countQuery.eq('status', status);
      if (profession) countQuery = countQuery.eq('profession', profession);

      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      return reply.send({
        data: {
          items: (items ?? []).map((c: any) => ({
            id: c.id,
            tenantId: c.tenant_id,
            tenantName: c.tenants?.name ?? null,
            tenantSlug: c.tenants?.slug ?? null,
            name: c.name,
            status: c.status,
            profession: c.profession,
            cities: c.cities,
            neighborhoods: c.neighborhoods,
            dailyLimit: c.daily_limit,
            hourWindowStart: c.hour_window_start,
            hourWindowEnd: c.hour_window_end,
            activeScriptId: c.active_script_id,
            filters: c.filters,
            totalCaptured: c.total_captured,
            totalConversing: c.total_conversing,
            totalScheduled: c.total_scheduled,
            totalClosedWon: c.total_closed_won,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            archivedAt: c.archived_at ?? null,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/campaigns → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar campanhas.' });
    }
  });

  /**
   * GET /campaigns/stats
   * Aggregated campaign statistics across all tenants.
   */
  app.get('/campaigns/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      // Count by status
      const statusCounts: Record<string, number> = {};
      for (const st of ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']) {
        const { count, error } = await dbAdmin
          .from('campaigns')
          .select('*', { count: 'exact', head: true })
          .eq('status', st as any);
        if (error) throw error;
        statusCounts[st] = count ?? 0;
      }

      // Global totals via raw query
      const { data: totalsRaw } = await dbAdmin
        .from('campaigns')
        .select('total_captured, total_conversing, total_scheduled, total_closed_won');

      const totals = {
        totalCaptured: 0,
        totalConversing: 0,
        totalScheduled: 0,
        totalClosedWon: 0,
      };
      for (const c of totalsRaw ?? []) {
        totals.totalCaptured += c.total_captured ?? 0;
        totals.totalConversing += c.total_conversing ?? 0;
        totals.totalScheduled += c.total_scheduled ?? 0;
        totals.totalClosedWon += c.total_closed_won ?? 0;
      }

      // Top 5 tenants by active campaign count - using SQL
      let topTenantsByActiveCampaigns: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT c.tenant_id AS tenant_id, t.name AS tenant_name, COUNT(c.id)::bigint AS campaign_count
            FROM campaigns c
            JOIN tenants t ON c.tenant_id = t.id
            WHERE c.status = 'ACTIVE'
            GROUP BY c.tenant_id, t.name
            ORDER BY campaign_count DESC
            LIMIT 5
          `,
        });
        topTenantsByActiveCampaigns = data ?? [];
      } catch { /* ignore */ }

      // Count by profession
      const professionCounts: Record<string, number> = {};
      for (const prof of ['DOCTOR', 'LAWYER', 'DENTIST', 'ENTREPRENEUR', 'ENGINEER', 'ARCHITECT', 'ACCOUNTANT', 'OTHER']) {
        const { count, error } = await dbAdmin
          .from('campaigns')
          .select('*', { count: 'exact', head: true })
          .eq('profession', prof as any);
        if (error) throw error;
        if ((count ?? 0) > 0) professionCounts[prof] = count ?? 0;
      }

      return reply.send({
        data: {
          byStatus: statusCounts,
          totals,
          topTenants: topTenantsByActiveCampaigns.map((r: any) => ({
            tenantId: r.tenant_id,
            tenantName: r.tenant_name,
            campaignCount: Number(r.campaign_count),
          })),
          byProfession: professionCounts,
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/campaigns/stats → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de campanhas.' });
    }
  });
}
