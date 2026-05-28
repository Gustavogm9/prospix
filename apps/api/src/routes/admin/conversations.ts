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

export function registerAdminConversationsRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /conversations — Cross-tenant conversation listing
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
      const where: Record<string, unknown> = {};
      if (tenantId) where.tenantId = tenantId;
      if (status) where.status = status;
      if (aiHandling !== undefined) where.aiHandling = aiHandling === 'true';
      if (search) {
        where.lead = {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { whatsapp: { contains: search } },
          ],
        };
      }

      const [items, total] = await withAdminRole(async (tx) => {
        return Promise.all([
          tx.conversation.findMany({
            where,
            include: {
              lead: { select: { id: true, name: true, whatsapp: true, email: true } },
              tenant: { select: { id: true, name: true, slug: true } },
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 3,
                select: { id: true, direction: true, sender: true, content: true, deliveryStatus: true, createdAt: true },
              },
            },
            orderBy: { lastMessageAt: 'desc' },
            take: limit,
            skip: offset,
          }),
          tx.conversation.count({ where }),
        ]);
      });

      return reply.send({
        data: {
          items: items.map((c) => ({
            id: c.id,
            tenantId: c.tenantId,
            tenant: c.tenant,
            lead: c.lead,
            status: c.status,
            aiHandlingEnabled: c.aiHandling,
            messageCount: c.messageCount,
            lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
            lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null,
            startedAt: c.startedAt.toISOString(),
            updatedAt: c.lastMessageAt?.toISOString() ?? c.startedAt.toISOString(),
            recentMessages: c.messages.map((m) => ({
              id: m.id,
              direction: m.direction,
              sender: m.sender,
              content: m.content?.substring(0, 200) ?? '',
              deliveryStatus: m.deliveryStatus,
              createdAt: m.createdAt.toISOString(),
            })),
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/conversations · GET list failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar conversas.' });
    }
  });

  // =========================================================================
  // GET /conversations/stats — AI quality stats
  // =========================================================================
  app.get('/conversations/stats', async (_req, reply) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const stats = await withAdminRole(async (tx) => {
        const [totalAll, totalToday, totalWeek, totalMonth, activeAI, escalated, topTenants] = await Promise.all([
          tx.conversation.count(),
          tx.conversation.count({ where: { startedAt: { gte: todayStart } } }),
          tx.conversation.count({ where: { startedAt: { gte: weekStart } } }),
          tx.conversation.count({ where: { startedAt: { gte: monthStart } } }),
          tx.conversation.count({ where: { status: 'ACTIVE', aiHandling: true } }),
          tx.conversation.count({ where: { status: 'ESCALATED' } }),
          tx.conversation.groupBy({
            by: ['tenantId'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 5,
          }),
        ]);

        // Get tenant names for top tenants
        const tenantIds = topTenants.map((t) => t.tenantId);
        const tenantNames = await tx.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        });
        const nameMap = new Map(tenantNames.map((t) => [t.id, t.name]));

        return {
          totalAll,
          totalToday,
          totalWeek,
          totalMonth,
          activeAI,
          escalated,
          topTenants: topTenants.map((t) => ({
            tenantId: t.tenantId,
            tenantName: nameMap.get(t.tenantId) ?? 'Desconhecido',
            count: t._count.id,
          })),
        };
      });

      return reply.send({ data: stats });
    } catch (err) {
      logger.error({ err }, 'admin/conversations/stats · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas.' });
    }
  });
}
