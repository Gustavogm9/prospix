import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildQueueFailureEvent, observeQueueFailures, upsertTenantJobScheduler } from './queue.js';

const bullmqMocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  upsertJobScheduler: vi.fn(),
  queueClose: vi.fn(),
  eventsClose: vi.fn(),
  queueInstances: [] as any[],
  eventsInstances: [] as any[],
}));

const redisMocks = vi.hoisted(() => ({
  redisConnection: {},
  createDedicatedRedisConnection: vi.fn(() => ({
    disconnect: vi.fn(),
  })),
}));

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const dlqMocks = vi.hoisted(() => ({
  handleFailedExhausted: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name, opts) => {
    const instance = {
      name,
      opts,
      getJob: bullmqMocks.getJob,
      upsertJobScheduler: bullmqMocks.upsertJobScheduler,
      close: bullmqMocks.queueClose,
    };
    bullmqMocks.queueInstances.push(instance);
    return instance;
  }),
  QueueEvents: vi.fn().mockImplementation((name, opts) => {
    const handlers = new Map<string, (payload: any) => Promise<void>>();
    const instance = {
      name,
      opts,
      on: vi.fn((event: string, handler: (payload: any) => Promise<void>) => {
        handlers.set(event, handler);
        return instance;
      }),
      close: bullmqMocks.eventsClose,
      emitFailed: async (payload: any) => handlers.get('failed')?.(payload),
    };
    bullmqMocks.eventsInstances.push(instance);
    return instance;
  }),
}));

vi.mock('./redis.js', () => redisMocks);

vi.mock('./logger.js', () => ({
  logger: loggerMocks,
}));

vi.mock('./dlq.js', () => dlqMocks);

describe('queue failure observer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bullmqMocks.queueInstances.length = 0;
    bullmqMocks.eventsInstances.length = 0;
    bullmqMocks.upsertJobScheduler.mockResolvedValue({ id: 'next-job' });
    bullmqMocks.queueClose.mockResolvedValue(undefined);
    bullmqMocks.eventsClose.mockResolvedValue(undefined);
  });

  it('upserts tenant schedules with stable scheduler IDs and closes the queue', async () => {
    await upsertTenantJobScheduler('tenant-001', {
      workerName: 'daily-digest',
      schedulerId: 'daily-digest:tenant-001',
      jobName: 'daily-digest',
      pattern: '0 8 * * *',
      timezone: 'America/Sao_Paulo',
      data: {
        tenant_id: 'tenant-001',
        trace_id: 'scheduler:daily-digest:tenant-001',
      },
    });

    expect(bullmqMocks.queueInstances[0]).toMatchObject({
      name: 'queue-global-daily-digest',
    });
    expect(bullmqMocks.upsertJobScheduler).toHaveBeenCalledWith(
      'daily-digest:tenant-001',
      {
        pattern: '0 8 * * *',
        tz: 'America/Sao_Paulo',
      },
      {
        name: 'daily-digest',
        data: {
          tenant_id: 'tenant-001',
          trace_id: 'scheduler:daily-digest:tenant-001',
        },
        opts: undefined,
      }
    );
    expect(bullmqMocks.queueClose).toHaveBeenCalledTimes(1);
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: 'daily-digest',
        scheduler_id: 'daily-digest:tenant-001',
      }),
      'queue:scheduler-upserted'
    );
  });

  it('builds exhausted failure events without exposing raw job payloads', () => {
    const event = buildQueueFailureEvent(
      'send-messages',
      'queue-global-send-messages',
      'job-001',
      'provider_down',
      {
        name: 'send-whatsapp',
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: {
          tenant_id: 'tenant-001',
          trace_id: 'trace-001',
          messageContent: 'secret lead text',
          to: '+5511999999999',
        },
      }
    );

    expect(event).toEqual({
      level: 'error',
      message: 'queue:failed-exhausted',
      fields: {
        queue: 'queue-global-send-messages',
        worker: 'send-messages',
        job_id: 'job-001',
        job_name: 'send-whatsapp',
        tenant_id: 'tenant-001',
        trace_id: 'trace-001',
        attempts_made: 3,
        attempts: 3,
        failed_reason: 'provider_down',
        dlq_physical: true,
        replay_supported: 'allowlist',
        runbook: 'docs/auditoria/runbook-dlq-replay.md',
      },
    });
    expect(JSON.stringify(event)).not.toContain('secret lead text');
    expect(JSON.stringify(event)).not.toContain('+5511999999999');
  });

  it('builds orphaned failure events when BullMQ no longer returns the job', () => {
    const event = buildQueueFailureEvent(
      'send-messages',
      'queue-global-send-messages',
      'job-missing',
      'missing_job',
      null
    );

    expect(event).toMatchObject({
      level: 'error',
      message: 'queue:failure-orphaned',
      fields: {
        job_id: 'job-missing',
        attempts_made: 0,
        attempts: 1,
        dlq_physical: true,
        replay_supported: 'allowlist',
      },
    });
  });

  it('logs exhausted failed jobs as failed-job inspection events', async () => {
    bullmqMocks.getJob.mockResolvedValue({
      name: 'send-whatsapp',
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: {
        tenant_id: 'tenant-001',
        trace_id: 'trace-001',
      },
    });

    observeQueueFailures('send-messages');
    await bullmqMocks.eventsInstances[0].emitFailed({
      jobId: 'job-001',
      failedReason: 'provider_down',
    });

    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'queue-global-send-messages',
        worker: 'send-messages',
        job_id: 'job-001',
        job_name: 'send-whatsapp',
        tenant_id: 'tenant-001',
        trace_id: 'trace-001',
        attempts_made: 3,
        attempts: 3,
        failed_reason: 'provider_down',
        dlq_physical: true,
        replay_supported: 'allowlist',
        runbook: 'docs/auditoria/runbook-dlq-replay.md',
      }),
      'queue:failed-exhausted'
    );
    expect(dlqMocks.handleFailedExhausted).toHaveBeenCalledWith(
      'send-messages',
      'job-001',
      'provider_down',
      expect.objectContaining({
        name: 'send-whatsapp',
        attemptsMade: 3,
        data: {
          tenant_id: 'tenant-001',
          trace_id: 'trace-001',
        },
      }),
    );
  });

  it('logs failed jobs with remaining attempts as retries', async () => {
    bullmqMocks.getJob.mockResolvedValue({
      attemptsMade: 1,
      opts: { attempts: 3 },
      data: {
        tenant_id: 'tenant-001',
      },
    });

    observeQueueFailures('send-messages');
    await bullmqMocks.eventsInstances[0].emitFailed({
      jobId: 'job-002',
      failedReason: 'temporary_failure',
    });

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'queue-global-send-messages',
        job_id: 'job-002',
        tenant_id: 'tenant-001',
        attempts_made: 1,
        attempts: 3,
        dlq_physical: true,
        replay_supported: 'allowlist',
      }),
      'queue:retry'
    );
    expect(dlqMocks.handleFailedExhausted).not.toHaveBeenCalled();
  });
});
