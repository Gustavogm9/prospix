import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../../src/index.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';
import { redis } from '../../src/lib/redis.js';
import { MeetingStatus } from '@prospix/shared-types';

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
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
  redisConnection: {},
}));

// Mock queue helpers
vi.mock('../../src/lib/queue.js', () => ({
  getTenantQueueName: vi.fn((t, w) => `queue:${t}:${w}`),
  createTenantQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({}),
  })),
}));

describe('Tenant API Routes', () => {
  const mockTenantId = 'tenant-1234';

  let mockToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // Generate a valid RS256 token payload for authentication
    mockToken = 'mock-supabase-token-for-test';
  });

  describe('GET /v1/tenant/meetings', () => {
    it('should return 401 if unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/tenant/meetings',
      });
      expect(res.statusCode).toBe(401);
    });

    it('should return lists of meetings when authenticated', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'meeting-1',
              tenant_id: mockTenantId,
              lead_id: 'lead-1',
              google_event_id: 'evt-1',
              scheduled_for: new Date().toISOString(),
              duration_minutes: 30,
              location: 'Google Meet',
              status: MeetingStatus.SCHEDULED,
            },
          ],
          error: null,
        }),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'meeting-1',
              tenant_id: mockTenantId,
              lead_id: 'lead-1',
              google_event_id: 'evt-1',
              scheduled_for: new Date().toISOString(),
              duration_minutes: 30,
              location: 'Google Meet',
              status: MeetingStatus.SCHEDULED,
            },
          ],
          error: null,
        }),
      }) as any);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/tenant/meetings',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('meeting-1');
    });
  });

  describe('PATCH /v1/tenant/meetings/:id', () => {
    it('should update meeting outcome and lead status correctly', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'meetings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'meeting-1',
                tenant_id: mockTenantId,
                lead_id: 'lead-1',
              },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'meeting-1',
                tenant_id: mockTenantId,
                lead_id: 'lead-1',
              },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          } as any;
        }
        if (table === 'leads') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
          } as any;
        }
        if (table === 'lead_events') {
          return {
            insert: vi.fn().mockReturnThis(),
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

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/tenant/meetings/meeting-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          outcome: 'CLOSED',
          policy_value_cents: 100000,
          commission_cents: 20000,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('meetings');
      expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    });
  });

  describe('GET /v1/tenant/dashboard/today', () => {
    it('should fetch today dashboard counts with SWR cache', async () => {
      // Mock Redis Cache Miss
      vi.mocked(redis.get).mockResolvedValue(null);

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'meetings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ scheduled_for: new Date('2026-05-23T13:30:00.000Z').toISOString() }],
              error: null,
              count: 3,
            }),
            single: vi.fn().mockResolvedValue({
              data: { scheduled_for: new Date('2026-05-23T13:30:00.000Z').toISOString() },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { scheduled_for: new Date('2026-05-23T13:30:00.000Z').toISOString() },
              error: null,
            }),
          } as any;
        }
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ count: 5, error: null }),
          } as any;
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ count: 2, error: null }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/tenant/dashboard/today',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.meetings_today).toBe(3);
      expect(body.data.conversations_ready).toBe(5);
      expect(body.data.need_callback).toBe(2);
      expect(body.data.pending_manual_conversations).toBe(1);
      expect(body.data.new_leads_today).toBe(4);
      expect(body.data.next_meeting_time).toBe('10:30');
      expect(redis.set).toHaveBeenCalled();
    });
  });
});
