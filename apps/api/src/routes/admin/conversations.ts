import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

export function registerAdminConversationsRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /conversations - Cross-tenant conversation listing
  // =========================================================================
  const listSchema = z.object({
    tenantId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'ESCALATED', 'CLOSED']).optional(),
    aiHandling: z.enum(['true', 'false']).optional(),
    search: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(30),
    offset: z.coerce.number().int().min(0).optional().default(0),
  });

  app.get('/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Parâmetros inválidos.' });
    }

    const { tenantId, status, aiHandling, search, limit, offset } = parsed.data;

    try {
      let query = dbAdmin
        .from('conversations')
        .select('*, leads!inner(id, name, whatsapp, email), tenants(id, name, slug)')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (status) query = query.eq('status', status);
      if (aiHandling !== undefined) query = query.eq('ai_handling', aiHandling === 'true');
      if (search) {
        query = query.or(`name.ilike.%${search}%,whatsapp.ilike.%${search}%`, { referencedTable: 'leads' });
      }

      const { data: items, error } = await query;
      if (error) throw error;

      // Count
      let countQuery = dbAdmin
        .from('conversations')
        .select('*, leads!inner(id)', { count: 'exact', head: true });
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (status) countQuery = countQuery.eq('status', status);
      if (aiHandling !== undefined) countQuery = countQuery.eq('ai_handling', aiHandling === 'true');
      if (search) {
        countQuery = countQuery.or(`name.ilike.%${search}%,whatsapp.ilike.%${search}%`, { referencedTable: 'leads' });
      }

      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      // Fetch recent messages for each conversation
      const conversationIds = (items ?? []).map((c: any) => c.id);
      let messagesMap: Map<string, any[]> = new Map();
      if (conversationIds.length > 0) {
        // Get last 3 messages per conversation – fetched in bulk then sliced
        const { data: allMessages } = await dbAdmin
          .from('messages')
          .select('id, conversation_id, direction, sender, content, delivery_status, created_at')
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: false })
          .limit(conversationIds.length * 3);

        for (const m of allMessages ?? []) {
          const list = messagesMap.get(m.conversation_id) ?? [];
          if (list.length < 3) {
            list.push(m);
            messagesMap.set(m.conversation_id, list);
          }
        }
      }

      return reply.send({
        data: {
          items: (items ?? []).map((c: any) => ({
            id: c.id,
            tenantId: c.tenant_id,
            tenant: c.tenants,
            lead: c.leads,
            status: c.status,
            aiHandlingEnabled: c.ai_handling,
            messageCount: c.message_count,
            lastInboundAt: c.last_inbound_at ?? null,
            lastOutboundAt: c.last_outbound_at ?? null,
            startedAt: c.started_at,
            updatedAt: c.last_message_at ?? c.started_at,
            recentMessages: (messagesMap.get(c.id) ?? []).map((m: any) => ({
              id: m.id,
              direction: m.direction,
              sender: m.sender,
              content: m.content?.substring(0, 200) ?? '',
              deliveryStatus: m.delivery_status,
              createdAt: m.created_at,
            })),
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/conversations → GET list failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar conversas.' });
    }
  });

  // =========================================================================
  // GET /conversations/stats - AI quality stats
  // =========================================================================
  app.get('/conversations/stats', async (_req, reply) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [totalAllRes, totalTodayRes, totalWeekRes, totalMonthRes, activeAIRes, escalatedRes] = await Promise.all([
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }),
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).gte('started_at', todayStart.toISOString()),
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).gte('started_at', weekStart.toISOString()),
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).gte('started_at', monthStart.toISOString()),
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE').eq('ai_handling', true),
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'ESCALATED'),
      ]);

      // Top 5 tenants by conversation count
      let topTenantsRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT c.tenant_id, COUNT(c.id)::bigint AS cnt
            FROM conversations c
            GROUP BY c.tenant_id
            ORDER BY cnt DESC
            LIMIT 5
          `,
        });
        topTenantsRaw = data ?? [];
      } catch { /* ignore */ }

      // Get tenant names for top tenants
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
          totalToday: totalTodayRes.count ?? 0,
          totalWeek: totalWeekRes.count ?? 0,
          totalMonth: totalMonthRes.count ?? 0,
          activeAI: activeAIRes.count ?? 0,
          escalated: escalatedRes.count ?? 0,
          topTenants: topTenantsRaw.map((t: any) => ({
            tenantId: t.tenant_id,
            tenantName: nameMap.get(t.tenant_id) ?? 'Desconhecido',
            count: Number(t.cnt),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/conversations/stats → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas.' });
    }
  });
}
