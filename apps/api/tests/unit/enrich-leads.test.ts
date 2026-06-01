import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { EnrichLeadsWorker } from '../../src/workers/enrich-leads.js';
import { evolutionHandlers } from '../../../../packages/mocks/src/evolution.js';
import { brasilApiHandlers } from '../../../../packages/mocks/src/brasilapi.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';
import { getDecryptedSecrets } from '../../src/tenant/secrets-vault.js';
import { Job } from 'bullmq';
import { Profession, LeadStatus } from '@prospix/shared-types';

const server = setupServer(...evolutionHandlers, ...brasilApiHandlers);

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

// Mock secrets vault
vi.mock('../../src/tenant/secrets-vault.js', () => ({
  getDecryptedSecrets: vi.fn(),
}));

// Mock Redis
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  },
}));

describe('EnrichLeads Worker', () => {
  const tenantId = 'tenant-uuid-111';
  const campaignId = 'campaign-uuid-222';

  const mockJob = {
    id: 'job-789',
    data: {
      tenant_id: tenantId,
      lead_ids: ['lead-1', 'lead-2'],
      trace_id: 'trace-789',
    },
  } as unknown as Job;

  beforeEach(() => {
    vi.mocked(getDecryptedSecrets).mockResolvedValue({
      evolutionBaseUrl: 'https://evo.prospix.com.br',
      evolutionInstanceName: 'tenant_mock',
      evolutionApiKey: 'key-123',
    } as any);
  });

  it('should successfully validate WhatsApp, enrich CNPJ for entrepreneur, calculate fit, and transition to ENRICHED', async () => {
    const mockLead = {
      id: 'lead-1',
      tenant_id: tenantId,
      campaign_id: campaignId,
      whatsapp: '5517998764422',
      profession: Profession.ENTREPRENEUR,
      google_rating: 4.8,
      google_reviews_count: 15,
      address: { neighborhood: 'Redentora' },
      metadata: { cnpj: '12345678000199' },
    };

    const mockCampaign = {
      id: campaignId,
      profession: Profession.ENTREPRENEUR,
      filters: { min_fit_score: 6.0 },
    };

    const mockTenant = {
      id: tenantId,
      high_value_areas: ['Redentora'],
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockTenant, error: null }),
        } as any;
      }
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [mockLead], error: null }),
          update: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { ...mockLead, status: LeadStatus.ENRICHED }, error: null }),
        } as any;
      }
      if (table === 'campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
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

    const worker = new EnrichLeadsWorker();
    const result = await worker.run(mockJob);

    expect(result.processed).toBe(1);
    expect(result.enriched).toBe(1);
    expect(result.archived).toBe(0);

    // Verify database updates through Supabase
    expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('lead_events');
  });

  it('should transition lead to ARCHIVED if fit score is below threshold', async () => {
    const mockLead = {
      id: 'lead-2',
      tenant_id: tenantId,
      campaign_id: campaignId,
      whatsapp: '5517998764422',
      profession: Profession.ENTREPRENEUR, // Mismatch with campaign profession
      metadata: { cnpj: '12345678000199' },
    };

    const mockCampaign = {
      id: campaignId,
      profession: Profession.DOCTOR, // Expects doctor -> mismatch penalty -5.0 applies
      filters: { min_fit_score: 6.0 },
    };

    const mockTenant = {
      id: tenantId,
      high_value_areas: [],
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockTenant, error: null }),
        } as any;
      }
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [mockLead], error: null }),
          update: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { ...mockLead, status: LeadStatus.ARCHIVED }, error: null }),
        } as any;
      }
      if (table === 'campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
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

    const worker = new EnrichLeadsWorker();
    const result = await worker.run(mockJob);

    expect(result.processed).toBe(1);
    expect(result.enriched).toBe(0);
    expect(result.archived).toBe(1);

    expect(supabaseAdmin.from).toHaveBeenCalledWith('leads');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('lead_events');
  });

  it('should bubble up EXTERNAL_SERVICE_DOWN from Evolution API to activate BullMQ retry', async () => {
    // Force checkPhone to fail with 500
    server.use(
      http.post('*/chat/whatsappNumbers/:instance', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );

    const mockLead = {
      id: 'lead-1',
      tenant_id: tenantId,
      campaign_id: campaignId,
      whatsapp: '5517998764422',
      profession: Profession.DOCTOR,
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [mockLead], error: null }),
        } as any;
      }
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: tenantId, high_value_areas: [] }, error: null }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const worker = new EnrichLeadsWorker();
    await expect(worker.run(mockJob)).rejects.toThrow('Evolution API is down');
  });

  it('should fail closed when Evolution API key is not configured', async () => {
    const originalEvolutionKey = process.env.EVOLUTION_GUILDS_API_KEY;
    delete process.env.EVOLUTION_GUILDS_API_KEY;
    vi.mocked(getDecryptedSecrets).mockResolvedValue({
      evolutionBaseUrl: 'https://evo.prospix.com.br',
      evolutionInstanceName: 'tenant_mock',
      evolutionApiKey: null,
    } as any);

    try {
      const worker = new EnrichLeadsWorker();
      await expect(worker.run(mockJob)).rejects.toThrow('Evolution API key is required');
      expect(supabaseAdmin.from).not.toHaveBeenCalledWith('leads');
    } finally {
      if (originalEvolutionKey === undefined) {
        delete process.env.EVOLUTION_GUILDS_API_KEY;
      } else {
        process.env.EVOLUTION_GUILDS_API_KEY = originalEvolutionKey;
      }
    }
  });
});
