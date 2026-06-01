/**
 * Endpoints admin para Referrals Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /referrals       → lista leads com source=REFERRAL cross-tenant
 *  - GET /referrals/stats → estatísticas de indicações (conversão, coletadas, top tenants)
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Query schemas                                                       */
/* ------------------------------------------------------------------ */

const referralsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/* ------------------------------------------------------------------ */
/* Converted statuses                                                  */
/* ------------------------------------------------------------------ */

const CONVERTED_STATUSES = ['QUALIFIED', 'MEETING_SCHEDULED', 'CLOSED_WON'] as const;

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminReferralsRoutes(app: FastifyInstance): void {
  /**
   * GET /referrals
   * Leads with source=REFERRAL across all tenants.
   */
  app.get('/referrals', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = referralsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId, from, to, limit, offset } = parsed.data;

    try {
      let query = dbAdmin
        .from('leads')
        .select('id, name, whatsapp, email, status, source, profession, tenant_id, created_at, tenants(id, name, slug)')
        .eq('source', 'REFERRAL')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (from) query = query.gte('created_at', new Date(from).toISOString());
      if (to) query = query.lte('created_at', new Date(to).toISOString());

      const { data: items, error } = await query;
      if (error) throw error;

      // Count
      let countQuery = dbAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('source', 'REFERRAL');
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (from) countQuery = countQuery.gte('created_at', new Date(from).toISOString());
      if (to) countQuery = countQuery.lte('created_at', new Date(to).toISOString());

      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      return reply.send({
        data: {
          items: (items ?? []).map((l: any) => ({
            id: l.id,
            name: l.name,
            whatsapp: l.whatsapp,
            email: l.email,
            status: l.status,
            source: l.source,
            profession: l.profession,
            tenantId: l.tenant_id,
            tenant: l.tenants,
            createdAt: l.created_at,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/referrals → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar indicações.' });
    }
  });

  /**
   * GET /referrals/stats
   * Referral statistics: totals, conversion rate, collected from meetings, top tenants.
   */
  app.get('/referrals/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const [totalReferralsRes, convertedRes] = await Promise.all([
        // Total leads with source=REFERRAL
        dbAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('source', 'REFERRAL'),
        // Converted referrals (status in QUALIFIED, MEETING_SCHEDULED, CLOSED_WON)
        dbAdmin.from('leads').select('*', { count: 'exact', head: true })
          .eq('source', 'REFERRAL')
          .in('status', [...CONVERTED_STATUSES]),
      ]);

      const totalReferrals = totalReferralsRes.count ?? 0;
      const converted = convertedRes.count ?? 0;

      // Sum of referrals_count from Meeting model
      let referralsCollected = 0;
      try {
        const { data: meetingsAggRaw } = await dbAdmin.rpc('exec_sql' as any, {
          query: `SELECT COALESCE(SUM(referrals_count), 0)::bigint AS total FROM meetings`,
        });
        referralsCollected = Number((meetingsAggRaw ?? [{ total: 0 }])[0]?.total ?? 0);
      } catch { /* ignore */ }

      // Top 5 tenants by referral count
      let topTenantsRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT l.tenant_id, COUNT(l.id)::bigint AS cnt
            FROM leads l
            WHERE l.source = 'REFERRAL'
            GROUP BY l.tenant_id
            ORDER BY cnt DESC
            LIMIT 5
          `,
        });
        topTenantsRaw = data ?? [];
      } catch { /* ignore */ }

      // Resolve tenant names
      const tenantIds = topTenantsRaw.map((t: any) => t.tenant_id);
      let nameMap = new Map<string, string>();
      if (tenantIds.length > 0) {
        const { data: tenantNames } = await dbAdmin
          .from('tenants')
          .select('id, name')
          .in('id', tenantIds);
        nameMap = new Map((tenantNames ?? []).map((t: any) => [t.id, t.name]));
      }

      const conversionRate = totalReferrals > 0 ? Number(((converted / totalReferrals) * 100).toFixed(1)) : 0;

      return reply.send({
        data: {
          totalReferrals,
          converted,
          conversionRate,
          referralsCollected,
          topTenants: topTenantsRaw.map((t: any) => ({
            tenantId: t.tenant_id,
            tenantName: nameMap.get(t.tenant_id) ?? 'Desconhecido',
            count: Number(t.cnt),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/referrals/stats → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de indicações.' });
    }
  });
}
