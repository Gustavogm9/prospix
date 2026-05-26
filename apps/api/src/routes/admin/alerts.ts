/**
 * Endpoints admin para Operational Alerts.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET    /alerts          · lista alertas com filtros (severity/type/resolved/tenant)
 *  - POST   /alerts/scan     · trigger sync · útil para validar sem esperar scheduler diário
 *  - PATCH  /alerts/:id/ack  · marca como acknowledged (mas não resolvido)
 *  - PATCH  /alerts/:id/resolve · resolve o alerta (sai do feed)
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { AlertSeverity, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { runAlertScan } from '../../lib/alert-scanner.js';

const listQuerySchema = z.object({
  severity: z.nativeEnum(AlertSeverity).optional(),
  type: z.string().min(1).max(120).optional(),
  tenantId: z.string().uuid().optional(),
  status: z.enum(['open', 'acked', 'resolved', 'all']).optional().default('open'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export function registerAdminAlertsRoutes(app: FastifyInstance): void {
  app.get('/alerts', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    const { severity, type, tenantId, status, limit, offset } = parsed.data;
    try {
      const where: Prisma.OperationalAlertWhereInput = {};
      if (severity) where.severity = severity;
      if (type) where.type = type;
      if (tenantId) where.tenantId = tenantId;
      if (status === 'open') where.resolvedAt = null;
      else if (status === 'acked') { where.resolvedAt = null; where.ackAt = { not: null }; }
      else if (status === 'resolved') where.resolvedAt = { not: null };

      const [items, total, severityCounts] = await Promise.all([
        prisma.operationalAlert.findMany({
          where,
          orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
          take: limit,
          skip: offset,
          include: {
            tenant: { select: { id: true, name: true, slug: true } },
            ackBy: { select: { id: true, name: true, email: true } },
          },
        }),
        prisma.operationalAlert.count({ where }),
        prisma.operationalAlert.groupBy({
          by: ['severity'],
          where: { resolvedAt: null },
          _count: { severity: true },
        }),
      ]);

      const summary: Record<string, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
      for (const c of severityCounts) summary[c.severity] = c._count.severity;

      return reply.send({
        data: {
          items: items.map((a) => ({
            id: a.id,
            type: a.type,
            severity: a.severity,
            tenantId: a.tenantId,
            tenant: a.tenant,
            title: a.title,
            message: a.message,
            context: a.context,
            dedupKey: a.dedupKey,
            ackById: a.ackById,
            ackBy: a.ackBy,
            ackAt: a.ackAt?.toISOString() ?? null,
            resolvedAt: a.resolvedAt?.toISOString() ?? null,
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
          summary,
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/alerts · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar alertas.' });
    }
  });

  app.post('/alerts/scan', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await runAlertScan({ autoResolve: true });
      return reply.send({ data: result });
    } catch (err) {
      logger.error({ err }, 'admin/alerts/scan · POST failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao executar scan.' });
    }
  });

  const ackBodySchema = z.object({
    actorUserId: z.string().uuid().optional(),
  });

  app.patch('/alerts/:id/ack', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = ackBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Payload inválido.', issues: parsed.error.issues });
    try {
      const existing = await prisma.operationalAlert.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Alerta não encontrado.' });
      if (existing.resolvedAt) return reply.code(409).send({ error: 'CONFLICT', message: 'Alerta já resolvido.' });
      const updated = await prisma.operationalAlert.update({
        where: { id },
        data: { ackById: parsed.data.actorUserId ?? null, ackAt: new Date() },
      });
      return reply.send({ data: { id: updated.id, ackAt: updated.ackAt?.toISOString() } });
    } catch (err) {
      logger.error({ err, id }, 'admin/alerts/:id/ack failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao ack.' });
    }
  });

  app.patch('/alerts/:id/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const existing = await prisma.operationalAlert.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Alerta não encontrado.' });
      if (existing.resolvedAt) return reply.send({ data: { id, alreadyResolved: true, resolvedAt: existing.resolvedAt.toISOString() } });
      const updated = await prisma.operationalAlert.update({
        where: { id },
        data: { resolvedAt: new Date() },
      });
      return reply.send({ data: { id: updated.id, resolvedAt: updated.resolvedAt?.toISOString() } });
    } catch (err) {
      logger.error({ err, id }, 'admin/alerts/:id/resolve failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao resolver.' });
    }
  });
}
