import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageAggregationWorker } from './usage-aggregation.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { sendNotification } from '../services/notification-service.js';
import { Job } from 'bullmq';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    tenant: {
      findMany: vi.fn(),
    },
    message: {
      aggregate: vi.fn(),
    },
    lead: {
      count: vi.fn(),
    },
    conversation: {
      count: vi.fn(),
    },
    meeting: {
      count: vi.fn(),
    },
    tenantUsage: {
      upsert: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

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
  });

  it('should aggregate usage and trigger alerts correctly', async () => {
    // Mock Active Tenants
    vi.mocked(prisma.tenant.findMany).mockResolvedValue([
      {
        id: 'tenant-abc',
        name: 'Giovane Seguros',
        status: 'ACTIVE',
        plan: 'STANDARD',
      },
    ] as any);

    // Mock Message token aggregation (12000 cents cost = 80% of STANDARD limit 15000 cents)
    vi.mocked(prisma.message.aggregate).mockResolvedValue({
      _sum: {
        llmTokensInput: BigInt(500000),
        llmTokensOutput: BigInt(300000),
        llmCostCents: 12000,
      },
    } as any);

    vi.mocked(prisma.lead.count).mockResolvedValue(10);
    vi.mocked(prisma.conversation.count).mockResolvedValue(8);
    vi.mocked(prisma.meeting.count).mockResolvedValue(4);

    vi.mocked(prisma.tenantUsage.upsert).mockResolvedValue({} as any);

    // Mock Redis alerts check (not sent yet)
    vi.mocked(redis.get).mockResolvedValue(null);

    // Mock Owner User lookup
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'owner-123',
      tenantId: 'tenant-abc',
      role: 'OWNER',
    } as any);

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
    expect(prisma.tenant.findMany).toHaveBeenCalledWith({
      where: { id: 'tenant-abc', status: 'ACTIVE', deletedAt: null },
    });

    expect(prisma.tenantUsage.upsert).toHaveBeenCalled();
    // 80% should trigger 70% alert but not 90% or 100%
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-abc',
        userId: 'owner-123',
        type: 'ai_quota_70',
      })
    );
  });
});
