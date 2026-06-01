/**
 * Endpoints admin para gestão de Feature Flags / Kill Switches.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Convenções de chaves:
 *  - `evolution.outbound_disabled` → pausa envio WhatsApp (tenant-específico ou global)
 *  - `ai.disabled` → desliga IA (continua manual)
 *  - `lead_capture.disabled` → pausa captura novos leads
 *  - `<area>.<comportamento>` snake_case
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger.js';
import { invalidateFeatureFlagCache } from '../../lib/feature-flags.js';

const KEY_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const createSchema = z.object({
  key: z.string().min(3).max(120).regex(KEY_REGEX, 'Use formato snake_case com pontos – ex: ai.disabled'),
  tenantId: z.string().uuid().nullable().optional(),
  enabled: z.boolean(),
  reason: z.string().max(2000).optional(),
});

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  reason: z.string().max(2000).nullable().optional(),
});

const listQuerySchema = z.object({
  key: z.string().min(1).max(120).optional(),
  tenantId: z.string().uuid().optional(),
  scope: z.enum(['global', 'tenant', 'all']).optional().default('all'),
});

export function registerAdminFeatureFlagsRoutes(app: FastifyInstance): void {
  app.get('/feature-flags', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    const { key, tenantId, scope } = parsed.data;
    try {
      let query = dbAdmin
        .from('feature_flags')
        .select('*, tenants(id, name, slug)')
        .order('key', { ascending: true })
        .order('tenant_id', { ascending: true });

      if (key) query = query.eq('key', key);
      if (tenantId) query = query.eq('tenant_id', tenantId);
      else if (scope === 'global') query = query.is('tenant_id', null);
      else if (scope === 'tenant') query = query.not('tenant_id', 'is', null);

      const { data: flags, error } = await query;
      if (error) throw error;

      return reply.send({ data: (flags ?? []).map((f: any) => ({ ...f, tenant: f.tenants, tenants: undefined, createdAt: f.created_at, updatedAt: f.updated_at })) });
    } catch (err) {
      logger.error({ err }, 'admin/feature-flags → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar flags.' });
    }
  });

  app.post('/feature-flags', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Payload inválido.', issues: parsed.error.issues });
    const { key, tenantId, enabled, reason } = parsed.data;
    try {
      if (tenantId) {
        const { data: tenant } = await dbAdmin
          .from('tenants')
          .select('id')
          .eq('id', tenantId)
          .single();
        if (!tenant) return reply.code(400).send({ error: 'VALIDATION', message: 'tenantId não corresponde a tenant existente.' });
      }
      // Check existing flag (NULL-safe for tenant_id)
      let existingQuery = dbAdmin
        .from('feature_flags')
        .select('*')
        .eq('key', key);
      existingQuery = tenantId
        ? existingQuery.eq('tenant_id', tenantId)
        : existingQuery.is('tenant_id', null);

      const { data: existingArr } = await existingQuery;
      const existing = existingArr?.[0];

      let saved: any;
      if (existing) {
        const { data, error } = await dbAdmin
          .from('feature_flags')
          .update({ enabled, reason: reason ?? null })
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await dbAdmin
          .from('feature_flags')
          .insert({ id: randomUUID(), key, tenant_id: tenantId ?? null, enabled, reason: reason ?? null, updated_at: new Date().toISOString() })
          .select()
          .single();
        if (error) throw error;
        saved = data;
      }
      invalidateFeatureFlagCache(key, tenantId ?? null);
      return reply.send({ data: { ...saved, createdAt: saved.created_at, updatedAt: saved.updated_at } });
    } catch (err) {
      logger.error({ err, key, tenantId }, 'admin/feature-flags → POST failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao salvar flag.' });
    }
  });

  app.patch('/feature-flags/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Payload inválido.', issues: parsed.error.issues });
    try {
      const { data: existing, error: findErr } = await dbAdmin
        .from('feature_flags')
        .select('*')
        .eq('id', id)
        .single();
      if (findErr || !existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Flag não encontrada.' });
      const data: Record<string, unknown> = {};
      if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
      if (parsed.data.reason !== undefined) data.reason = parsed.data.reason;
      const { data: updated, error: updateErr } = await dbAdmin
        .from('feature_flags')
        .update(data as any)
        .eq('id', id)
        .select()
        .single();
      if (updateErr) throw updateErr;
      invalidateFeatureFlagCache(existing.key, existing.tenant_id);
      return reply.send({ data: { ...updated, createdAt: updated.created_at, updatedAt: updated.updated_at } });
    } catch (err) {
      logger.error({ err, id }, 'admin/feature-flags → PATCH failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao atualizar flag.' });
    }
  });

  app.delete('/feature-flags/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const { data: existing, error: findErr } = await dbAdmin
        .from('feature_flags')
        .select('*')
        .eq('id', id)
        .single();
      if (findErr || !existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Flag não encontrada.' });
      const { error: delErr } = await dbAdmin.from('feature_flags').delete().eq('id', id);
      if (delErr) throw delErr;
      invalidateFeatureFlagCache(existing.key, existing.tenant_id);
      return reply.send({ data: { id, deleted: true } });
    } catch (err) {
      logger.error({ err, id }, 'admin/feature-flags → DELETE failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao remover flag.' });
    }
  });
}
