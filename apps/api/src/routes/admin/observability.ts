/**
 * Endpoint admin de observabilidade · agrega métricas operacionais cross-system.
 *
 * Retorna em uma única chamada:
 * - Queue counters BullMQ por worker (waiting/active/completed/failed/delayed)
 * - DLQ counters por worker (waiting + total) e flag replayable
 * - Alert sink status (sentry/slack configurados)
 *
 * Gate: requireRole(['GUILDS_ADMIN']) herdado do plugin pai.
 */
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Queue } from 'bullmq';
import { logger } from '../../lib/logger.js';
import { redisConnection } from '../../lib/redis.js';
import { getTenantQueueName } from '../../lib/queue.js';
import { DLQ_REPLAYABLE_WORKERS, listDlqJobs } from '../../lib/dlq.js';
import { getAlertSinkStatus } from '../../lib/alert-sink.js';
import { workerQueueNames } from '../../workers/index.js';

interface QueueSnapshot {
  worker: string;
  queueName: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  dlq: {
    waiting: number;
    replayable: boolean;
  };
}

async function snapshotWorker(workerName: string): Promise<QueueSnapshot> {
  const queueName = getTenantQueueName('global', workerName);
  const queue = new Queue(queueName, { connection: redisConnection });
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    let dlqWaiting = 0;
    try {
      const dlqJobs = await listDlqJobs(workerName, { limit: 200, offset: 0 });
      dlqWaiting = dlqJobs.length;
    } catch (err) {
      logger.warn({ workerName, err }, 'observability · DLQ read failed (non-fatal)');
    }
    return {
      worker: workerName,
      queueName,
      counts: {
        waiting: Number(counts.waiting ?? 0),
        active: Number(counts.active ?? 0),
        completed: Number(counts.completed ?? 0),
        failed: Number(counts.failed ?? 0),
        delayed: Number(counts.delayed ?? 0),
      },
      dlq: {
        waiting: dlqWaiting,
        replayable: DLQ_REPLAYABLE_WORKERS.has(workerName),
      },
    };
  } finally {
    await queue.close().catch(() => {
      /* best-effort cleanup · BullMQ pode reciclar conexão */
    });
  }
}

export function registerAdminObservabilityRoutes(app: FastifyInstance): void {
  app.get('/observability', async (_req: FastifyRequest, reply: FastifyReply) => {
    const startedAt = Date.now();
    try {
      const snapshots = await Promise.all(workerQueueNames.map(snapshotWorker));
      const totals = snapshots.reduce(
        (acc, s) => ({
          waiting: acc.waiting + s.counts.waiting,
          active: acc.active + s.counts.active,
          failed: acc.failed + s.counts.failed,
          dlq: acc.dlq + s.dlq.waiting,
        }),
        { waiting: 0, active: 0, failed: 0, dlq: 0 },
      );
      const alertSinks = getAlertSinkStatus();
      const durationMs = Date.now() - startedAt;
      return reply.send({
        data: {
          generatedAt: new Date().toISOString(),
          durationMs,
          totals,
          queues: snapshots,
          alertSinks,
        },
      });
    } catch (err) {
      logger.error({ err }, 'observability · failed to build snapshot');
      return reply.status(500).send({ message: 'Falha ao montar snapshot de observabilidade.' });
    }
  });
}
