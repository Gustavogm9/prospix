import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  createDedicatedRedisConnection: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    tenant: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../lib/queue.js', () => ({
  createTenantQueue: vi.fn(),
  getTenantQueueName: vi.fn((_tenantId: string, workerName: string) => `queue-global-${workerName}`),
  observeQueueFailures: vi.fn(),
  upsertTenantJobScheduler: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
}));

vi.mock('./process-inbound.js', () => ({
  ProcessInboundWorker: vi.fn(),
}));

vi.mock('./send-messages.js', () => ({
  SendMessagesWorker: vi.fn(),
}));

vi.mock('./send-notification.js', () => ({
  SendNotificationWorker: vi.fn(),
}));

vi.mock('./schedule-meeting.js', () => ({
  ScheduleMeetingWorker: vi.fn(),
}));

vi.mock('./health-check.js', () => ({
  HealthCheckWorker: vi.fn(),
}));

vi.mock('./billing-suspension.js', () => ({
  BillingSuspensionWorker: vi.fn(),
}));

vi.mock('./capture-google-maps.js', () => ({
  CaptureGoogleMapsWorker: vi.fn(),
}));

vi.mock('./enrich-leads.js', () => ({
  EnrichLeadsWorker: vi.fn(),
}));

vi.mock('./daily-digest.js', () => ({
  DailyDigestWorker: vi.fn(),
}));

vi.mock('./usage-aggregation.js', () => ({
  UsageAggregationWorker: vi.fn(),
}));

describe('Worker registry', () => {
  it('should include the send-notification queue in the global worker registry', async () => {
    const { workerQueueNames } = await import('./index.js');

    expect(workerQueueNames).toContain('send-notification');
  });

  it('should include process-lgpd-request queue in the global worker registry (AUD-P2-033 fulfillment)', async () => {
    const { workerQueueNames } = await import('./index.js');

    expect(workerQueueNames).toContain('process-lgpd-request');
  });

  it('registry covers all 11 critical worker queues (AUD-P1-020 fulfillment)', async () => {
    const { workerQueueNames } = await import('./index.js');

    const expected = [
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
      'process-lgpd-request',
    ];

    for (const name of expected) {
      expect(workerQueueNames).toContain(name);
    }
    expect(workerQueueNames).toHaveLength(expected.length);
  });

  it('observes failures for every registered global worker queue', async () => {
    const { observeQueueFailures } = await import('../lib/queue.js');
    const { startWorkers, workerQueueNames } = await import('./index.js');
    const { prisma } = await import('../lib/prisma.js');

    vi.mocked(prisma.tenant.findMany).mockResolvedValue([]);

    await startWorkers();

    expect(observeQueueFailures).toHaveBeenCalledTimes(workerQueueNames.length);
    for (const workerName of workerQueueNames) {
      expect(observeQueueFailures).toHaveBeenCalledWith(workerName);
    }
  });

  it('builds tenant-scoped schedules for daily digest and usage aggregation', async () => {
    const { buildTenantScheduledJobs } = await import('./index.js');

    expect(buildTenantScheduledJobs('tenant-123')).toEqual([
      expect.objectContaining({
        workerName: 'daily-digest',
        schedulerId: 'daily-digest:tenant-123',
        jobName: 'daily-digest',
        pattern: '0 8 * * *',
        timezone: 'America/Sao_Paulo',
        data: expect.objectContaining({
          tenant_id: 'tenant-123',
          trace_id: 'scheduler:daily-digest:tenant-123',
        }),
      }),
      expect.objectContaining({
        workerName: 'usage-aggregation',
        schedulerId: 'usage-aggregation:tenant-123',
        jobName: 'usage-aggregation',
        pattern: '0 * * * *',
        timezone: 'America/Sao_Paulo',
        data: expect.objectContaining({
          tenant_id: 'tenant-123',
          trace_id: 'scheduler:usage-aggregation:tenant-123',
          run_all_tenants: false,
        }),
      }),
    ]);
  });

  it('upserts both recurring jobs for each active tenant', async () => {
    const { upsertTenantJobScheduler } = await import('../lib/queue.js');
    const { scheduleRecurringTenantJobs } = await import('./index.js');

    vi.mocked(upsertTenantJobScheduler).mockResolvedValue(undefined);

    await scheduleRecurringTenantJobs([{ id: 'tenant-a' }, { id: 'tenant-b' }]);

    expect(upsertTenantJobScheduler).toHaveBeenCalledTimes(4);
    expect(upsertTenantJobScheduler).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({
        workerName: 'daily-digest',
        schedulerId: 'daily-digest:tenant-a',
      })
    );
    expect(upsertTenantJobScheduler).toHaveBeenCalledWith(
      'tenant-b',
      expect.objectContaining({
        workerName: 'usage-aggregation',
        schedulerId: 'usage-aggregation:tenant-b',
      })
    );
  });
});
