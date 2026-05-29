/**
 * Endpoints admin para Lead Sources Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /lead-sources · distribuição de leads por fonte cross-tenant
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { tenantContextStorage } from '../../lib/tenant-context-storage.js';

/* ------------------------------------------------------------------ */
/* RLS bypass helper                                                   */
/* ------------------------------------------------------------------ */

function withAdminRole<TResult>(operation: (tx: typeof prisma) => Promise<TResult>): Promise<TResult> {
  const store = tenantContextStorage.getStore();
  return tenantContextStorage.run(
    { tenantId: store?.tenantId ?? null, userId: store?.userId ?? null, bypassRls: true },
    () => operation(prisma)
  );
}

/* ------------------------------------------------------------------ */
/* Query schemas                                                       */
/* ------------------------------------------------------------------ */

const sourcesQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

/* ------------------------------------------------------------------ */
/* Converted statuses                                                  */
/* ------------------------------------------------------------------ */

const CONVERTED_STATUSES = ['QUALIFIED', 'MEETING_SCHEDULED', 'CLOSED_WON'] as const;

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminLeadSourcesRoutes(app: FastifyInstance): void {
  /**
   * GET /lead-sources
   * Distribution of leads by source across all tenants, with conversion metrics.
   */
  app.get('/lead-sources', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = sourcesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId } = parsed.data;

    try {
      const result = await withAdminRole(async (tx) => {
        const where: Record<string, unknown> = {};
        if (tenantId) where.tenantId = tenantId;

        // Group by source — total counts
        const bySource = await tx.lead.groupBy({
          by: ['source'],
          where,
          _count: { id: true },
        });

        // Group by source — converted counts
        const bySourceConverted = await tx.lead.groupBy({
          by: ['source'],
          where: { ...where, status: { in: [...CONVERTED_STATUSES] } },
          _count: { id: true },
        });

        const convertedMap = new Map(bySourceConverted.map((s) => [s.source, s._count.id]));

        const total = bySource.reduce((sum, s) => sum + s._count.id, 0);

        const breakdown = bySource
          .map((s) => {
            const count = s._count.id;
            const convertedCount = convertedMap.get(s.source) ?? 0;
            return {
              source: s.source,
              count,
              percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
              convertedCount,
              conversionRate: count > 0 ? Number(((convertedCount / count) * 100).toFixed(1)) : 0,
            };
          })
          .sort((a, b) => b.count - a.count);

        return { total, breakdown };
      });

      return reply.send({ data: result });
    } catch (err) {
      logger.error({ err }, 'admin/lead-sources · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular distribuição de fontes.' });
    }
  });
}
