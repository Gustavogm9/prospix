import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { CaptureGoogleMapsWorker } from '../../src/workers/capture-google-maps.js';
import { googleMapsHandlers } from '../../../../packages/mocks/src/google-maps.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';
import { redis } from '../../src/lib/redis.js';
import { getDecryptedSecrets } from '../../src/tenant/secrets-vault.js';
import { Job } from 'bullmq';
import { Profession, CampaignStatus } from '@prospix/shared-types';

// Setup MSW mock server for searchPlaces internally
const server = setupServer(...googleMapsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

// Mock Supabase
vi.mock('../../src/lib/supabase.js', () => {
  const chainable = () => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  return {
    supabaseAdmin: {
      from: vi.fn(() => chainable()),
    },
  };
});

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
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('campaigns');
  });

  it('should capture places successfully, respect limit and save to database', async () => {
    const mockCampaign = {
      id: campaignId,
      tenant_id: tenantId,
      name: 'Cardio Campaign',
      status: CampaignStatus.ACTIVE,
      profession: Profession.DOCTOR,
      cities: ['São José do Rio Preto'],
      neighborhoods: [],
      daily_limit: 10,
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
          update: vi.fn().mockReturnThis(),
        } as any;
      }
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
              }),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          insert: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'lead-uuid-999' }, error: null }),
        } as any;
      }
      if (table === 'lead_events') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        } as any;
      }
      if (table === 'tenant_usage') {
        return {
          upsert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const worker = new CaptureGoogleMapsWorker();
    const result = await worker.run(mockJob);

    expect(result.status).toBe('success');
    expect(result.captured).toBe(2); // mock has 2 places
    expect(result.skipped).toBe(0);

    // Verifies Supabase was used for leads and events
    expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('lead_events');

    // Verifies usage logging and Redis lock release
    expect(supabaseAdmin.from).toHaveBeenCalledWith('tenant_usage');
    expect(redis.del).toHaveBeenCalledWith(`lock:capture:${tenantId}:${campaignId}`);
  });

  it('should skip if campaign is not active', async () => {
    const mockCampaign = {
      id: campaignId,
      status: CampaignStatus.DRAFT,
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
    }) as any);

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
      daily_limit: 10,
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
        } as any;
      }
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ count: 10, error: null }),
              }),
            }),
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const worker = new CaptureGoogleMapsWorker();
    const result = await worker.run(mockJob);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('daily_limit_reached');
  });
});
