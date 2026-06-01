import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageAggregationWorker } from './usage-aggregation.js';
import { redis } from '../lib/redis.js';
import { sendNotification } from '../services/notification-service.js';
import { Job } from 'bullmq';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../services/notification-service.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
}));

describe('Usage Aggregation Worker', () => {
  const worker = new UsageAggregationWorker();

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it('should aggregate usage and trigger alerts correctly', async () => {
    // Mock Active Tenants
    setTableResult('tenants', {
      data: [
        {
          id: 'tenant-abc',
          name: 'Giovane Seguros',
          status: 'ACTIVE',
          plan: 'STANDARD',
        },
      ],
      error: null,
    });

    // Mock message aggregate data (records to sum)
    setTableResult('messages', {
      data: [
        {
          llm_tokens_input: 500000,
          llm_tokens_output: 300000,
          llm_cost_cents: 12000,
        },
      ],
      error: null,
    });

    // Mock counts
    setTableResult('leads', { data: null, error: null, count: 10 });
    setTableResult('conversations', { data: null, error: null, count: 8 });
    setTableResult('meetings', { data: null, error: null, count: 4 });

    // Mock tenant_usage upsert
    setTableResult('tenant_usage', { data: {}, error: null });

    // Mock Redis alerts check (not sent yet)
    vi.mocked(redis.get).mockResolvedValue(null);

    // Mock Owner User lookup
    setTableResult('users', {
      data: {
        id: 'owner-123',
        tenant_id: 'tenant-abc',
        role: 'OWNER',
      },
      error: null,
    });

    const mockJob = {
      id: 'job-agg',
      data: {
        tenant_id: 'tenant-abc',
        trace_id: 'trace-xyz',
      },
    } as unknown as Job;

    const result = await worker.process(mockJob);

    expect(result.success).toBe(true);
    expect(result.tenants_processed).toBe(1);
    expect(dbAdmin.from).toHaveBeenCalledWith('tenants');
    expect(dbAdmin.from).toHaveBeenCalledWith('tenant_usage');

    // 80% should trigger 70% alert
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-abc',
        userId: 'owner-123',
        type: 'ai_quota_70',
      })
    );
  });
});
