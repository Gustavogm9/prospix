import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { tenantContextStorage } from '../../lib/tenant-context-storage.js';

function withAdminRole<TResult>(operation: (tx: typeof prisma) => Promise<TResult>): Promise<TResult> {
  const store = tenantContextStorage.getStore();
  return tenantContextStorage.run(
    { tenantId: store?.tenantId ?? null, userId: store?.userId ?? null, bypassRls: true },
    () => operation(prisma)
  );
}

export function registerAdminLeadsRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /leads — Cross-tenant lead listing
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
      const where: Record<string, unknown> = {};
      if (tenantId) where.tenantId = tenantId;
      if (status) where.status = status;
      if (source) where.source = source;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { whatsapp: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [items, total] = await withAdminRole(async (tx) => {
        return Promise.all([
          tx.lead.findMany({
            where,
            select: {
              id: true,
              name: true,
              whatsapp: true,
              email: true,
              status: true,
              source: true,
              profession: true,
              address: true,
              tenantId: true,
              createdAt: true,
              updatedAt: true,
              tenant: { select: { id: true, name: true, slug: true } },
              _count: { select: { conversations: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
          }),
          tx.lead.count({ where }),
        ]);
      });

      return reply.send({
        data: {
          items: items.map((l) => ({
            id: l.id,
            name: l.name,
            whatsapp: l.whatsapp,
            email: l.email,
            status: l.status,
            source: l.source,
            profession: l.profession,
            city: (l.address as any)?.city ?? null,
            tenantId: l.tenantId,
            tenant: l.tenant,
            conversationCount: l._count.conversations,
            createdAt: l.createdAt.toISOString(),
            updatedAt: l.updatedAt.toISOString(),
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/leads · GET list failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar leads.' });
    }
  });

  // =========================================================================
  // GET /leads/stats — Lead stats
  // =========================================================================
  app.get('/leads/stats', async (_req, reply) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const stats = await withAdminRole(async (tx) => {
        const [totalAll, newToday, newWeek, newMonth, byStatus, bySource, topTenants] = await Promise.all([
          tx.lead.count(),
          tx.lead.count({ where: { createdAt: { gte: todayStart } } }),
          tx.lead.count({ where: { createdAt: { gte: weekStart } } }),
          tx.lead.count({ where: { createdAt: { gte: monthStart } } }),
          tx.lead.groupBy({ by: ['status'], _count: { id: true } }),
          tx.lead.groupBy({ by: ['source'], _count: { id: true } }),
          tx.lead.groupBy({
            by: ['tenantId'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 5,
          }),
        ]);

        const tenantIds = topTenants.map((t) => t.tenantId);
        const tenantNames = await tx.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        });
        const nameMap = new Map(tenantNames.map((t) => [t.id, t.name]));

        return {
          totalAll,
          newToday,
          newWeek,
          newMonth,
          byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count.id])),
          bySource: Object.fromEntries(bySource.map((s) => [s.source, s._count.id])),
          topTenants: topTenants.map((t) => ({
            tenantId: t.tenantId,
            tenantName: nameMap.get(t.tenantId) ?? 'Desconhecido',
            count: t._count.id,
          })),
        };
      });

      return reply.send({ data: stats });
    } catch (err) {
      logger.error({ err }, 'admin/leads/stats · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de leads.' });
    }
  });

  // =========================================================================
  // GET /leads/export — CSV export
  // =========================================================================
  app.get('/leads/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listSchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : { limit: 5000, offset: 0 };

    try {
      const where: Record<string, unknown> = {};
      if (filters.tenantId) where.tenantId = filters.tenantId;
      if (filters.status) where.status = filters.status;
      if (filters.source) where.source = filters.source;

      const leads = await withAdminRole((tx) =>
        tx.lead.findMany({
          where,
          select: {
            name: true, whatsapp: true, email: true, status: true, source: true, profession: true, address: true,
            createdAt: true, tenant: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5000,
        })
      );

      const header = 'Tenant,Nome,WhatsApp,Email,Status,Source,Profissão,Cidade,Criado em\n';
      const rows = leads.map((l) =>
        [l.tenant?.name, l.name, l.whatsapp, l.email, l.status, l.source, l.profession, (l.address as any)?.city, l.createdAt.toISOString()]
          .map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(header + rows);
    } catch (err) {
      logger.error({ err }, 'admin/leads/export · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao exportar leads.' });
    }
  });
}
