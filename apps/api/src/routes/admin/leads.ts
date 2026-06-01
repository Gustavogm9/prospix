import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

export function registerAdminLeadsRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /leads - Cross-tenant lead listing
  // =========================================================================
  const listSchema = z.object({
    tenantId: z.string().uuid().optional(),
    status: z.string().optional(),
    source: z.string().optional(),
    search: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  });

  app.get('/leads', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Parâmetros inválidos.' });
    }

    const { tenantId, status, source, search, limit, offset } = parsed.data;

    try {
      let query = dbAdmin
        .from('leads')
        .select('id, name, whatsapp, email, status, source, profession, address, tenant_id, created_at, updated_at, tenants(id, name, slug)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (status) query = query.eq('status', status as any);
      if (source) query = query.eq('source', source as any);
      if (search) {
        query = query.or(`name.ilike.%${search}%,whatsapp.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data: items, error } = await query;
      if (error) throw error;

      // Count with same filters
      let countQuery = dbAdmin.from('leads').select('*', { count: 'exact', head: true });
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (status) countQuery = countQuery.eq('status', status as any);
      if (source) countQuery = countQuery.eq('source', source as any);
      if (search) {
        countQuery = countQuery.or(`name.ilike.%${search}%,whatsapp.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      // Get conversation counts per lead
      const leadIds = (items ?? []).map((l: any) => l.id);
      let convCountMap = new Map<string, number>();
      if (leadIds.length > 0) {
        let convCounts: any[] = [];
        try {
          const { data } = await dbAdmin.rpc('exec_sql' as any, {
            query: `
              SELECT lead_id, COUNT(id)::bigint AS cnt
              FROM conversations
              WHERE lead_id = ANY(ARRAY[${leadIds.map((id: string) => `'${id}'`).join(',')}]::uuid[])
              GROUP BY lead_id
            `,
          });
          convCounts = data ?? [];
        } catch { /* ignore */ }
        for (const c of convCounts) {
          convCountMap.set(c.lead_id, Number(c.cnt));
        }
      }

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
            city: (l.address as any)?.city ?? null,
            tenantId: l.tenant_id,
            tenant: l.tenants,
            conversationCount: convCountMap.get(l.id) ?? 0,
            createdAt: l.created_at,
            updatedAt: l.updated_at,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/leads → GET list failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar leads.' });
    }
  });

  // =========================================================================
  // GET /leads/stats - Lead stats
  // =========================================================================
  app.get('/leads/stats', async (_req, reply) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [totalAllRes, newTodayRes, newWeekRes, newMonthRes] = await Promise.all([
        dbAdmin.from('leads').select('*', { count: 'exact', head: true }),
        dbAdmin.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
        dbAdmin.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
        dbAdmin.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString()),
      ]);

      // Group by status
      let byStatusRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `SELECT status, COUNT(id)::bigint AS cnt FROM leads GROUP BY status`,
        });
        byStatusRaw = data ?? [];
      } catch { /* ignore */ }

      // Group by source
      let bySourceRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `SELECT source, COUNT(id)::bigint AS cnt FROM leads GROUP BY source`,
        });
        bySourceRaw = data ?? [];
      } catch { /* ignore */ }

      // Top 5 tenants by lead count
      let topTenantsRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT l.tenant_id, COUNT(l.id)::bigint AS cnt
            FROM leads l
            GROUP BY l.tenant_id
            ORDER BY cnt DESC
            LIMIT 5
          `,
        });
        topTenantsRaw = data ?? [];
      } catch { /* ignore */ }

      const tenantIds = topTenantsRaw.map((t: any) => t.tenant_id);
      let nameMap = new Map<string, string>();
      if (tenantIds.length > 0) {
        const { data: tenantNames } = await dbAdmin
          .from('tenants')
          .select('id, name')
          .in('id', tenantIds);
        nameMap = new Map((tenantNames ?? []).map((t: any) => [t.id, t.name]));
      }

      return reply.send({
        data: {
          totalAll: totalAllRes.count ?? 0,
          newToday: newTodayRes.count ?? 0,
          newWeek: newWeekRes.count ?? 0,
          newMonth: newMonthRes.count ?? 0,
          byStatus: Object.fromEntries(byStatusRaw.map((s: any) => [s.status, Number(s.cnt)])),
          bySource: Object.fromEntries(bySourceRaw.map((s: any) => [s.source, Number(s.cnt)])),
          topTenants: topTenantsRaw.map((t: any) => ({
            tenantId: t.tenant_id,
            tenantName: nameMap.get(t.tenant_id) ?? 'Desconhecido',
            count: Number(t.cnt),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/leads/stats → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de leads.' });
    }
  });

  // =========================================================================
  // GET /leads/export - CSV export
  // =========================================================================
  app.get('/leads/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listSchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : { limit: 5000, offset: 0 };

    try {
      let query = dbAdmin
        .from('leads')
        .select('name, whatsapp, email, status, source, profession, address, created_at, tenants(name)')
        .order('created_at', { ascending: false })
        .limit(5000);

      if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
      if (filters.status) query = query.eq('status', filters.status as any);
      if (filters.source) query = query.eq('source', filters.source as any);

      const { data: leads, error } = await query;
      if (error) throw error;

      const header = 'Tenant,Nome,WhatsApp,Email,Status,Source,Profissão,Cidade,Criado em\n';
      const rows = (leads ?? []).map((l: any) =>
        [(l.tenants as any)?.name, l.name, l.whatsapp, l.email, l.status, l.source, l.profession, (l.address as any)?.city, l.created_at]
          .map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(header + rows);
    } catch (err) {
      logger.error({ err }, 'admin/leads/export → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao exportar leads.' });
    }
  });
}
