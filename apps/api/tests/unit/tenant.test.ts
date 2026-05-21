import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../../src/index.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';
import { MeetingOutcome, MeetingStatus } from '@prisma/client';

// Mock Prisma
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn((callback) => callback(prisma)),
    meeting: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    lead: {
      count: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    conversation: {
      count: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenantUsage: {
      findUnique: vi.fn(),
    },
    leadEvent: {
      create: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    notificationPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

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
  const mockUserId = 'user-5678';
  let mockToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // Generate a valid RS256 token payload for authentication
    mockToken = app.jwt.sign({
      sub: mockUserId,
      tenant_id: mockTenantId,
      role: 'OWNER',
      email: 'owner@tenant.com',
      name: 'Tenant Owner',
    });
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
      vi.mocked(prisma.meeting.findMany).mockResolvedValue([
        {
          id: 'meeting-1',
          tenantId: mockTenantId,
          leadId: 'lead-1',
          googleEventId: 'evt-1',
          scheduledFor: new Date(),
          durationMinutes: 30,
          location: 'Google Meet',
          status: MeetingStatus.SCHEDULED,
        },
      ] as any);

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
      vi.mocked(prisma.meeting.findFirst).mockResolvedValue({
        id: 'meeting-1',
        tenantId: mockTenantId,
        leadId: 'lead-1',
      } as any);

      vi.mocked(prisma.meeting.update).mockResolvedValue({
        id: 'meeting-1',
        outcome: MeetingOutcome.CLOSED,
        status: MeetingStatus.HAPPENED,
      } as any);

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
      expect(prisma.meeting.update).toHaveBeenCalled();
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { status: 'CLOSED_WON', closedAt: expect.any(Date) },
      });
    });
  });

  describe('GET /v1/tenant/dashboard/today', () => {
    it('should fetch today dashboard counts with SWR cache', async () => {
      // Mock Redis Cache Miss
      vi.mocked(redis.get).mockResolvedValue(null);

      // Mock database aggregate counts
      vi.mocked(prisma.meeting.count).mockResolvedValue(3);
      vi.mocked(prisma.conversation.count).mockResolvedValue(5);
      vi.mocked(prisma.lead.count).mockResolvedValue(2);

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
      expect(redis.set).toHaveBeenCalled();
    });
  });
});
