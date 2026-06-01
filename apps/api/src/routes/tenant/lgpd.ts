/**
 * Endpoints LGPD operacional — AUD-P2-033.
 *
 * Permite ao owner do tenant solicitar:
 *  - EXPORT_DATA       → portabilidade (art. 18 V)
 *  - DELETE_TENANT_DATA → exclusão do tenant inteiro (art. 18 VI)
 *  - DELETE_LEAD_DATA  → exclusão de um lead específico (art. 18 VI)
 *  - CORRECT_DATA      → correção (art. 18 III)
 *  - CONFIRM_DATA      → confirmação (art. 18 I)
 *
 * Fluxo MVP:
 *  1. Owner POST /v1/tenant/lgpd/requests → cria registro com status PENDING
 *  2. Endpoint retorna 202 com `request_id`
 *  3. Operador Guilds (super-admin) processa manualmente em <= 15 dias
 *     (queue worker virá em iteração futura — AUD-P2-033 fix incremental)
 *  4. Quando processed, status -> COMPLETED + downloadUrl preenchido se aplicável
 *  5. Owner GET /v1/tenant/lgpd/requests vê histórico + status
 *
 * Rate limit: 3 requests/hora por tenant (anti-abuso).
 */
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { createTenantQueue } from '../../lib/queue.js';
import { LgpdRequestType, LgpdRequestStatus } from '@prospix/shared-types';

const createRequestSchema = z.object({
  type: z.nativeEnum(LgpdRequestType),
  scope: z.record(z.unknown()).optional(),
}).superRefine((data, ctx) => {
  const scope = data.scope as Record<string, unknown> | undefined;

  // Validation per type
  if (data.type === 'DELETE_LEAD_DATA') {
    const lead = scope?.lead_whatsapp;
    if (!lead || typeof lead !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scope.lead_whatsapp obrigatorio para DELETE_LEAD_DATA',
        path: ['scope', 'lead_whatsapp'],
      });
    }
  }
  if (data.type === 'CORRECT_DATA') {
    const field = scope?.field;
    if (!field || typeof field !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scope.field obrigatorio para CORRECT_DATA',
        path: ['scope', 'field'],
      });
    }
  }
});

const cancelRequestSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export const lgpdRoutes: FastifyPluginAsync = async (app) => {
  registerTenantLgpdRoutes(app);
};

export function registerTenantLgpdRoutes(app: FastifyInstance): void {
  // 🔹 GET /requests — lista requests do tenant 🔹
  app.get('/requests', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Tenant context missing' },
      });
    }

    const db = getDb(req);
    const { data: requests, error } = await db
      .from('lgpd_requests')
      .select('id, type, status, scope, download_url, download_expires_at, rejection_reason, created_at, processed_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    return reply.send({ data: requests });
  });

  // 🔹 POST /lgpd/requests — cria nova solicitação 🔹
  app.post('/requests', {
    preHandler: [async (req, reply) => {
      if ((req as any).userRole && (req as any).userRole !== 'OWNER') {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only owners can perform this action' });
      }
    }],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as FastifyRequest & { tenantId?: string }).tenantId;
    const userId = (req as FastifyRequest & { userId?: string }).userId;

    if (!tenantId || !userId) {
      return reply.status(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Tenant/user context missing' },
      });
    }

    const db = getDb(req);

    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payload invalido',
          details: parsed.error.flatten(),
        },
      });
    }

    // Anti-abuso: max 3 requests pendentes simultaneos por tenant
    const { count, error: countErr } = await db
      .from('lgpd_requests')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', [LgpdRequestStatus.PENDING, LgpdRequestStatus.PROCESSING]);

    if (countErr) throw countErr;

    if ((count ?? 0) >= 3) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Voce ja tem 3 solicitacoes LGPD em andamento. Aguarde processamento.',
        },
      });
    }

    const requestId = crypto.randomUUID();
    const { data: request, error: createErr } = await db
      .from('lgpd_requests')
      .insert({
        id: requestId,
        tenant_id: tenantId,
        requested_by_user_id: userId,
        type: parsed.data.type,
        status: LgpdRequestStatus.PENDING,
        scope: parsed.data.scope as any,
        updated_at: new Date().toISOString(),
      })
      .select('id, type, status, scope, created_at')
      .single();

    if (createErr) throw createErr;

    logger.info(
      {
        tenant_id: tenantId,
        user_id: userId,
        lgpd_request_id: request.id,
        lgpd_request_type: request.type,
      },
      'lgpd:request-created',
    );

    // Enfileira processamento async (worker process-lgpd-request)
    try {
      const queue = createTenantQueue(tenantId, 'process-lgpd-request');
      await queue.add(
        'process-lgpd-request',
        {
          tenant_id: tenantId,
          trace_id: `lgpd:${request.id}`,
          lgpd_request_id: request.id,
        },
        { jobId: `lgpd-request-${request.id}` }, // idempotente
      );
      await queue.close();
    } catch (queueErr) {
      logger.error(
        {
          tenant_id: tenantId,
          lgpd_request_id: request.id,
          err: queueErr instanceof Error ? { message: queueErr.message } : queueErr,
        },
        'lgpd:enqueue-failed — request persists as PENDING for manual triage',
      );
      // Nao falha o request — operador pode reprocessar manualmente
    }

    return reply.status(202).send({
      data: {
        ...request,
        sla: {
          message: 'Sua solicitacao foi registrada. Resposta em ate 15 dias uteis (LGPD art. 19).',
          estimated_resolution_days: 15,
        },
      },
    });
  });

  // 🔹 GET /lgpd/requests/:id — detalhe 🔹
  app.get('/requests/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Tenant context missing' },
      });
    }
    const { id } = req.params as { id: string };
    const db = getDb(req);

    const { data: request, error } = await db
      .from('lgpd_requests')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) throw error;

    if (!request) {
      return reply.status(404).send({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Solicitacao nao encontrada' },
      });
    }

    return reply.send({ data: request });
  });

  // 🔹 POST /lgpd/requests/:id/cancel — usuário cancela request pendente 🔹
  app.post('/requests/:id/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Tenant context missing' },
      });
    }
    const { id } = req.params as { id: string };
    const db = getDb(req);

    const parsed = cancelRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(422).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const { data: existing, error: findErr } = await db
      .from('lgpd_requests')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr) throw findErr;

    if (!existing) {
      return reply.status(404).send({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Solicitacao nao encontrada' },
      });
    }
    if (existing.status !== LgpdRequestStatus.PENDING) {
      return reply.status(409).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: `So e possivel cancelar requests em PENDING (atual: ${existing.status})`,
        },
      });
    }

    const { data: updated, error: updateErr } = await db
      .from('lgpd_requests')
      .update({
        status: LgpdRequestStatus.CANCELED,
        rejection_reason: parsed.data.reason ?? 'Cancelado pelo usuario',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, rejection_reason, updated_at')
      .single();

    if (updateErr) throw updateErr;

    logger.info(
      {
        tenant_id: tenantId,
        lgpd_request_id: id,
      },
      'lgpd:request-canceled',
    );

    return reply.send({ data: updated });
  });
}
