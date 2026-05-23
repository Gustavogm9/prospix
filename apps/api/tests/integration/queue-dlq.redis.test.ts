import '../../src/config/env.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import {
  buildQueueFailureEvent,
  createTenantQueue,
  getTenantQueueName,
  observeQueueFailures,
} from '../../src/lib/queue.js';
import {
  buildDlqEntry,
  enqueueToDlq,
  getDlqQueueName,
  listDlqJobs,
  purgeDlqJob,
  replayDlqJob,
  DlqJobNotFoundError,
  DlqReplayNotAllowedError,
} from '../../src/lib/dlq.js';
import { createDedicatedRedisConnection, redis } from '../../src/lib/redis.js';
import { redisConnection } from '../../src/lib/redis.js';

const requireRedisEvidence = process.env.AUDIT_REQUIRE_REDIS === '1' || process.env.CI === 'true';

let redisAvailable = true;
const cleanupTasks: Array<() => Promise<void>> = [];

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

async function waitForDlqJob(workerName: string, sourceJobId: string): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    const jobs = await listDlqJobs(workerName, { limit: 50 });
    const match = jobs.find((job) => job.entry.source_job_id === sourceJobId);
    if (match) {
      return match.dlq_job_id;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for DLQ job for source ${sourceJobId}`);
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

  it('keeps exhausted failed jobs, enqueues physical DLQ, and replays allowlisted jobs', async (context) => {
    if (!redisAvailable) {
      context.skip();
      return;
    }

    const workerName = 'health-check';
    const queueName = getTenantQueueName('tenant-audit', workerName);
    const dlqName = getDlqQueueName(workerName);
    const queue = createTenantQueue<Record<string, unknown>>('tenant-audit', workerName, {
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    const dlqQueue = new Queue(dlqName, { connection: redisConnection });
    const eventsConnection = createDedicatedRedisConnection();
    const workerConnection = createDedicatedRedisConnection();
    const events = new QueueEvents(queueName, { connection: eventsConnection });
    const failureObserver = observeQueueFailures(workerName);
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('provider_down');
      },
      { connection: workerConnection }
    );

    cleanupTasks.push(async () => {
      await failureObserver.close();
      await worker.close();
      await events.close();
      await dlqQueue.obliterate({ force: true });
      await dlqQueue.close();
      await queue.obliterate({ force: true });
      await queue.close();
      eventsConnection.disconnect();
      workerConnection.disconnect();
    });

    await events.waitUntilReady();
    await worker.waitUntilReady();
    await queue.obliterate({ force: true });
    await dlqQueue.obliterate({ force: true });

    const failedEventPromise = waitForFailedJob(events);
    const jobId = `audit-failed-${Date.now()}`;
    const job = await queue.add(
      'send-whatsapp',
      {
        tenant_id: 'tenant-audit',
        trace_id: 'trace-audit',
        messageContent: 'texto sensivel que nao deve ir para log',
        to: '+5511999999999',
      },
      { jobId }
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
        dlq_physical: true,
        replay_supported: 'allowlist',
      },
    });
    expect(JSON.stringify(auditEvent)).not.toContain('texto sensivel');
    expect(JSON.stringify(auditEvent)).not.toContain('+5511999999999');

    const dlqJobId = await waitForDlqJob(workerName, job.id!);
    const dlqJobs = await listDlqJobs(workerName, { limit: 50 });
    const dlqJob = dlqJobs.find((candidate) => candidate.dlq_job_id === dlqJobId);

    expect(dlqJob).toMatchObject({
      replayable: true,
      entry: {
        worker: workerName,
        source_job_id: job.id,
        source_job_name: 'send-whatsapp',
        source_queue: queueName,
        tenant_id: 'tenant-audit',
        trace_id: 'trace-audit',
        attempts_made: 1,
        attempts: 1,
      },
    });

    const dryRun = await replayDlqJob(workerName, dlqJobId, {
      dryRun: true,
      approvedBy: 'audit@prospix.local',
      reason: 'AUD-P1-021 dry-run proof',
    });
    expect(dryRun).toMatchObject({
      ok: true,
      dry_run: true,
      new_job_id: 'dry-run',
      source_job_id: job.id,
      replayed_into: queueName,
    });

    const replay = await replayDlqJob(workerName, dlqJobId, {
      approvedBy: 'audit@prospix.local',
      reason: 'AUD-P1-021 Redis replay proof',
    });
    expect(replay).toMatchObject({
      ok: true,
      dry_run: false,
      source_job_id: job.id,
      replayed_into: queueName,
    });

    const replayedJob = await queue.getJob(replay.new_job_id);
    expect(replayedJob?.data).toMatchObject({
      tenant_id: 'tenant-audit',
      trace_id: 'trace-audit',
      _replay_metadata: {
        replayed_from_dlq: dlqJobId,
        original_source_job_id: job.id,
        approved_by: 'audit@prospix.local',
        reason: 'AUD-P1-021 Redis replay proof',
      },
    });

    await expect(dlqQueue.getJob(dlqJobId)).resolves.toBeFalsy();
  });

  it('enqueueToDlq e idempotente · mesma source_job_id 2x = 1 entry', async (context) => {
    if (!redisAvailable) {
      context.skip();
      return;
    }

    const workerName = 'health-check';
    const dlqName = getDlqQueueName(workerName);
    const dlq = new Queue(dlqName, { connection: redisConnection });

    cleanupTasks.push(async () => {
      await dlq.obliterate({ force: true });
      await dlq.close();
    });

    await dlq.obliterate({ force: true });

    const sourceJobId = `audit-dedup-${Date.now()}`;
    const entry = buildDlqEntry(
      workerName,
      getTenantQueueName('tenant-audit', workerName),
      sourceJobId,
      'first failure',
      {
        name: 'health-check',
        attemptsMade: 1,
        opts: { attempts: 1 },
        data: { tenant_id: 'tenant-audit', trace_id: 'trace-dedup' },
        timestamp: Date.now(),
      },
    );

    await enqueueToDlq(workerName, entry);
    await enqueueToDlq(workerName, { ...entry, failed_reason: 'second attempt' });

    const jobs = await listDlqJobs(workerName, { limit: 50 });
    const matches = jobs.filter((job) => job.entry.source_job_id === sourceJobId);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.dlq_job_id).toBe(sourceJobId);
  });

  it('replayDlqJob para worker FORA da allowlist lanca DlqReplayNotAllowedError', async (context) => {
    if (!redisAvailable) {
      context.skip();
      return;
    }

    const workerName = 'process-inbound'; // NAO esta em DLQ_REPLAYABLE_WORKERS
    const dlqName = getDlqQueueName(workerName);
    const dlq = new Queue(dlqName, { connection: redisConnection });

    cleanupTasks.push(async () => {
      await dlq.obliterate({ force: true });
      await dlq.close();
    });

    await dlq.obliterate({ force: true });

    const sourceJobId = `audit-blocked-${Date.now()}`;
    const entry = buildDlqEntry(
      workerName,
      getTenantQueueName('tenant-audit', workerName),
      sourceJobId,
      'simulated failure',
      {
        name: 'process-inbound',
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: { tenant_id: 'tenant-audit', trace_id: 'trace-blocked' },
      },
    );

    await enqueueToDlq(workerName, entry);

    await expect(
      replayDlqJob(workerName, sourceJobId, {
        approvedBy: 'audit@prospix.local',
        reason: 'attempt to replay non-allowlisted worker',
      }),
    ).rejects.toBeInstanceOf(DlqReplayNotAllowedError);

    // Listagem ainda mostra o job · com replayable:false e replayable_reason
    const jobs = await listDlqJobs(workerName, { limit: 50 });
    const target = jobs.find((job) => job.entry.source_job_id === sourceJobId);
    expect(target).toBeDefined();
    expect(target!.replayable).toBe(false);
    expect(target!.replayable_reason).toContain('process-inbound');
    expect(target!.replayable_reason).toContain('runbook-dlq-replay.md');
  });

  it('purgeDlqJob remove entry com approved_by + reason · job inexistente lanca DlqJobNotFoundError', async (context) => {
    if (!redisAvailable) {
      context.skip();
      return;
    }

    const workerName = 'send-messages'; // fora da allowlist mas purge nao precisa estar
    const dlqName = getDlqQueueName(workerName);
    const dlq = new Queue(dlqName, { connection: redisConnection });

    cleanupTasks.push(async () => {
      await dlq.obliterate({ force: true });
      await dlq.close();
    });

    await dlq.obliterate({ force: true });

    const sourceJobId = `audit-purge-${Date.now()}`;
    const entry = buildDlqEntry(
      workerName,
      getTenantQueueName('tenant-audit', workerName),
      sourceJobId,
      'reason',
      {
        name: 'send-messages',
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: { tenant_id: 'tenant-audit', trace_id: 'trace-purge' },
      },
    );

    await enqueueToDlq(workerName, entry);

    // Verify existe
    let jobs = await listDlqJobs(workerName, { limit: 50 });
    expect(jobs.find((j) => j.entry.source_job_id === sourceJobId)).toBeDefined();

    // Purge
    const purgeResult = await purgeDlqJob(workerName, sourceJobId, 'audit@prospix.local', 'job processed offline');
    expect(purgeResult.ok).toBe(true);
    expect(typeof purgeResult.purged_at).toBe('string');

    // Verify removido
    jobs = await listDlqJobs(workerName, { limit: 50 });
    expect(jobs.find((j) => j.entry.source_job_id === sourceJobId)).toBeUndefined();

    // Purge novamente · DlqJobNotFoundError
    await expect(
      purgeDlqJob(workerName, sourceJobId, 'audit@prospix.local', 'retry'),
    ).rejects.toBeInstanceOf(DlqJobNotFoundError);
  });
});
