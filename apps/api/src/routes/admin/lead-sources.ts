/**
 * Endpoints admin para Lead Sources Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /lead-sources → distribuição de leads por fonte cross-tenant
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Query schemas                                                       */
/* ------------------------------------------------------------------ */

const sourcesQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

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
      // Build SQL for groupBy source with optional tenant filter
      const tenantFilter = tenantId ? `AND l.tenant_id = '${tenantId}'` : '';

      const { data: bySourceRaw, error: srcErr } = await dbAdmin.rpc('exec_sql' as any, {
        query: `
          SELECT l.source, COUNT(l.id)::bigint AS cnt
          FROM leads l
          WHERE 1=1 ${tenantFilter}
          GROUP BY l.source
        `,
      });
      if (srcErr) throw srcErr;

      const { data: bySourceConvertedRaw, error: convErr } = await dbAdmin.rpc('exec_sql' as any, {
        query: `
          SELECT l.source, COUNT(l.id)::bigint AS cnt
          FROM leads l
          WHERE l.status IN ('QUALIFIED', 'MEETING_SCHEDULED', 'CLOSED_WON') ${tenantFilter}
          GROUP BY l.source
        `,
      });
      if (convErr) throw convErr;

      const convertedMap = new Map<string, number>((bySourceConvertedRaw ?? []).map((s: any) => [s.source, Number(s.cnt)]));

      const total = (bySourceRaw ?? []).reduce((sum: number, s: any) => sum + Number(s.cnt), 0 as number);

      const breakdown = (bySourceRaw ?? [])
        .map((s: any) => {
          const count = Number(s.cnt);
          const convertedCount: number = convertedMap.get(s.source) ?? 0;
          return {
            source: s.source,
            count,
            percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
            convertedCount,
            conversionRate: count > 0 ? Number(((convertedCount / count) * 100).toFixed(1)) : 0,
          };
        })
        .sort((a: any, b: any) => b.count - a.count);

      return reply.send({ data: { total, breakdown } });
    } catch (err) {
      logger.error({ err }, 'admin/lead-sources → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular distribuição de fontes.' });
    }
  });
}
