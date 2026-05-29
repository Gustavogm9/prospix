/**
 * Endpoints admin para Referrals Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /referrals       · lista leads com source=REFERRAL cross-tenant
 *  - GET /referrals/stats · estatísticas de indicações (conversão, coletadas, top tenants)
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
      const where: Record<string, unknown> = { source: 'REFERRAL' };
      if (tenantId) where.tenantId = tenantId;

      if (from || to) {
        const createdAtFilter: Record<string, Date> = {};
        if (from) createdAtFilter.gte = new Date(from);
        if (to) createdAtFilter.lte = new Date(to);
        where.createdAt = createdAtFilter;
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
              tenantId: true,
              createdAt: true,
              tenant: { select: { id: true, name: true, slug: true } },
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
            tenantId: l.tenantId,
            tenant: l.tenant,
            createdAt: l.createdAt.toISOString(),
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/referrals · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar indicações.' });
    }
  });

  /**
   * GET /referrals/stats
   * Referral statistics: totals, conversion rate, collected from meetings, top tenants.
   */
  app.get('/referrals/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await withAdminRole(async (tx) => {
        const [totalReferrals, converted, meetingsAgg, topTenants] = await Promise.all([
          // Total leads with source=REFERRAL
          tx.lead.count({ where: { source: 'REFERRAL' } }),

          // Converted referrals (status in QUALIFIED, MEETING_SCHEDULED, CLOSED_WON)
          tx.lead.count({
            where: {
              source: 'REFERRAL',
              status: { in: [...CONVERTED_STATUSES] },
            },
          }),

          // Sum of referralsCount from Meeting model
          tx.meeting.aggregate({
            _sum: { referralsCount: true },
          }),

          // Top 5 tenants by referral count
          tx.lead.groupBy({
            by: ['tenantId'],
            where: { source: 'REFERRAL' },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 5,
          }),
        ]);

        // Resolve tenant names for top tenants
        const tenantIds = topTenants.map((t) => t.tenantId);
        const tenantNames = await tx.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        });
        const nameMap = new Map(tenantNames.map((t) => [t.id, t.name]));

        const conversionRate = totalReferrals > 0 ? Number(((converted / totalReferrals) * 100).toFixed(1)) : 0;

        return {
          totalReferrals,
          converted,
          conversionRate,
          referralsCollected: meetingsAgg._sum.referralsCount ?? 0,
          topTenants: topTenants.map((t) => ({
            tenantId: t.tenantId,
            tenantName: nameMap.get(t.tenantId) ?? 'Desconhecido',
            count: t._count.id,
          })),
        };
      });

      return reply.send({ data: stats });
    } catch (err) {
      logger.error({ err }, 'admin/referrals/stats · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de indicações.' });
    }
  });
}
