/**
 * Endpoints admin para Campaign Monitoring.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /campaigns       · lista campanhas cross-tenant com filtros
 *  - GET /campaigns/stats · estatísticas agregadas de campanhas
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Enums & Query schemas                                               */
/* ------------------------------------------------------------------ */

const CampaignStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
const ProfessionEnum = z.enum(['DOCTOR', 'LAWYER', 'DENTIST', 'ENTREPRENEUR', 'ENGINEER', 'ARCHITECT', 'ACCOUNTANT', 'OTHER']);

const campaignsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: CampaignStatusEnum.optional(),
  profession: ProfessionEnum.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminCampaignsRoutes(app: FastifyInstance): void {
  /**
   * GET /campaigns
   * Cross-tenant campaign listing with filters and pagination.
   */
  app.get('/campaigns', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = campaignsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId, status, profession, limit, offset } = parsed.data;

    try {
      const where: Prisma.CampaignWhereInput = {};
      if (tenantId) where.tenantId = tenantId;
      if (status) where.status = status;
      if (profession) where.profession = profession;

      const [items, total] = await Promise.all([
        prisma.campaign.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            tenant: {
              select: { id: true, name: true, slug: true },
            },
          },
        }),
        prisma.campaign.count({ where }),
      ]);

      return reply.send({
        data: {
          items: items.map((c) => ({
            id: c.id,
            tenantId: c.tenantId,
            tenantName: c.tenant?.name ?? null,
            tenantSlug: c.tenant?.slug ?? null,
            name: c.name,
            status: c.status,
            profession: c.profession,
            cities: c.cities,
            neighborhoods: c.neighborhoods,
            dailyLimit: c.dailyLimit,
            hourWindowStart: c.hourWindowStart,
            hourWindowEnd: c.hourWindowEnd,
            activeScriptId: c.activeScriptId,
            filters: c.filters,
            totalCaptured: c.totalCaptured,
            totalConversing: c.totalConversing,
            totalScheduled: c.totalScheduled,
            totalClosedWon: c.totalClosedWon,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
            archivedAt: c.archivedAt?.toISOString() ?? null,
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/campaigns · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar campanhas.' });
    }
  });

  /**
   * GET /campaigns/stats
   * Aggregated campaign statistics across all tenants.
   */
  app.get('/campaigns/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const [
        byStatus,
        totals,
        topTenantsByActiveCampaigns,
        byProfession,
      ] = await Promise.all([
        // Count by status
        prisma.campaign.groupBy({
          by: ['status'],
          _count: { id: true },
        }),

        // Global totals
        prisma.campaign.aggregate({
          _sum: {
            totalCaptured: true,
            totalConversing: true,
            totalScheduled: true,
            totalClosedWon: true,
          },
        }),

        // Top 5 tenants by active campaign count
        prisma.$queryRaw<Array<{ tenant_id: string; tenant_name: string; campaign_count: bigint }>>`
          SELECT c."tenant_id" AS tenant_id, t."name" AS tenant_name, COUNT(c."id")::bigint AS campaign_count
          FROM campaigns c
          JOIN tenants t ON c."tenant_id" = t."id"
          WHERE c."status" = 'ACTIVE'
          GROUP BY c."tenant_id", t."name"
          ORDER BY campaign_count DESC
          LIMIT 5
        `,

        // Count by profession
        prisma.campaign.groupBy({
          by: ['profession'],
          _count: { id: true },
        }),
      ]);

      // Normalize byStatus into a record
      const statusCounts: Record<string, number> = {};
      for (const row of byStatus) {
        statusCounts[row.status] = row._count.id;
      }

      // Normalize byProfession into a record
      const professionCounts: Record<string, number> = {};
      for (const row of byProfession) {
        professionCounts[row.profession] = row._count.id;
      }

      return reply.send({
        data: {
          byStatus: statusCounts,
          totals: {
            totalCaptured: totals._sum.totalCaptured ?? 0,
            totalConversing: totals._sum.totalConversing ?? 0,
            totalScheduled: totals._sum.totalScheduled ?? 0,
            totalClosedWon: totals._sum.totalClosedWon ?? 0,
          },
          topTenants: topTenantsByActiveCampaigns.map((r) => ({
            tenantId: r.tenant_id,
            tenantName: r.tenant_name,
            campaignCount: Number(r.campaign_count),
          })),
          byProfession: professionCounts,
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/campaigns/stats · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular estatísticas de campanhas.' });
    }
  });
}
