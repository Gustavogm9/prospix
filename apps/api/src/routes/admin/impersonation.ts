import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { randomBytes, randomUUID } from 'crypto';

export function registerAdminImpersonationRoutes(app: FastifyInstance) {
  // =========================================================================
  // POST /impersonate/:tenantId/:userId - Start impersonation session
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
      // 1. Validate target tenant exists
      const { data: tenant, error: tenantErr } = await dbAdmin
        .from('tenants')
        .select('id, name, slug, status')
        .eq('id', tenantId)
        .single();
      if (tenantErr || !tenant) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant não encontrado.' });
      }

      // 2. Validate target user exists and belongs to tenant
      const { data: targetUser, error: userErr } = await dbAdmin
        .from('users')
        .select('id, name, email, role')
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .single();
      if (userErr || !targetUser) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado neste tenant.' });
      }

      // 3. Check no active impersonation session for this admin
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const { data: existingSession } = await dbAdmin
        .from('audit_log')
        .select('*')
        .eq('user_id', adminId)
        .eq('action', 'impersonation.start')
        .gte('created_at', twoHoursAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSession) {
        const { data: endSession } = await dbAdmin
          .from('audit_log')
          .select('*')
          .eq('user_id', adminId)
          .eq('action', 'impersonation.end')
          .gt('created_at', existingSession.created_at)
          .limit(1)
          .maybeSingle();

        if (!endSession) {
          return reply.code(409).send({ error: 'CONFLICT', message: 'Já existe uma sessão de impersonificação ativa. Encerre-a primeiro.' });
        }
      }

      // 4. Generate impersonation token
      const sessionId = randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

      // 5. Create impersonation session reference token
      const impersonationToken = Buffer.from(JSON.stringify({
        sub: targetUser.id,
        tenant_id: tenantId,
        role: targetUser.role,
        imp: true,
        imp_admin_id: adminId,
        imp_session_id: sessionId,
        imp_mode: mode,
        exp: Math.floor(expiresAt.getTime() / 1000),
      })).toString('base64url');

      // 6. Audit log
      const { error: auditErr } = await dbAdmin.from('audit_log').insert({
        user_id: adminId,
        action: 'impersonation.start',
        target_type: 'user',
        target_id: userId,
        tenant_id: tenantId,
        payload: {
          session_id: sessionId,
          target_user_name: targetUser.name,
          target_user_email: targetUser.email,
          target_tenant_name: tenant.name,
          reason,
          mode,
          expires_at: expiresAt.toISOString(),
        },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });
      if (auditErr) throw auditErr;

      // 7. Create notification for tenant owner
      const { data: owners } = await dbAdmin
        .from('users')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('role', 'OWNER')
        .is('deleted_at', null);

      for (const owner of owners ?? []) {
        await dbAdmin.from('notifications').insert({
          id: randomUUID(),
          user_id: owner.id,
          tenant_id: tenantId,
          type: 'SYSTEM',
          title: 'Acesso administrativo ao seu sistema',
          body: `Um administrador do Prospix acessou seu sistema em modo ${mode === 'READ_ONLY' ? 'somente leitura' : 'acesso completo'}. Motivo: ${reason}`,
          link: null,
        });
      }

      return reply.send({
        data: {
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
      });
    } catch (err) {
      logger.error({ err, tenantId, userId }, 'admin/impersonate → start failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao iniciar impersonificação.' });
    }
  });

  // =========================================================================
  // POST /impersonate/end - End impersonation session
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
      const { error: auditErr } = await dbAdmin.from('audit_log').insert({
        user_id: adminId,
        action: 'impersonation.end',
        target_type: 'session',
        target_id: sessionId,
        payload: { session_id: sessionId },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] ?? null,
      });
      if (auditErr) throw auditErr;

      return reply.send({ data: { message: 'Sessão de impersonificação encerrada.' } });
    } catch (err) {
      logger.error({ err, sessionId }, 'admin/impersonate → end failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao encerrar impersonificação.' });
    }
  });

  // =========================================================================
  // GET /impersonate/active - List active impersonation sessions
  // =========================================================================
  app.get('/impersonate/active', async (_req, reply) => {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      // Get recent impersonation starts
      const { data: starts, error: startsErr } = await dbAdmin
        .from('audit_log')
        .select('*, users!audit_log_user_id_fkey(id, name, email)')
        .eq('action', 'impersonation.start')
        .gte('created_at', twoHoursAgo.toISOString())
        .order('created_at', { ascending: false });
      if (startsErr) throw startsErr;

      // Get ends for same period
      const { data: ends, error: endsErr } = await dbAdmin
        .from('audit_log')
        .select('payload')
        .eq('action', 'impersonation.end')
        .gte('created_at', twoHoursAgo.toISOString());
      if (endsErr) throw endsErr;

      const endedSessionIds = new Set(
        (ends ?? []).map((e: any) => (e.payload as any)?.session_id).filter(Boolean)
      );

      // Filter to only active sessions
      const sessions = (starts ?? [])
        .filter((s: any) => !endedSessionIds.has((s.payload as any)?.session_id))
        .map((s: any) => ({
          sessionId: (s.payload as any)?.session_id,
          admin: s.users,
          targetUserName: (s.payload as any)?.target_user_name,
          targetTenantName: (s.payload as any)?.target_tenant_name,
          mode: (s.payload as any)?.mode,
          reason: (s.payload as any)?.reason,
          startedAt: s.created_at,
          expiresAt: (s.payload as any)?.expires_at,
        }));

      return reply.send({ data: sessions });
    } catch (err) {
      logger.error({ err }, 'admin/impersonate/active → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar sessões ativas.' });
    }
  });
}
