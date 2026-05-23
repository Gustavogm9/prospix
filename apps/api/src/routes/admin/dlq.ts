/**
 * Endpoints admin para DLQ (Dead Letter Queue) fisica.
 * Resolve AUD-P1-021.
 *
 * Todas as rotas herdam o gate `requireRole(['GUILDS_ADMIN'])` do plugin pai.
 *
 * Replay segue allowlist em `DLQ_REPLAYABLE_WORKERS` (lib/dlq.ts):
 * - workers fora da allowlist retornam 403 com link ao runbook
 * - workers na allowlist permitem replay + dry-run + purge
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import {
  DLQ_REPLAYABLE_WORKERS,
  DlqJobNotFoundError,
  DlqReplayNotAllowedError,
  listDlqJobs,
  purgeDlqJob,
  replayDlqJob,
} from '../../lib/dlq.js';

const KNOWN_WORKERS = [
  'process-inbound',
  'send-messages',
  'send-notification',
  'schedule-meeting',
  'health-check',
  'billing-suspension',
  'capture-google-maps',
  'enrich-leads',
  'daily-digest',
  'usage-aggregation',
] as const;

const workerParamSchema = z.object({
  worker: z.enum(KNOWN_WORKERS),
});

const workerJobParamSchema = z.object({
  worker: z.enum(KNOWN_WORKERS),
  dlqJobId: z.string().min(1).max(256),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  tenant_id: z.string().uuid().optional(),
});

const replayBodySchema = z.object({
  dry_run: z.boolean().optional().default(false),
  approved_by: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

const purgeBodySchema = z.object({
  approved_by: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
});

export function registerAdminDlqRoutes(app: FastifyInstance): void {
  // ── GET /admin/dlq · resumo · allowlist + contagens ──────────────────────
  app.get('/dlq', async (_req, reply) => {
    const summary = KNOWN_WORKERS.map((worker) => ({
      worker,
      replayable: DLQ_REPLAYABLE_WORKERS.has(worker),
      list_endpoint: `/v1/admin/dlq/${worker}`,
    }));

    return reply.send({
      data: {
        replayable_workers: Array.from(DLQ_REPLAYABLE_WORKERS),
        all_workers: summary,
        runbook: 'docs/auditoria/runbook-dlq-replay.md',
        retention_days: 30,
      },
    });
  });

  // ── GET /admin/dlq/:worker · lista jobs DLQ ──────────────────────────────
  app.get('/dlq/:worker', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramParsed = workerParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return reply.status(404).send({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Worker desconhecido' },
      });
    }
    const queryParsed = listQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      return reply.status(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'Query invalida', details: queryParsed.error.flatten() },
      });
    }

    const { worker } = paramParsed.data;
    const { limit, offset, tenant_id } = queryParsed.data;

    const jobs = await listDlqJobs(worker, {
      limit: limit ?? 50,
      offset: offset ?? 0,
      tenantId: tenant_id,
    });

    return reply.send({
      data: {
        worker,
        replayable: DLQ_REPLAYABLE_WORKERS.has(worker),
        count: jobs.length,
        jobs,
      },
    });
  });

  // ── POST /admin/dlq/:worker/:dlqJobId/replay · replay manual ─────────────
  app.post(
    '/dlq/:worker/:dlqJobId/replay',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = workerJobParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        return reply.status(404).send({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Worker ou DLQ job desconhecido' },
        });
      }
      const bodyParsed = replayBodySchema.safeParse(req.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Replay exige approved_by + reason; dry_run e opcional',
            details: bodyParsed.error.flatten(),
          },
        });
      }

      const { worker, dlqJobId } = paramParsed.data;
      const { dry_run, approved_by, reason } = bodyParsed.data;

      try {
        const result = await replayDlqJob(worker, dlqJobId, {
          dryRun: dry_run,
          approvedBy: approved_by,
          reason,
        });
        return reply.status(200).send({ data: result });
      } catch (err) {
        if (err instanceof DlqReplayNotAllowedError) {
          logger.warn(
            { worker, dlq_job_id: dlqJobId, approved_by },
            'queue:dlq-replay-blocked-by-allowlist',
          );
          return reply.status(403).send({
            error: {
              code: 'UNAUTHORIZED',
              message: err.message,
              details: {
                worker,
                replayable_workers: Array.from(DLQ_REPLAYABLE_WORKERS),
                runbook: 'docs/auditoria/runbook-dlq-replay.md',
              },
            },
          });
        }
        if (err instanceof DlqJobNotFoundError) {
          return reply.status(404).send({
            error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
          });
        }
        throw err;
      }
    },
  );

  // ── DELETE /admin/dlq/:worker/:dlqJobId · purge manual ───────────────────
  app.delete('/dlq/:worker/:dlqJobId', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramParsed = workerJobParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return reply.status(404).send({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Worker ou DLQ job desconhecido' },
      });
    }
    const bodyParsed = purgeBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Purge exige approved_by + reason',
          details: bodyParsed.error.flatten(),
        },
      });
    }

    const { worker, dlqJobId } = paramParsed.data;
    const { approved_by, reason } = bodyParsed.data;

    try {
      const result = await purgeDlqJob(worker, dlqJobId, approved_by, reason);
      return reply.status(200).send({ data: result });
    } catch (err) {
      if (err instanceof DlqJobNotFoundError) {
        return reply.status(404).send({
          error: { code: 'RESOURCE_NOT_FOUND', message: err.message },
        });
      }
      throw err;
    }
  });
}
