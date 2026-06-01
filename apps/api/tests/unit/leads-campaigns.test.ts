import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../../src/index.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';
import { LeadStatus, Profession, CampaignStatus } from '@prospix/shared-types';

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

describe('Tenant Leads & Campaigns API Routes', () => {
  const mockTenantId = 'tenant-abcd-1234';

  let mockToken: string;

  beforeEach(() => {
    vi.clearAllMocks();

    mockToken = 'mock-supabase-token-for-test';
  });

  describe('Leads Endpoints', () => {
    it('GET /v1/tenant/leads - should return list of leads', async () => {
      const mockLeads = [
        { id: 'lead-1', name: 'Dr. Roberto', whatsapp: '551732321010', status: LeadStatus.CAPTURED }
      ];

      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockLeads, error: null }),
        range: vi.fn().mockResolvedValue({ data: mockLeads, error: null }),
      }) as any);

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
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnThis(),
        } as any;
      });

      // Override for the create call specifically
      const insertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'lead-new',
            name: 'New Lead',
            whatsapp: '5517998877665',
          },
          error: null,
        }),
      };
      vi.mocked(supabaseAdmin.from).mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        ...insertChain,
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
      expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    });

    it('POST /v1/tenant/leads - should return 409 Conflict if whatsapp duplicate exists', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'existing' }, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing' }, error: null }),
      }) as any);

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
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'lead-1', status: LeadStatus.CAPTURED },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'lead-1', status: LeadStatus.CAPTURED },
          error: null,
        }),
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
      }) as any);

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
      expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    });

    it('PATCH /v1/tenant/leads/:id - should reject invalid transition status', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'lead-1', status: LeadStatus.CAPTURED },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'lead-1', status: LeadStatus.CAPTURED },
          error: null,
        }),
      }) as any);

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
    });

    it('DELETE /v1/tenant/leads/:id - should perform soft delete', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'lead-1' },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'lead-1' },
          error: null,
        }),
        update: vi.fn().mockReturnThis(),
      }) as any);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/tenant/leads/lead-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(204);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    });

    it('POST /v1/tenant/leads/:id/optout - should register optout and update status', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'lead-1', whatsapp: '5517998877665' },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'lead-1', whatsapp: '5517998877665' },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          } as any;
        }
        if (table === 'optouts') {
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
          insert: vi.fn().mockReturnThis(),
        } as any;
      });

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
      expect(supabaseAdmin.from).toHaveBeenCalledWith('optouts');
      expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    });

    it('POST & GET lead notes', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'lead-1' }, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'lead-1' }, error: null }),
          } as any;
        }
        if (table === 'lead_notes') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [{ id: 'note-1', content: 'Good fit' }], error: null }),
            insert: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'note-1', content: 'Good fit' }, error: null }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

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
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{ id: 'camp-1', name: 'Doctors Rio Preto', status: CampaignStatus.ACTIVE }],
          error: null,
        }),
      }) as any);

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
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'camp-new',
            name: 'New Campaign',
            status: CampaignStatus.DRAFT,
          },
          error: null,
        }),
      }) as any);

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
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'camp-1', status: CampaignStatus.ACTIVE },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'camp-1', status: CampaignStatus.ACTIVE },
          error: null,
        }),
        update: vi.fn().mockReturnThis(),
      }) as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/campaigns/camp-1/pause',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('campaigns');
    });

    it('POST /v1/tenant/campaigns/:id/resume - should activate paused or draft campaign', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'camp-1', status: CampaignStatus.PAUSED },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'camp-1', status: CampaignStatus.PAUSED },
          error: null,
        }),
        update: vi.fn().mockReturnThis(),
      }) as any);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/tenant/campaigns/camp-1/resume',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('campaigns');
    });

    it('DELETE /v1/tenant/campaigns/:id - should soft delete campaign', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'camp-1' },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'camp-1' },
          error: null,
        }),
        update: vi.fn().mockReturnThis(),
      }) as any);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/tenant/campaigns/camp-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
          'x-tenant-id': mockTenantId,
        },
      });

      expect(res.statusCode).toBe(204);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('campaigns');
    });
  });
});
