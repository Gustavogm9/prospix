import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { CaptureGoogleMapsWorker } from '../../src/workers/capture-google-maps.js';
import { googleMapsHandlers } from '../../../../packages/mocks/src/google-maps.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';
import { getDecryptedSecrets } from '../../src/tenant/secrets-vault.js';
import { Job } from 'bullmq';
import { Profession, CampaignStatus } from '@prisma/client';

// Setup MSW mock server for searchPlaces internally
const server = setupServer(...googleMapsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

// Mock Prisma
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(1),
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    lead: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    leadEvent: {
      create: vi.fn(),
    },
    tenantUsage: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

// Mock Redis
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    del: vi.fn(),
  },
}));

// Mock secrets vault
vi.mock('../../src/tenant/secrets-vault.js', () => ({
  getDecryptedSecrets: vi.fn(),
}));

describe('CaptureGoogleMaps Worker', () => {
  const tenantId = 'tenant-uuid-111';
  const campaignId = 'campaign-uuid-222';

  const mockJob = {
    id: 'job-123',
    data: {
      tenant_id: tenantId,
      campaign_id: campaignId,
      trace_id: 'trace-123',
      max_captures: 5,
    },
  } as unknown as Job;

  beforeEach(() => {
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(getDecryptedSecrets).mockResolvedValue({
      googleMapsApiKey: 'mock-maps-key-999',
    } as any);
  });

  it('should skip execution if the Redis lock is already held', async () => {
    vi.mocked(redis.set).mockResolvedValue(null); // lock not acquired

    const worker = new CaptureGoogleMapsWorker();
    const result = await worker.run(mockJob);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('locked');
    expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('should capture places successfully, respect limit and save to database', async () => {
    const mockCampaign = {
      id: campaignId,
      tenantId,
      name: 'Cardio Campaign',
      status: CampaignStatus.ACTIVE,
      profession: Profession.DOCTOR,
      cities: ['São José do Rio Preto'],
      neighborhoods: [],
      dailyLimit: 10,
    };

    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);
    vi.mocked(prisma.lead.count).mockResolvedValue(0); // 0 captured today
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null); // no duplicates
    vi.mocked(prisma.lead.create).mockResolvedValue({ id: 'lead-uuid-999' } as any);

    const worker = new CaptureGoogleMapsWorker();
    const result = await worker.run(mockJob);

    expect(result.status).toBe('success');
    expect(result.captured).toBe(2); // mock has 2 places
    expect(result.skipped).toBe(0);
    
    // Verifies creation in transaction
    expect(prisma.lead.create).toHaveBeenCalledTimes(2);
    expect(prisma.leadEvent.create).toHaveBeenCalledTimes(2);

    // Verifies usage logging and Redis lock release
    expect(prisma.tenantUsage.upsert).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith(`lock:capture:${tenantId}:${campaignId}`);
  });

  it('should skip if campaign is not active', async () => {
    const mockCampaign = {
      id: campaignId,
      status: CampaignStatus.DRAFT,
    };

    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);

    const worker = new CaptureGoogleMapsWorker();
    const result = await worker.run(mockJob);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('campaign_inactive_or_not_found');
    expect(redis.del).toHaveBeenCalled();
  });

  it('should skip if daily limit is already reached', async () => {
    const mockCampaign = {
      id: campaignId,
      status: CampaignStatus.ACTIVE,
      dailyLimit: 10,
    };

    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);
    vi.mocked(prisma.lead.count).mockResolvedValue(10); // reached limit

    const worker = new CaptureGoogleMapsWorker();
    const result = await worker.run(mockJob);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('daily_limit_reached');
  });
});
