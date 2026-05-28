import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { tenantContextStorage } from '../../lib/tenant-context-storage.js';
import { UserRole } from '@prisma/client';
import { hashPassword } from '../../lib/crypto.js';
import { randomBytes } from 'crypto';

function withAdminRole<TResult>(operation: (tx: typeof prisma) => Promise<TResult>): Promise<TResult> {
  const store = tenantContextStorage.getStore();
  return tenantContextStorage.run(
    { tenantId: store?.tenantId ?? null, userId: store?.userId ?? null, bypassRls: true },
    () => operation(prisma)
  );
}

function generateTempPassword(): string {
  return randomBytes(6).toString('base64url').slice(0, 12);
}

export function registerAdminUserRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /users — List all users cross-tenant with filters
  // =========================================================================
  const listUsersSchema = z.object({
    tenantId: z.string().uuid().optional(),
    role: z.nativeEnum(UserRole).optional(),
    search: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  });

  app.get('/users', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listUsersSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Parâmetros inválidos.', issues: parsed.error.issues });
    }

    const { tenantId, role, search, limit, offset } = parsed.data;

    try {
      const where: Record<string, unknown> = { deletedAt: null };
      if (tenantId) where.tenantId = tenantId;
      if (role) where.role = role;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { whatsapp: { contains: search } },
        ];
      }

      const [users, total] = await withAdminRole(async (tx) => {
        return Promise.all([
          tx.user.findMany({
            where,
            select: {
              id: true,
              name: true,
              email: true,
              whatsapp: true,
              role: true,
              tenantId: true,
              susep: true,
              createdAt: true,
              updatedAt: true,
              deletedAt: true,
              tenant: { select: { id: true, name: true, slug: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
          }),
          tx.user.count({ where }),
        ]);
      });

      return reply.send({
        data: {
          items: users,
          pagination: { total, limit, offset, hasMore: offset + users.length < total },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/users · GET list failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar usuários.' });
    }
  });

  // =========================================================================
  // GET /users/:id — Get user detail
  // =========================================================================
  app.get('/users/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    try {
      const user = await withAdminRole((tx) =>
        tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            email: true,
            whatsapp: true,
            role: true,
            tenantId: true,
            susep: true,
            city: true,
            bio: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            tenant: { select: { id: true, name: true, slug: true, status: true } },
          },
        })
      );

      if (!user) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' });
      }

      return reply.send({ data: user });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id · GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao buscar usuário.' });
    }
  });

  // =========================================================================
  // POST /users — Create user for a tenant
  // =========================================================================
  const createUserSchema = z.object({
    tenantId: z.string().uuid(),
    name: z.string().min(1, 'Nome é obrigatório'),
    email: z.string().email('Email inválido'),
    whatsapp: z.string().min(1, 'WhatsApp é obrigatório'),
    role: z.enum(['OWNER', 'ASSISTANT']),
    susep: z.string().optional(),
  });

  app.post('/users', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message });
    }

    const data = parsed.data;
    const tempPassword = generateTempPassword();
    const passwordHash = hashPassword(tempPassword);

    try {
      const result = await withAdminRole(async (tx) => {
        // Check tenant exists
        const tenant = await tx.tenant.findUnique({ where: { id: data.tenantId }, select: { id: true, name: true } });
        if (!tenant) {
          return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Tenant não encontrado.' };
        }

        // Check email uniqueness
        const existing = await tx.user.findUnique({ where: { email: data.email } });
        if (existing) {
          return { ok: false as const, status: 409, code: 'CONFLICT', message: 'Email já cadastrado no sistema.' };
        }

        const user = await tx.user.create({
          data: {
            tenantId: data.tenantId,
            name: data.name,
            email: data.email,
            whatsapp: data.whatsapp,
            role: data.role as UserRole,
            susep: data.susep,
            passwordHash,
          },
          select: {
            id: true, name: true, email: true, role: true, tenantId: true, createdAt: true,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: req.userId,
            action: 'user.create',
            targetType: 'user',
            targetId: user.id,
            tenantId: data.tenantId,
            payload: { name: data.name, email: data.email, role: data.role },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        });

        return { ok: true as const, value: { ...user, tempPassword } };
      });

      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code, message: result.message });
      }

      return reply.code(201).send({ data: result.value });
    } catch (err) {
      logger.error({ err }, 'admin/users · POST create failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao criar usuário.' });
    }
  });

  // =========================================================================
  // PATCH /users/:id — Update user
  // =========================================================================
  const updateUserSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    whatsapp: z.string().optional(),
    role: z.enum(['OWNER', 'ASSISTANT']).optional(),
    susep: z.string().optional().nullable(),
  });

  app.patch('/users/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message });
    }

    try {
      const result = await withAdminRole(async (tx) => {
        const user = await tx.user.findUnique({ where: { id }, select: { id: true, tenantId: true, role: true, email: true } });
        if (!user) {
          return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' };
        }

        // If changing email, check uniqueness
        if (parsed.data.email && parsed.data.email !== user.email) {
          const collision = await tx.user.findUnique({ where: { email: parsed.data.email } });
          if (collision) {
            return { ok: false as const, status: 409, code: 'CONFLICT', message: 'Email já cadastrado.' };
          }
        }

        const updated = await tx.user.update({
          where: { id },
          data: parsed.data as any,
          select: { id: true, name: true, email: true, role: true, tenantId: true, updatedAt: true },
        });

        await tx.auditLog.create({
          data: {
            userId: req.userId,
            action: 'user.update',
            targetType: 'user',
            targetId: id,
            tenantId: user.tenantId,
            payload: parsed.data as any,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        });

        return { ok: true as const, value: updated };
      });

      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code, message: result.message });
      }

      return reply.send({ data: result.value });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id · PATCH failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao atualizar usuário.' });
    }
  });

  // =========================================================================
  // POST /users/:id/reset-password — Reset password (generates temp password)
  // =========================================================================
  app.post('/users/:id/reset-password', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const tempPassword = generateTempPassword();
    const passwordHash = hashPassword(tempPassword);

    try {
      const result = await withAdminRole(async (tx) => {
        const user = await tx.user.findUnique({ where: { id }, select: { id: true, tenantId: true, name: true, email: true } });
        if (!user) {
          return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' };
        }

        await tx.user.update({ where: { id }, data: { passwordHash } });

        // Revoke all active sessions for security
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            userId: req.userId,
            action: 'user.reset_password',
            targetType: 'user',
            targetId: id,
            tenantId: user.tenantId,
            payload: { user_name: user.name, user_email: user.email },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        });

        return { ok: true as const, value: { tempPassword, sessionsRevoked: true } };
      });

      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code, message: result.message });
      }

      return reply.send({ data: result.value });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id/reset-password · POST failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao resetar senha.' });
    }
  });

  // =========================================================================
  // DELETE /users/:id — Soft-delete user
  // =========================================================================
  app.delete('/users/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    try {
      const result = await withAdminRole(async (tx) => {
        const user = await tx.user.findUnique({ where: { id }, select: { id: true, tenantId: true, name: true, email: true, role: true } });
        if (!user) {
          return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' };
        }

        // Prevent deleting GUILDS_ADMIN users
        if (user.role === 'GUILDS_ADMIN') {
          return { ok: false as const, status: 403, code: 'FORBIDDEN', message: 'Não é permitido desativar administradores do sistema.' };
        }

        await tx.user.update({ where: { id }, data: { deletedAt: new Date() } });

        // Revoke sessions
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            userId: req.userId,
            action: 'user.deactivate',
            targetType: 'user',
            targetId: id,
            tenantId: user.tenantId,
            payload: { name: user.name, email: user.email, role: user.role },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        });

        return { ok: true as const };
      });

      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code, message: result.message });
      }

      return reply.send({ data: { message: 'Usuário desativado com sucesso.' } });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id · DELETE failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao desativar usuário.' });
    }
  });

  // =========================================================================
  // POST /users/:id/reactivate — Reactivate soft-deleted user
  // =========================================================================
  app.post('/users/:id/reactivate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    try {
      const result = await withAdminRole(async (tx) => {
        const user = await tx.user.findUnique({ where: { id }, select: { id: true, tenantId: true, name: true, deletedAt: true } });
        if (!user) {
          return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' };
        }
        if (!user.deletedAt) {
          return { ok: false as const, status: 400, code: 'VALIDATION', message: 'Usuário já está ativo.' };
        }

        await tx.user.update({ where: { id }, data: { deletedAt: null } });

        await tx.auditLog.create({
          data: {
            userId: req.userId,
            action: 'user.reactivate',
            targetType: 'user',
            targetId: id,
            tenantId: user.tenantId,
            payload: { name: user.name },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        });

        return { ok: true as const };
      });

      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code, message: result.message });
      }

      return reply.send({ data: { message: 'Usuário reativado com sucesso.' } });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id/reactivate · POST failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao reativar usuário.' });
    }
  });
}
