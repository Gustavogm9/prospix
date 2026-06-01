/**
 * Endpoints admin para Activity Tracking (Gap 5).
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /activity/logins   → lista sessões recentes com user info, IP, userAgent
 *  - GET /activity/summary  → resumo de atividade: sessões ativas, logins hoje/semana, top tenants, dormentes
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Query schemas                                                       */
/* ------------------------------------------------------------------ */

const loginsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminActivityRoutes(app: FastifyInstance): void {
  /**
   * GET /activity/logins
   * Recent login sessions across all tenants with user info.
   */
  app.get('/activity/logins', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId, limit, offset } = parsed.data;

    try {
      // Build sessions query with user join
      let query = dbAdmin
        .from('sessions')
        .select('*, users!inner(id, name, email, role, tenant_id, tenants(id, name, slug))')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (tenantId) {
        query = query.eq('users.tenant_id', tenantId);
      }

      const { data: items, error } = await query;
      if (error) throw error;

      // Count total
      let countQuery = dbAdmin
        .from('sessions')
        .select('*, users!inner(tenant_id)', { count: 'exact', head: true });
      if (tenantId) {
        countQuery = countQuery.eq('users.tenant_id', tenantId);
      }
      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      return reply.send({
        data: {
          items: (items ?? []).map((s: any) => ({
            id: s.id,
            userId: s.user_id,
            userName: s.users?.name,
            userEmail: s.users?.email,
            userRole: s.users?.role,
            tenantId: s.users?.tenant_id,
            tenantName: s.users?.tenants?.name ?? null,
            tenantSlug: s.users?.tenants?.slug ?? null,
            ipAddress: s.ip_address,
            userAgent: s.user_agent,
            expiresAt: s.expires_at,
            revokedAt: s.revoked_at ?? null,
            createdAt: s.created_at,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/activity/logins → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar logins.' });
    }
  });

  /**
   * GET /activity/summary
   * Activity summary: active sessions, logins today/week, top tenants, dormant tenants.
   */
  app.get('/activity/summary', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const now = new Date();

      // Start of today (UTC)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

      // Start of 7 days ago
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // 30 days ago for top tenants
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // 14 days ago for dormancy
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const [activeSessionsRes, loginsTodayRes, loginsWeekRes, allActiveTenantsRes] = await Promise.all([
        // Active sessions: not expired and not revoked
        dbAdmin
          .from('sessions')
          .select('*', { count: 'exact', head: true })
          .gt('expires_at', now.toISOString())
          .is('revoked_at', null),

        // Logins today
        dbAdmin
          .from('sessions')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfToday.toISOString()),

        // Logins this week
        dbAdmin
          .from('sessions')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfWeek.toISOString()),

        // All active tenants for dormancy check
        dbAdmin
          .from('tenants')
          .select('id, name, slug')
          .eq('status', 'ACTIVE')
          .is('deleted_at', null),
      ]);

      if (activeSessionsRes.error) throw activeSessionsRes.error;
      if (loginsTodayRes.error) throw loginsTodayRes.error;
      if (loginsWeekRes.error) throw loginsWeekRes.error;
      if (allActiveTenantsRes.error) throw allActiveTenantsRes.error;

      const activeSessions = activeSessionsRes.count ?? 0;
      const loginsToday = loginsTodayRes.count ?? 0;
      const loginsWeek = loginsWeekRes.count ?? 0;
      const allActiveTenants = allActiveTenantsRes.data ?? [];

      let topTenantSessions: any[] = [];
      try {
        const { data: rpcResult } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT u.tenant_id AS tenant_id, t.name AS tenant_name, COUNT(s.id)::bigint AS session_count
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            JOIN tenants t ON u.tenant_id = t.id
            WHERE s.created_at >= '${thirtyDaysAgo.toISOString()}'
              AND u.tenant_id IS NOT NULL
            GROUP BY u.tenant_id, t.name
            ORDER BY session_count DESC
            LIMIT 10
          `,
        });
        topTenantSessions = rpcResult ?? [];
      } catch { /* RPC not available, skip */ }

      // Dormant tenants: active tenants with no login in 14+ days
      const { data: recentLoginTenants } = await dbAdmin
        .from('sessions')
        .select('user_id, users!inner(tenant_id)')
        .gte('created_at', fourteenDaysAgo.toISOString())
        .not('users.tenant_id', 'is', null);

      const recentTenantIds = new Set(
        (recentLoginTenants ?? [])
          .map((s: any) => s.users?.tenant_id)
          .filter((id: string | null): id is string => id !== null),
      );

      const dormantTenants = allActiveTenants.filter((t) => !recentTenantIds.has(t.id));

      return reply.send({
        data: {
          activeSessions,
          loginsToday,
          loginsWeek,
          dormantTenants: dormantTenants.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
          })),
          dormantTenantsCount: dormantTenants.length,
          topTenants: (topTenantSessions ?? []).map((r: any) => ({
            tenantId: r.tenant_id,
            tenantName: r.tenant_name,
            sessionCount: Number(r.session_count),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/activity/summary → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular resumo de atividade.' });
    }
  });
}
