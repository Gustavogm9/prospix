import { Queue, QueueEvents, QueueOptions } from 'bullmq';
import type { JobSchedulerTemplateOptions } from 'bullmq';
import { logger } from './logger.js';
import { createDedicatedRedisConnection, redisConnection } from './redis.js';
import { handleFailedExhausted } from './dlq.js';

/**
 * Generates a global static queue name for a worker.
 * Format: queue-global-<worker_name>
 */
export function getTenantQueueName(_tenantId: string, workerName: string): string {
  return `queue-global-${workerName}`;
}

/**
 * Factory to create a global, static BullMQ Queue (backward compatible signature).
 * Configured with exponential backoff retry and DLQ-ready policies.
 */
export function createTenantQueue<TPayload = any>(
  tenantId: string,
  workerName: string,
  options?: Omit<QueueOptions, 'connection'>
): Queue<TPayload, any, string> {
  const queueName = getTenantQueueName(tenantId, workerName);
  
  return new Queue<TPayload, any, string>(queueName, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000, // starts at 1s, then 2s, 4s...
      },
      removeOnComplete: true,
      removeOnFail: false, // keep failed jobs for DLQ inspection
      ...options?.defaultJobOptions,
    },
    ...options,
  });
}

export interface TenantJobSchedule<TPayload> {
  workerName: string;
  schedulerId: string;
  jobName: string;
  pattern: string;
  timezone?: string;
  data: TPayload;
  opts?: JobSchedulerTemplateOptions;
}

export async function upsertTenantJobScheduler<TPayload>(
  tenantId: string,
  schedule: TenantJobSchedule<TPayload>
): Promise<void> {
  const queue = createTenantQueue<any>(tenantId, schedule.workerName);

  try {
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      {
        pattern: schedule.pattern,
        tz: schedule.timezone,
      },
      {
        name: schedule.jobName as any,
        data: schedule.data,
        opts: schedule.opts,
      }
    );

    logger.info(
      {
        queue: getTenantQueueName(tenantId, schedule.workerName),
        worker: schedule.workerName,
        scheduler_id: schedule.schedulerId,
        pattern: schedule.pattern,
        timezone: schedule.timezone,
      },
      'queue:scheduler-upserted'
    );
  } finally {
    await queue.close();
  }
}

export async function removeTenantJobScheduler(
  tenantId: string,
  workerName: string,
  schedulerId: string
): Promise<void> {
  const queue = createTenantQueue<any>(tenantId, workerName);

  try {
    await queue.removeJobScheduler(schedulerId);
    logger.info(
      {
        queue: getTenantQueueName(tenantId, workerName),
        worker: workerName,
        scheduler_id: schedulerId,
      },
      'queue:scheduler-removed'
    );
  } catch (err: any) {
    // Ignore "not found" — scheduler may not exist yet
    if (!err.message?.includes('Missing')) {
      throw err;
    }
    logger.debug({ schedulerId }, 'Scheduler not found for removal (already absent)');
  } finally {
    await queue.close();
  }
}

/**
 * Syncs the capture-google-maps cron for a campaign.
 * When the campaign is ACTIVE with cities → upsert a repeating schedule (every 6 hours BRT).
 * Otherwise → remove the schedule.
 */
export async function syncCampaignCaptureSchedule(
  tenantId: string,
  campaignId: string,
  status: string,
  cities: string[]
): Promise<void> {
  const schedulerId = `capture-google-maps:${campaignId}`;
  const isActive = status === 'ACTIVE' && cities.length > 0;

  if (isActive) {
    await upsertTenantJobScheduler(tenantId, {
      workerName: 'capture-google-maps',
      schedulerId,
      jobName: 'capture-google-maps',
      pattern: '0 */6 * * *', // every 6 hours: 00:00, 06:00, 12:00, 18:00
      timezone: 'America/Sao_Paulo',
      data: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        trace_id: `scheduler:capture:${campaignId}`,
      },
    });
  } else {
    await removeTenantJobScheduler(tenantId, 'capture-google-maps', schedulerId);
  }
}

export interface QueueFailureObserver {
  close(): Promise<void>;
}

type FailureJobSnapshot = {
  name?: string;
  attemptsMade?: number;
  opts?: {
    attempts?: number;
  };
  data?: Record<string, unknown> & {
    tenant_id?: unknown;
    trace_id?: unknown;
  };
};

export type QueueFailureLogEvent = {
  level: 'warn' | 'error';
  message: 'queue:retry' | 'queue:failed-exhausted' | 'queue:failure-orphaned';
  fields: {
    queue: string;
    worker: string;
    job_id: string;
    job_name?: string;
    tenant_id?: string;
    trace_id?: string;
    attempts_made: number;
    attempts: number;
    failed_reason?: string;
    /** DLQ fisica habilitada via `dlq.ts` (AUD-P1-021 resolvido). */
    dlq_physical: true;
    /**
     * Replay efetivo depende de allowlist por worker
     * (ver `DLQ_REPLAYABLE_WORKERS` em `dlq.ts` + runbook).
     */
    replay_supported: 'allowlist';
    runbook: 'docs/auditoria/runbook-dlq-replay.md';
  };
};

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function buildQueueFailureEvent(
  workerName: string,
  queueName: string,
  jobId: string,
  failedReason: string | undefined,
  job: FailureJobSnapshot | null | undefined
): QueueFailureLogEvent {
  const attempts = job?.opts?.attempts ?? 1;
  const attemptsMade = job?.attemptsMade ?? 0;
  const baseFields = {
    queue: queueName,
    worker: workerName,
    job_id: jobId,
    job_name: job?.name,
    tenant_id: stringField(job?.data?.tenant_id),
    trace_id: stringField(job?.data?.trace_id),
    attempts_made: attemptsMade,
    attempts,
    failed_reason: failedReason,
    dlq_physical: true as const,
    replay_supported: 'allowlist' as const,
    runbook: 'docs/auditoria/runbook-dlq-replay.md' as const,
  };

  if (!job) {
    return {
      level: 'error',
      message: 'queue:failure-orphaned',
      fields: baseFields,
    };
  }

  if (attemptsMade >= attempts) {
    return {
      level: 'error',
      message: 'queue:failed-exhausted',
      fields: baseFields,
    };
  }

  return {
    level: 'warn',
    message: 'queue:retry',
    fields: baseFields,
  };
}

export function observeQueueFailures(workerName: string): QueueFailureObserver {
  const queueName = getTenantQueueName('global', workerName);
  const queueConnection = createDedicatedRedisConnection();
  const eventsConnection = createDedicatedRedisConnection();
  const queue = new Queue(queueName, { connection: queueConnection });
  const events = new QueueEvents(queueName, { connection: eventsConnection });

  events.on('failed', async ({ jobId, failedReason }) => {
    try {
      const job = await queue.getJob(jobId);
      const event = buildQueueFailureEvent(workerName, queueName, jobId, failedReason, job);

      logger[event.level](event.fields, event.message);

      // Quando esgotado, move pra DLQ fisica (idempotente por source_job_id)
      if (event.message === 'queue:failed-exhausted' && job) {
        try {
          await handleFailedExhausted(workerName, jobId, failedReason, {
            name: job.name,
            attemptsMade: job.attemptsMade,
            opts: job.opts as { attempts?: number },
            data: job.data,
            timestamp: job.timestamp,
          });
        } catch (dlqErr) {
          logger.error(
            { queue: queueName, worker: workerName, job_id: jobId, err: dlqErr },
            'queue:dlq-enqueue-failed',
          );
        }
      }
    } catch (err) {
      logger.error({ queue: queueName, worker: workerName, job_id: jobId, err }, 'queue:failure-observer-error');
    }
  });

  return {
    async close() {
      await Promise.all([events.close(), queue.close()]);
      eventsConnection.disconnect();
      queueConnection.disconnect();
    },
  };
}
