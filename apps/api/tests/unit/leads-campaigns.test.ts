import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../../src/index.js';
import { prisma } from '../../src/lib/prisma.js';
import { LeadStatus, Profession, CampaignStatus } from '@prisma/client';

// Mock Prisma
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    lead: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    leadEvent: {
      create: vi.fn(),
    },
    optout: {
      upsert: vi.fn(),
    },
    leadNote: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    campaign: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

describe('Tenant Leads & Campaigns API Routes', () => {
  const mockTenantId = 'tenant-abcd-1234';
  const mockUserId = 'user-efgh-5678';
  let mockToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    mockToken = app.jwt.sign({
      sub: mockUserId,
      tenant_id: mockTenantId,
      role: 'OWNER',
      email: 'owner@tenant.com',
      name: 'Tenant Owner',
    });
  });

  describe('Leads Endpoints', () => {
    it('GET /v1/tenant/leads - should return list of leads', async () => {
      const mockLeads = [
        { id: 'lead-1', name: 'Dr. Roberto', whatsapp: '551732321010', status: LeadStatus.CAPTURED }
      ];
      vi.mocked(prisma.lead.findMany).mockResolvedValue(mockLeads as any);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/tenant/leads',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Dr. Roberto');
    });

    it('POST /v1/tenant/leads - should create manual lead successfully', async () => {
      vi.mocked(prisma.lead.findUnique).mockResolvedValue(null); // No duplicates
      vi.mocked(prisma.lead.create).mockResolvedValue({
        id: 'lead-new',
        name: 'New Lead',
        whatsapp: '5517998877665',
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/leads',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          name: 'New Lead',
          whatsapp: '17998877665',
          profession: Profession.DOCTOR,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBe('lead-new');
      expect(prisma.lead.create).toHaveBeenCalled();
    });

    it('POST /v1/tenant/leads - should return 409 Conflict if whatsapp duplicate exists', async () => {
      vi.mocked(prisma.lead.findUnique).mockResolvedValue({ id: 'existing' } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/leads',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          name: 'Duplicate Lead',
          whatsapp: '17998877665',
        },
      });

      expect(res.statusCode).toBe(409);
    });

    it('PATCH /v1/tenant/leads/:id - should transition status matching state machine', async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValue({
        id: 'lead-1',
        status: LeadStatus.CAPTURED,
      } as any);

      vi.mocked(prisma.lead.update).mockResolvedValue({
        id: 'lead-1',
        status: LeadStatus.ENRICHED,
      } as any);

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/tenant/leads/lead-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          status: LeadStatus.ENRICHED, // Valid transition CAPTURED -> ENRICHED
        },
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.lead.update).toHaveBeenCalled();
    });

    it('PATCH /v1/tenant/leads/:id - should reject invalid transition status', async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValue({
        id: 'lead-1',
        status: LeadStatus.CAPTURED,
      } as any);

      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/tenant/leads/lead-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          status: LeadStatus.CONTACTED, // Invalid transition CAPTURED -> CONTACTED
        },
      });

      expect(res.statusCode).toBe(400);
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('DELETE /v1/tenant/leads/:id - should perform soft delete', async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValue({
        id: 'lead-1',
      } as any);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/tenant/leads/lead-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(204);
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            status: LeadStatus.ARCHIVED,
          }),
        })
      );
    });

    it('POST /v1/tenant/leads/:id/optout - should register optout and update status', async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValue({
        id: 'lead-1',
        whatsapp: '5517998877665',
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/leads/lead-1/optout',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          reason: 'Customer requested stop',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.optout.upsert).toHaveBeenCalled();
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: { status: LeadStatus.OPTED_OUT },
        })
      );
    });

    it('POST & GET lead notes', async () => {
      vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: 'lead-1' } as any);
      vi.mocked(prisma.leadNote.create).mockResolvedValue({ id: 'note-1', content: 'Good fit' } as any);
      vi.mocked(prisma.leadNote.findMany).mockResolvedValue([{ id: 'note-1', content: 'Good fit' }] as any);

      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/tenant/leads/lead-1/notes',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          content: 'Good fit',
        },
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await app.inject({
        method: 'GET',
        url: '/v1/tenant/leads/lead-1/notes',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.payload)).toHaveLength(1);
    });
  });

  describe('Campaigns Endpoints', () => {
    it('GET /v1/tenant/campaigns - list campaigns', async () => {
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([
        { id: 'camp-1', name: 'Doctors Rio Preto', status: CampaignStatus.ACTIVE }
      ] as any);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/tenant/campaigns',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toHaveLength(1);
    });

    it('POST /v1/tenant/campaigns - create campaign with draft status', async () => {
      vi.mocked(prisma.campaign.create).mockResolvedValue({
        id: 'camp-new',
        name: 'New Campaign',
        status: CampaignStatus.DRAFT,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/campaigns',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
        payload: {
          name: 'New Campaign',
          profession: Profession.DOCTOR,
          cities: ['São José do Rio Preto'],
          dailyLimit: 50,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBe('camp-new');
      expect(body.status).toBe('DRAFT');
    });

    it('POST /v1/tenant/campaigns/:id/pause - should pause active campaign', async () => {
      vi.mocked(prisma.campaign.findFirst).mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.ACTIVE,
      } as any);

      vi.mocked(prisma.campaign.update).mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.PAUSED,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/campaigns/camp-1/pause',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'camp-1' },
          data: { status: CampaignStatus.PAUSED },
        })
      );
    });

    it('POST /v1/tenant/campaigns/:id/resume - should activate paused or draft campaign', async () => {
      vi.mocked(prisma.campaign.findFirst).mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.PAUSED,
      } as any);

      vi.mocked(prisma.campaign.update).mockResolvedValue({
        id: 'camp-1',
        status: CampaignStatus.ACTIVE,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/campaigns/camp-1/resume',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'camp-1' },
          data: { status: CampaignStatus.ACTIVE },
        })
      );
    });

    it('DELETE /v1/tenant/campaigns/:id - should soft delete campaign', async () => {
      vi.mocked(prisma.campaign.findFirst).mockResolvedValue({
        id: 'camp-1',
      } as any);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/tenant/campaigns/camp-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(204);
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'camp-1' },
          data: expect.objectContaining({
            status: CampaignStatus.ARCHIVED,
            archivedAt: expect.any(Date),
          }),
        })
      );
    });
  });
});
