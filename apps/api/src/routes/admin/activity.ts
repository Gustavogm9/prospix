/**
 * Endpoints admin para Activity Tracking (Gap 5).
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET /activity/logins   · lista sessões recentes com user info, IP, userAgent
 *  - GET /activity/summary  · resumo de atividade: sessões ativas, logins hoje/semana, top tenants, dormentes
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/* Query schemas                                                       */
/* ------------------------------------------------------------------ */

const loginsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerAdminActivityRoutes(app: FastifyInstance): void {
  /**
   * GET /activity/logins
   * Recent login sessions across all tenants with user info.
   */
  app.get('/activity/logins', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { tenantId, limit, offset } = parsed.data;

    try {
      const where: Prisma.SessionWhereInput = {};
      if (tenantId) {
        where.user = { tenantId };
      }

      const [items, total] = await Promise.all([
        prisma.session.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                tenantId: true,
                tenant: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        }),
        prisma.session.count({ where }),
      ]);

      return reply.send({
        data: {
          items: items.map((s) => ({
            id: s.id,
            userId: s.userId,
            userName: s.user.name,
            userEmail: s.user.email,
            userRole: s.user.role,
            tenantId: s.user.tenantId,
            tenantName: s.user.tenant?.name ?? null,
            tenantSlug: s.user.tenant?.slug ?? null,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            expiresAt: s.expiresAt.toISOString(),
            revokedAt: s.revokedAt?.toISOString() ?? null,
            createdAt: s.createdAt.toISOString(),
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/activity/logins · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar logins.' });
    }
  });

  /**
   * GET /activity/summary
   * Activity summary: active sessions, logins today/week, top tenants, dormant tenants.
   */
  app.get('/activity/summary', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const now = new Date();

      // Start of today (UTC)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

      // Start of 7 days ago
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // 30 days ago for top tenants
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // 14 days ago for dormancy
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const [activeSessions, loginsToday, loginsWeek, topTenantSessions, allActiveTenants] = await Promise.all([
        // Active sessions: not expired and not revoked
        prisma.session.count({
          where: {
            expiresAt: { gt: now },
            revokedAt: null,
          },
        }),

        // Logins today
        prisma.session.count({
          where: { createdAt: { gte: startOfToday } },
        }),

        // Logins this week
        prisma.session.count({
          where: { createdAt: { gte: startOfWeek } },
        }),

        // Top 10 most active tenants by session count last 30 days
        prisma.$queryRaw<Array<{ tenant_id: string; tenant_name: string; session_count: bigint }>>`
          SELECT u."tenant_id" AS tenant_id, t."name" AS tenant_name, COUNT(s."id")::bigint AS session_count
          FROM sessions s
          JOIN users u ON s."user_id" = u."id"
          JOIN tenants t ON u."tenant_id" = t."id"
          WHERE s."created_at" >= ${thirtyDaysAgo}
            AND u."tenant_id" IS NOT NULL
          GROUP BY u."tenant_id", t."name"
          ORDER BY session_count DESC
          LIMIT 10
        `,

        // All active tenants for dormancy check
        prisma.tenant.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          select: { id: true, name: true, slug: true },
        }),
      ]);

      // Dormant tenants: active tenants with no login in 14+ days
      const tenantsWithRecentLogin = await prisma.session.findMany({
        where: {
          createdAt: { gte: fourteenDaysAgo },
          user: { tenantId: { not: null } },
        },
        select: {
          user: { select: { tenantId: true } },
        },
        distinct: ['userId'],
      });

      const recentTenantIds = new Set(
        tenantsWithRecentLogin
          .map((s) => s.user.tenantId)
          .filter((id): id is string => id !== null),
      );

      const dormantTenants = allActiveTenants.filter((t) => !recentTenantIds.has(t.id));

      return reply.send({
        data: {
          activeSessions,
          loginsToday,
          loginsWeek,
          dormantTenants: dormantTenants.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
          })),
          dormantTenantsCount: dormantTenants.length,
          topTenants: topTenantSessions.map((r) => ({
            tenantId: r.tenant_id,
            tenantName: r.tenant_name,
            sessionCount: Number(r.session_count),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/activity/summary · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular resumo de atividade.' });
    }
  });
}
