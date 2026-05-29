/**
 * Endpoints admin para Pipeline / Funnel Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /pipeline           · distribuição de leads por status cross-tenant
 *  - GET /pipeline/conversion · taxas de conversão entre estágios chave
 *  - GET /pipeline/by-tenant  · breakdown por tenant (top 10)
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { type Prisma, LeadStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { tenantContextStorage } from '../../lib/tenant-context-storage.js';

/* ------------------------------------------------------------------ */
/* RLS bypass helper (same pattern as other admin routes)              */
/* ------------------------------------------------------------------ */

type AdminTransaction = Prisma.TransactionClient;

function withAdminRole<TResult>(operation: (tx: AdminTransaction) => Promise<TResult>): Promise<TResult> {
  const store = tenantContextStorage.getStore();

  return tenantContextStorage.run(
    {
      tenantId: store?.tenantId ?? null,
      userId: store?.userId ?? null,
      bypassRls: true,
    },
    () => operation(prisma as unknown as AdminTransaction),
  );
}

/* ------------------------------------------------------------------ */
/* Query schemas                                                       */
/* ------------------------------------------------------------------ */

const pipelineQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

/* ------------------------------------------------------------------ */
/* All statuses in funnel order                                        */
/* ------------------------------------------------------------------ */

const ALL_STATUSES: LeadStatus[] = [
  LeadStatus.CAPTURED,
  LeadStatus.ENRICHED,
  LeadStatus.CONTACTED,
  LeadStatus.NO_RESPONSE,
  LeadStatus.CONVERSING,
  LeadStatus.QUALIFIED,
  LeadStatus.MEETING_SCHEDULED,
  LeadStatus.CLOSED_WON,
  LeadStatus.CLOSED_LOST,
  LeadStatus.NOT_INTERESTED,
  LeadStatus.LOST_BEFORE_MEETING,
  LeadStatus.OPTED_OUT,
  LeadStatus.ARCHIVED,
  LeadStatus.ESCALATED_HUMAN,
];

/* ------------------------------------------------------------------ */
/* Conversion stage pairs                                              */
/* ------------------------------------------------------------------ */

const CONVERSION_PAIRS: Array<{ from: LeadStatus; to: LeadStatus; label: string }> = [
  { from: LeadStatus.CAPTURED, to: LeadStatus.CONTACTED, label: 'contact_rate' },
  { from: LeadStatus.CONTACTED, to: LeadStatus.CONVERSING, label: 'response_rate' },
  { from: LeadStatus.CONVERSING, to: LeadStatus.QUALIFIED, label: 'qualification_rate' },
  { from: LeadStatus.QUALIFIED, to: LeadStatus.MEETING_SCHEDULED, label: 'scheduling_rate' },
  { from: LeadStatus.MEETING_SCHEDULED, to: LeadStatus.CLOSED_WON, label: 'close_rate' },
];

/**
 * For conversion purposes, a lead has "passed through" a stage if its current
 * status is that stage OR any stage that comes after it in the pipeline.
 */
function statusesAtOrAfter(status: LeadStatus): LeadStatus[] {
  const idx = ALL_STATUSES.indexOf(status);
  if (idx === -1) return [status];

  // Main funnel path (ordered progression)
  const MAIN_FUNNEL: LeadStatus[] = [
    LeadStatus.CAPTURED,
    LeadStatus.ENRICHED,
    LeadStatus.CONTACTED,
    LeadStatus.CONVERSING,
    LeadStatus.QUALIFIED,
    LeadStatus.MEETING_SCHEDULED,
    LeadStatus.CLOSED_WON,
  ];

  const funnelIdx = MAIN_FUNNEL.indexOf(status);
  if (funnelIdx === -1) return [status];

  // All statuses at or after this point in the funnel, plus terminal exit statuses
  return MAIN_FUNNEL.slice(funnelIdx).concat([
    LeadStatus.CLOSED_LOST,
    LeadStatus.NOT_INTERESTED,
    LeadStatus.LOST_BEFORE_MEETING,
    LeadStatus.NO_RESPONSE,
    LeadStatus.OPTED_OUT,
    LeadStatus.ARCHIVED,
    LeadStatus.ESCALATED_HUMAN,
  ]);
}

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminPipelineRoutes(app: FastifyInstance): void {
  /**
   * GET /pipeline
   * Lead distribution by status, cross-tenant.
   */
  app.get('/pipeline', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = pipelineQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId } = parsed.data;

    try {
      const where: Prisma.LeadWhereInput = { deletedAt: null };
      if (tenantId) {
        where.tenantId = tenantId;
      }

      const [groupedRaw, total] = await withAdminRole(async (tx) => {
        const grouped = await tx.lead.groupBy({
          by: ['status'],
          where,
          _count: { id: true },
        });
        const count = await tx.lead.count({ where });
        return [grouped, count] as const;
      });

      // Build map from groupBy results
      const countMap = new Map(groupedRaw.map((g) => [g.status, g._count.id]));

      const distribution = ALL_STATUSES.map((status) => {
        const count = countMap.get(status) ?? 0;
        return {
          status,
          count,
          percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
        };
      });

      return reply.send({
        data: {
          total,
          distribution,
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/pipeline · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular distribuição do pipeline.' });
    }
  });

  /**
   * GET /pipeline/conversion
   * Conversion rates between key funnel stages.
   */
  app.get('/pipeline/conversion', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = pipelineQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId } = parsed.data;

    try {
      const baseWhere: Prisma.LeadWhereInput = { deletedAt: null };
      if (tenantId) {
        baseWhere.tenantId = tenantId;
      }

      const conversions = await withAdminRole(async (tx) => {
        // Get counts for each status in one groupBy call
        const grouped = await tx.lead.groupBy({
          by: ['status'],
          where: baseWhere,
          _count: { id: true },
        });

        const countMap = new Map(grouped.map((g) => [g.status, g._count.id]));

        // For conversion: "fromCount" = all leads that reached at least that stage
        // "toCount" = all leads that reached at least the next stage
        const results = CONVERSION_PAIRS.map(({ from, to, label }) => {
          const fromStatuses = statusesAtOrAfter(from);
          const toStatuses = statusesAtOrAfter(to);

          const fromCount = fromStatuses.reduce((sum, s) => sum + (countMap.get(s) ?? 0), 0);
          const toCount = toStatuses.reduce((sum, s) => sum + (countMap.get(s) ?? 0), 0);
          const rate = fromCount > 0 ? Math.round((toCount / fromCount) * 10000) / 100 : 0;

          return { from, to, label, fromCount, toCount, rate };
        });

        // Overall: CAPTURED → CLOSED_WON
        const totalLeads = Array.from(countMap.values()).reduce((a, b) => a + b, 0);
        const closedWon = countMap.get(LeadStatus.CLOSED_WON) ?? 0;
        const overallRate = totalLeads > 0 ? Math.round((closedWon / totalLeads) * 10000) / 100 : 0;

        results.push({
          from: LeadStatus.CAPTURED,
          to: LeadStatus.CLOSED_WON,
          label: 'overall',
          fromCount: totalLeads,
          toCount: closedWon,
          rate: overallRate,
        });

        return results;
      });

      return reply.send({ data: { conversions } });
    } catch (err) {
      logger.error({ err }, 'admin/pipeline/conversion · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular taxas de conversão.' });
    }
  });

  /**
   * GET /pipeline/by-tenant
   * Top 10 tenants by lead count with status breakdown.
   */
  app.get('/pipeline/by-tenant', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await withAdminRole(async (tx) => {
        // Raw query: top 10 tenants by lead count with key status breakdown
        const rows = await tx.$queryRaw<
          Array<{
            tenant_id: string;
            tenant_name: string;
            total: bigint;
            captured: bigint;
            conversing: bigint;
            qualified: bigint;
            closed_won: bigint;
          }>
        >`
          SELECT
            l."tenant_id"                                                    AS tenant_id,
            t."name"                                                         AS tenant_name,
            COUNT(l."id")::bigint                                            AS total,
            COUNT(l."id") FILTER (WHERE l."status" = 'CAPTURED')::bigint     AS captured,
            COUNT(l."id") FILTER (WHERE l."status" = 'CONVERSING')::bigint   AS conversing,
            COUNT(l."id") FILTER (WHERE l."status" = 'QUALIFIED')::bigint    AS qualified,
            COUNT(l."id") FILTER (WHERE l."status" = 'CLOSED_WON')::bigint   AS closed_won
          FROM leads l
          JOIN tenants t ON l."tenant_id" = t."id"
          WHERE l."deleted_at" IS NULL
          GROUP BY l."tenant_id", t."name"
          ORDER BY total DESC
          LIMIT 10
        `;

        return rows.map((r) => ({
          tenantId: r.tenant_id,
          tenantName: r.tenant_name,
          total: Number(r.total),
          captured: Number(r.captured),
          conversing: Number(r.conversing),
          qualified: Number(r.qualified),
          closedWon: Number(r.closed_won),
        }));
      });

      return reply.send({ data: { tenants: result } });
    } catch (err) {
      logger.error({ err }, 'admin/pipeline/by-tenant · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular breakdown por tenant.' });
    }
  });
}
