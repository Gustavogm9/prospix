import '../../src/config/env.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { QueueEvents, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import {
  buildQueueFailureEvent,
  createTenantQueue,
  getTenantQueueName,
} from '../../src/lib/queue.js';
import { createDedicatedRedisConnection, redis } from '../../src/lib/redis.js';

const requireRedisEvidence = process.env.AUDIT_REQUIRE_REDIS === '1' || process.env.CI === 'true';

let redisAvailable = true;
const cleanupTasks: Array<() => Promise<void>> = [];

function uniqueWorkerName(): string {
  return `audit-dlq-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function waitForFailedJob(events: QueueEvents): Promise<{ jobId: string; failedReason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for BullMQ failed event'));
    }, 10_000);

    events.once('failed', ({ jobId, failedReason }) => {
      clearTimeout(timeout);
      resolve({ jobId, failedReason });
    });
  });
}

describe('AUD-P1-021 Redis-backed queue failure retention', () => {
  beforeAll(async () => {
    try {
      await redis.ping();
    } catch (err) {
      redisAvailable = false;
      if (requireRedisEvidence) {
        throw new Error(`Redis unavailable for AUD-P1-021 DB-backed evidence: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  afterEach(async () => {
    while (cleanupTasks.length > 0) {
      const cleanup = cleanupTasks.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  });

  it('keeps exhausted failed jobs for inspection without leaking raw payload in audit event', async (context) => {
    if (!redisAvailable) {
      context.skip();
      return;
    }

    const workerName = uniqueWorkerName();
    const queueName = getTenantQueueName('tenant-audit', workerName);
    const queue = createTenantQueue<Record<string, unknown>>('tenant-audit', workerName, {
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    const eventsConnection = createDedicatedRedisConnection();
    const workerConnection = createDedicatedRedisConnection();
    const events = new QueueEvents(queueName, { connection: eventsConnection });
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('provider_down');
      },
      { connection: workerConnection }
    );

    cleanupTasks.push(async () => {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      eventsConnection.disconnect();
      workerConnection.disconnect();
    });

    await events.waitUntilReady();
    await worker.waitUntilReady();

    const failedEventPromise = waitForFailedJob(events);
    const job = await queue.add(
      'send-whatsapp',
      {
        tenant_id: 'tenant-audit',
        trace_id: 'trace-audit',
        messageContent: 'texto sensivel que nao deve ir para log',
        to: '+5511999999999',
      },
      { jobId: `audit-failed-${Date.now()}` }
    );

    const failedEvent = await failedEventPromise;
    expect(failedEvent.jobId).toBe(job.id);

    const failedJobs = await queue.getFailed();
    const retainedJob = failedJobs.find((failedJob) => failedJob.id === job.id) as Job | undefined;

    expect(retainedJob).toBeDefined();
    expect(retainedJob?.attemptsMade).toBe(1);
    expect(retainedJob?.failedReason).toContain('provider_down');

    const auditEvent = buildQueueFailureEvent(workerName, queueName, job.id!, failedEvent.failedReason, retainedJob);

    expect(auditEvent).toMatchObject({
      level: 'error',
      message: 'queue:failed-exhausted',
      fields: {
        queue: queueName,
        worker: workerName,
        job_id: job.id,
        job_name: 'send-whatsapp',
        tenant_id: 'tenant-audit',
        trace_id: 'trace-audit',
        attempts_made: 1,
        attempts: 1,
        dlq_physical: false,
        replay_supported: false,
      },
    });
    expect(JSON.stringify(auditEvent)).not.toContain('texto sensivel');
    expect(JSON.stringify(auditEvent)).not.toContain('+5511999999999');
  });
});
