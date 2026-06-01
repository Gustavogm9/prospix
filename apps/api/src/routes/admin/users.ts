import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { UserRole } from '@prospix/shared-types';
import { hashPassword } from '../../lib/crypto.js';
import { randomBytes, randomUUID } from 'crypto';

function generateTempPassword(): string {
  return randomBytes(6).toString('base64url').slice(0, 12);
}

export function registerAdminUserRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /users - List all users cross-tenant with filters
  // =========================================================================
  const listUsersSchema = z.object({
    tenantId: z.string().uuid().optional(),
    role: z.enum(['OWNER', 'ASSISTANT', 'GUILDS_ADMIN']).optional(),
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
      let query = dbAdmin
        .from('users')
        .select('id, name, email, whatsapp, role, tenant_id, susep, created_at, updated_at, deleted_at, tenants(id, name, slug, status)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (role) query = query.eq('role', role);
      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,whatsapp.ilike.%${search}%`);
      }

      const { data: users, error } = await query;
      if (error) throw error;

      // Count
      let countQuery = dbAdmin.from('users').select('*', { count: 'exact', head: true }).is('deleted_at', null);
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (role) countQuery = countQuery.eq('role', role);
      if (search) {
        countQuery = countQuery.or(`name.ilike.%${search}%,email.ilike.%${search}%,whatsapp.ilike.%${search}%`);
      }

      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      return reply.send({
        data: {
          items: (users ?? []).map((u: any) => ({
            ...u,
            tenantId: u.tenant_id,
            tenant: u.tenants,
            tenants: undefined,
            createdAt: u.created_at,
            updatedAt: u.updated_at,
            deletedAt: u.deleted_at,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (users?.length ?? 0) < (total ?? 0) },
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/users → GET list failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar usuários.' });
    }
  });

  // =========================================================================
  // GET /users/:id - Get user detail
  // =========================================================================
  app.get('/users/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    try {
      const { data: user, error } = await dbAdmin
        .from('users')
        .select('id, name, email, whatsapp, role, tenant_id, susep, city, bio, created_at, updated_at, deleted_at, tenants(id, name, slug, status)')
        .eq('id', id)
        .single();

      if (error || !user) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' });
      }

      return reply.send({
        data: {
          ...user,
          tenantId: user.tenant_id,
          tenant: (user as any).tenants,
          tenants: undefined,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
          deletedAt: user.deleted_at,
        },
      });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao buscar usuário.' });
    }
  });

  // =========================================================================
  // POST /users - Create user for a tenant
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
      // Check tenant exists
      const { data: tenant, error: tenantErr } = await dbAdmin
        .from('tenants')
        .select('id, name')
        .eq('id', data.tenantId)
        .single();
      if (tenantErr || !tenant) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant não encontrado.' });
      }

      // Check email uniqueness
      const { data: existing } = await dbAdmin
        .from('users')
        .select('id')
        .eq('email', data.email)
        .maybeSingle();
      if (existing) {
        return reply.code(409).send({ error: 'CONFLICT', message: 'Email já cadastrado no sistema.' });
      }

      const { data: user, error: createErr } = await dbAdmin
        .from('users')
        .insert({
          id: randomUUID(),
          tenant_id: data.tenantId,
          name: data.name,
          email: data.email,
          whatsapp: data.whatsapp,
          role: data.role as UserRole,
          susep: data.susep ?? null,
          password_hash: passwordHash,
          updated_at: new Date().toISOString(),
        })
        .select('id, name, email, role, tenant_id, created_at')
        .single();
      if (createErr) throw createErr;

      // Audit log
      await dbAdmin.from('audit_log').insert({
        user_id: req.userId,
        action: 'user.create',
        target_type: 'user',
        target_id: user.id,
        tenant_id: data.tenantId,
        payload: { name: data.name, email: data.email, role: data.role },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });

      return reply.code(201).send({
        data: {
          ...user,
          tenantId: user.tenant_id,
          createdAt: user.created_at,
          tempPassword,
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/users → POST create failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao criar usuário.' });
    }
  });

  // =========================================================================
  // PATCH /users/:id - Update user
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
      const { data: user, error: findErr } = await dbAdmin
        .from('users')
        .select('id, tenant_id, role, email')
        .eq('id', id)
        .single();
      if (findErr || !user) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' });
      }

      // If changing email, check uniqueness
      if (parsed.data.email && parsed.data.email !== user.email) {
        const { data: collision } = await dbAdmin
          .from('users')
          .select('id')
          .eq('email', parsed.data.email)
          .maybeSingle();
        if (collision) {
          return reply.code(409).send({ error: 'CONFLICT', message: 'Email já cadastrado.' });
        }
      }

      // Build update data with snake_case
      const updateData: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
      if (parsed.data.whatsapp !== undefined) updateData.whatsapp = parsed.data.whatsapp;
      if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
      if (parsed.data.susep !== undefined) updateData.susep = parsed.data.susep;

      const { data: updated, error: updateErr } = await dbAdmin
        .from('users')
        .update(updateData as any)
        .eq('id', id)
        .select('id, name, email, role, tenant_id, updated_at')
        .single();
      if (updateErr) throw updateErr;

      // Audit log
      await dbAdmin.from('audit_log').insert({
        user_id: req.userId,
        action: 'user.update',
        target_type: 'user',
        target_id: id,
        tenant_id: user.tenant_id,
        payload: parsed.data as any,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });

      return reply.send({
        data: {
          ...updated,
          tenantId: updated.tenant_id,
          updatedAt: updated.updated_at,
        },
      });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id → PATCH failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao atualizar usuário.' });
    }
  });

  // =========================================================================
  // POST /users/:id/reset-password - Reset password (generates temp password)
  // =========================================================================
  app.post('/users/:id/reset-password', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const tempPassword = generateTempPassword();
    const passwordHash = hashPassword(tempPassword);

    try {
      const { data: user, error: findErr } = await dbAdmin
        .from('users')
        .select('id, tenant_id, name, email')
        .eq('id', id)
        .single();
      if (findErr || !user) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' });
      }

      // Update password
      const { error: updateErr } = await dbAdmin
        .from('users')
        .update({ password_hash: passwordHash })
        .eq('id', id);
      if (updateErr) throw updateErr;

      // Revoke all active sessions for security
      const { error: revokeErr } = await dbAdmin
        .from('sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', id)
        .is('revoked_at', null);
      if (revokeErr) throw revokeErr;

      // Audit log
      await dbAdmin.from('audit_log').insert({
        user_id: req.userId,
        action: 'user.reset_password',
        target_type: 'user',
        target_id: id,
        tenant_id: user.tenant_id,
        payload: { user_name: user.name, user_email: user.email },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });

      return reply.send({ data: { tempPassword, sessionsRevoked: true } });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id/reset-password → POST failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao resetar senha.' });
    }
  });

  // =========================================================================
  // DELETE /users/:id - Soft-delete user
  // =========================================================================
  app.delete('/users/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    try {
      const { data: user, error: findErr } = await dbAdmin
        .from('users')
        .select('id, tenant_id, name, email, role')
        .eq('id', id)
        .single();
      if (findErr || !user) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' });
      }

      // Prevent deleting GUILDS_ADMIN users
      if (user.role === 'GUILDS_ADMIN') {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Não é permitido desativar administradores do sistema.' });
      }

      // Soft delete
      const { error: delErr } = await dbAdmin
        .from('users')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (delErr) throw delErr;

      // Revoke sessions
      const { error: revokeErr } = await dbAdmin
        .from('sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', id)
        .is('revoked_at', null);
      if (revokeErr) throw revokeErr;

      // Audit log
      await dbAdmin.from('audit_log').insert({
        user_id: req.userId,
        action: 'user.deactivate',
        target_type: 'user',
        target_id: id,
        tenant_id: user.tenant_id,
        payload: { name: user.name, email: user.email, role: user.role },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });

      return reply.send({ data: { message: 'Usuário desativado com sucesso.' } });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id → DELETE failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao desativar usuário.' });
    }
  });

  // =========================================================================
  // POST /users/:id/reactivate - Reactivate soft-deleted user
  // =========================================================================
  app.post('/users/:id/reactivate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    try {
      const { data: user, error: findErr } = await dbAdmin
        .from('users')
        .select('id, tenant_id, name, deleted_at')
        .eq('id', id)
        .single();
      if (findErr || !user) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' });
      }
      if (!user.deleted_at) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Usuário já está ativo.' });
      }

      const { error: updateErr } = await dbAdmin
        .from('users')
        .update({ deleted_at: null })
        .eq('id', id);
      if (updateErr) throw updateErr;

      // Audit log
      await dbAdmin.from('audit_log').insert({
        user_id: req.userId,
        action: 'user.reactivate',
        target_type: 'user',
        target_id: id,
        tenant_id: user.tenant_id,
        payload: { name: user.name },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });

      return reply.send({ data: { message: 'Usuário reativado com sucesso.' } });
    } catch (err) {
      logger.error({ err, id }, 'admin/users/:id/reactivate → POST failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao reativar usuário.' });
    }
  });
}
