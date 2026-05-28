import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { tenantContextStorage } from '../../lib/tenant-context-storage.js';
import { randomBytes } from 'crypto';

function withAdminRole<TResult>(operation: (tx: typeof prisma) => Promise<TResult>): Promise<TResult> {
  const store = tenantContextStorage.getStore();
  return tenantContextStorage.run(
    { tenantId: store?.tenantId ?? null, userId: store?.userId ?? null, bypassRls: true },
    () => operation(prisma)
  );
}

export function registerAdminImpersonationRoutes(app: FastifyInstance) {
  // =========================================================================
  // POST /impersonate/:tenantId/:userId — Start impersonation session
  // =========================================================================
  const startImpersonationSchema = z.object({
    reason: z.string().min(5, 'Motivo deve ter pelo menos 5 caracteres').max(500),
    mode: z.enum(['READ_ONLY', 'FULL_ACCESS']).default('READ_ONLY'),
  });

  app.post('/impersonate/:tenantId/:userId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, userId } = req.params as { tenantId: string; userId: string };
    const parsed = startImpersonationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message });
    }

    const { reason, mode } = parsed.data;
    const adminId = req.userId!;

    try {
      const result = await withAdminRole(async (tx) => {
        // 1. Validate target tenant exists
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true, slug: true, status: true },
        });
        if (!tenant) {
          return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Tenant não encontrado.' };
        }

        // 2. Validate target user exists and belongs to tenant
        const targetUser = await tx.user.findFirst({
          where: { id: userId, tenantId, deletedAt: null },
          select: { id: true, name: true, email: true, role: true },
        });
        if (!targetUser) {
          return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado neste tenant.' };
        }

        // 3. Check no active impersonation session for this admin
        const existingSession = await tx.auditLog.findFirst({
          where: {
            userId: adminId,
            action: 'impersonation.start',
            createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // last 2 hours
          },
          orderBy: { createdAt: 'desc' },
        });

        // Check if there's an end for this session
        if (existingSession) {
          const endSession = await tx.auditLog.findFirst({
            where: {
              userId: adminId,
              action: 'impersonation.end',
              createdAt: { gt: existingSession.createdAt },
            },
          });
          if (!endSession) {
            return { ok: false as const, status: 409, code: 'CONFLICT', message: 'Já existe uma sessão de impersonificação ativa. Encerre-a primeiro.' };
          }
        }

        // 4. Generate impersonation token
        const sessionId = randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

        // 5. Create JWT with impersonation claims
        const impersonationToken = app.jwt.sign({
          sub: targetUser.id,
          tenant_id: tenantId,
          role: targetUser.role,
          email: targetUser.email,
          name: targetUser.name,
          imp: true,
          imp_admin_id: adminId,
          imp_session_id: sessionId,
          imp_mode: mode,
        }, { expiresIn: '2h' });

        // 6. Audit log
        await tx.auditLog.create({
          data: {
            userId: adminId,
            action: 'impersonation.start',
            targetType: 'user',
            targetId: userId,
            tenantId,
            payload: {
              session_id: sessionId,
              target_user_name: targetUser.name,
              target_user_email: targetUser.email,
              target_tenant_name: tenant.name,
              reason,
              mode,
              expires_at: expiresAt.toISOString(),
            },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        });

        // 7. Create notification for tenant owner
        const owners = await tx.user.findMany({
          where: { tenantId, role: 'OWNER', deletedAt: null },
          select: { id: true },
        });

        for (const owner of owners) {
          await tx.notification.create({
            data: {
              userId: owner.id,
              tenantId,
              type: 'SYSTEM',
              title: 'Acesso administrativo ao seu sistema',
              body: `Um administrador do Prospix acessou seu sistema em modo ${mode === 'READ_ONLY' ? 'somente leitura' : 'acesso completo'}. Motivo: ${reason}`,
              link: null,
            },
          });
        }

        return {
          ok: true as const,
          value: {
            impersonationToken,
            sessionId,
            expiresAt: expiresAt.toISOString(),
            mode,
            targetUser: {
              id: targetUser.id,
              name: targetUser.name,
              email: targetUser.email,
              role: targetUser.role,
            },
            targetTenant: {
              id: tenant.id,
              name: tenant.name,
              slug: tenant.slug,
            },
          },
        };
      });

      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code, message: result.message });
      }

      return reply.send({ data: result.value });
    } catch (err) {
      logger.error({ err, tenantId, userId }, 'admin/impersonate · start failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao iniciar impersonificação.' });
    }
  });

  // =========================================================================
  // POST /impersonate/end — End impersonation session
  // =========================================================================
  const endImpersonationSchema = z.object({
    sessionId: z.string().min(1),
  });

  app.post('/impersonate/end', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = endImpersonationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Session ID é obrigatório.' });
    }

    const { sessionId } = parsed.data;
    const adminId = req.userId!;

    try {
      await withAdminRole(async (tx) => {
        await tx.auditLog.create({
          data: {
            userId: adminId,
            action: 'impersonation.end',
            targetType: 'session',
            targetId: sessionId,
            payload: { session_id: sessionId },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        });
      });

      return reply.send({ data: { message: 'Sessão de impersonificação encerrada.' } });
    } catch (err) {
      logger.error({ err, sessionId }, 'admin/impersonate · end failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao encerrar impersonificação.' });
    }
  });

  // =========================================================================
  // GET /impersonate/active — List active impersonation sessions
  // =========================================================================
  app.get('/impersonate/active', async (_req, reply) => {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const sessions = await withAdminRole(async (tx) => {
        // Get recent impersonation starts
        const starts = await tx.auditLog.findMany({
          where: {
            action: 'impersonation.start',
            createdAt: { gte: twoHoursAgo },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        });

        // Get ends for same period
        const ends = await tx.auditLog.findMany({
          where: {
            action: 'impersonation.end',
            createdAt: { gte: twoHoursAgo },
          },
          select: { payload: true },
        });

        const endedSessionIds = new Set(
          ends.map((e) => (e.payload as any)?.session_id).filter(Boolean)
        );

        // Filter to only active sessions
        return starts
          .filter((s) => !endedSessionIds.has((s.payload as any)?.session_id))
          .map((s) => ({
            sessionId: (s.payload as any)?.session_id,
            admin: s.user,
            targetUserName: (s.payload as any)?.target_user_name,
            targetTenantName: (s.payload as any)?.target_tenant_name,
            mode: (s.payload as any)?.mode,
            reason: (s.payload as any)?.reason,
            startedAt: s.createdAt.toISOString(),
            expiresAt: (s.payload as any)?.expires_at,
          }));
      });

      return reply.send({ data: sessions });
    } catch (err) {
      logger.error({ err }, 'admin/impersonate/active · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar sessões ativas.' });
    }
  });
}
