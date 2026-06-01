/**
 * Endpoints admin para Operational Alerts.
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 *
 * Endpoints:
 *  - GET    /alerts          → lista alertas com filtros (severity/type/resolved/tenant)
 *  - POST   /alerts/scan     → trigger sync – útil para validar sem esperar scheduler diário
 *  - PATCH  /alerts/:id/ack  → marca como acknowledged (mas não resolvido)
 *  - PATCH  /alerts/:id/resolve → resolve o alerta (sai do feed)
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { runAlertScan } from '../../lib/alert-scanner.js';

const listQuerySchema = z.object({
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL'] as [string, ...string[]]).optional(),
  type: z.string().min(1).max(120).optional(),
  tenantId: z.string().uuid().optional(),
  status: z.enum(['open', 'acked', 'resolved', 'all']).optional().default('open'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export function registerAdminAlertsRoutes(app: FastifyInstance): void {
  app.get('/alerts', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    const { severity, type, tenantId, status, limit, offset } = parsed.data;
    try {
      // Build items query
      let query = dbAdmin
        .from('operational_alerts')
        .select('*, tenants(id, name, slug), users!operational_alerts_ack_by_id_fkey(id, name, email)')
        .order('severity', { ascending: true })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (severity) query = query.eq('severity', severity as any);
      if (type) query = query.eq('type', type);
      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (status === 'open') query = query.is('resolved_at', null);
      else if (status === 'acked') { query = query.is('resolved_at', null).not('ack_at', 'is', null); }
      else if (status === 'resolved') query = query.not('resolved_at', 'is', null);

      const { data: items, error } = await query;
      if (error) throw error;

      // Build count query
      let countQuery = dbAdmin
        .from('operational_alerts')
        .select('*', { count: 'exact', head: true });

      if (severity) countQuery = countQuery.eq('severity', severity as any);
      if (type) countQuery = countQuery.eq('type', type);
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (status === 'open') countQuery = countQuery.is('resolved_at', null);
      else if (status === 'acked') { countQuery = countQuery.is('resolved_at', null).not('ack_at', 'is', null); }
      else if (status === 'resolved') countQuery = countQuery.not('resolved_at', 'is', null);

      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      // Severity summary (open alerts only)
      const summary: Record<string, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
      for (const sev of ['CRITICAL', 'WARNING', 'INFO']) {
        const { count, error: sevErr } = await dbAdmin
          .from('operational_alerts')
          .select('*', { count: 'exact', head: true })
          .is('resolved_at', null)
          .eq('severity', sev as any);
        if (sevErr) throw sevErr;
        summary[sev] = count ?? 0;
      }

      return reply.send({
        data: {
          items: (items ?? []).map((a: any) => ({
            id: a.id,
            type: a.type,
            severity: a.severity,
            tenantId: a.tenant_id,
            tenant: a.tenants,
            title: a.title,
            message: a.message,
            context: a.context,
            dedupKey: a.dedup_key,
            ackById: a.ack_by_id,
            ackBy: a.users,
            ackAt: a.ack_at ?? null,
            resolvedAt: a.resolved_at ?? null,
            createdAt: a.created_at,
            updatedAt: a.updated_at,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
          summary,
        },
      });
    } catch (err) {
      logger.error({ err }, 'admin/alerts → GET failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar alertas.' });
    }
  });

  app.post('/alerts/scan', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await runAlertScan({ autoResolve: true });
      return reply.send({ data: result });
    } catch (err) {
      logger.error({ err }, 'admin/alerts/scan → POST failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao executar scan.' });
    }
  });

  const ackBodySchema = z.object({
    actorUserId: z.string().uuid().optional(),
  });

  app.patch('/alerts/:id/ack', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = ackBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Payload inválido.', issues: parsed.error.issues });
    try {
      const { data: existing, error: findErr } = await dbAdmin
        .from('operational_alerts')
        .select('*')
        .eq('id', id)
        .single();
      if (findErr || !existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Alerta não encontrado.' });
      if (existing.resolved_at) return reply.code(409).send({ error: 'CONFLICT', message: 'Alerta já resolvido.' });
      const { data: updated, error: updateErr } = await dbAdmin
        .from('operational_alerts')
        .update({ ack_by_id: parsed.data.actorUserId ?? null, ack_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (updateErr) throw updateErr;
      return reply.send({ data: { id: updated.id, ackAt: updated.ack_at } });
    } catch (err) {
      logger.error({ err, id }, 'admin/alerts/:id/ack failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao ack.' });
    }
  });

  app.patch('/alerts/:id/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const { data: existing, error: findErr } = await dbAdmin
        .from('operational_alerts')
        .select('*')
        .eq('id', id)
        .single();
      if (findErr || !existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Alerta não encontrado.' });
      if (existing.resolved_at) return reply.send({ data: { id, alreadyResolved: true, resolvedAt: existing.resolved_at } });
      const { data: updated, error: updateErr } = await dbAdmin
        .from('operational_alerts')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (updateErr) throw updateErr;
      return reply.send({ data: { id: updated.id, resolvedAt: updated.resolved_at } });
    } catch (err) {
      logger.error({ err, id }, 'admin/alerts/:id/resolve failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao resolver.' });
    }
  });
}
