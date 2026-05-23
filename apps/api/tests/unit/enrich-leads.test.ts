import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { EnrichLeadsWorker } from '../../src/workers/enrich-leads.js';
import { evolutionHandlers } from '../../../../packages/mocks/src/evolution.js';
import { brasilApiHandlers } from '../../../../packages/mocks/src/brasilapi.js';
import { prisma } from '../../src/lib/prisma.js';
import { getDecryptedSecrets } from '../../src/tenant/secrets-vault.js';
import { Job } from 'bullmq';
import { Profession, LeadStatus } from '@prisma/client';

const server = setupServer(...evolutionHandlers, ...brasilApiHandlers);

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
    tenant: {
      findUnique: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    leadEvent: {
      create: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

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

    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: tenantId,
      highValueAreas: ['Redentora'],
    } as any);
  });

  it('should successfully validate WhatsApp, enrich CNPJ for entrepreneur, calculate fit, and transition to ENRICHED', async () => {
    const mockLead = {
      id: 'lead-1',
      tenantId,
      campaignId,
      whatsapp: '5517998764422', // long enough to mock exists = true
      profession: Profession.ENTREPRENEUR,
      googleRating: 4.8,
      googleReviewsCount: 15,
      address: { neighborhood: 'Redentora' },
      metadata: { cnpj: '12345678000199' },
    };

    const mockCampaign = {
      id: campaignId,
      profession: Profession.ENTREPRENEUR,
      filters: { min_fit_score: 6.0 },
    };

    vi.mocked(prisma.lead.findMany).mockResolvedValue([mockLead] as any);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);

    const worker = new EnrichLeadsWorker();
    const result = await worker.run(mockJob);

    expect(result.processed).toBe(1);
    expect(result.enriched).toBe(1);
    expect(result.archived).toBe(0);

    // Verify database updates
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({
          whatsappValid: true,
          status: LeadStatus.ENRICHED,
          partnerOrOwner: true,
        }),
      })
    );
    expect(prisma.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'enriched',
        }),
      })
    );
  });

  it('should transition lead to ARCHIVED if fit score is below threshold', async () => {
    const mockLead = {
      id: 'lead-2',
      tenantId,
      campaignId,
      whatsapp: '5517998764422',
      profession: Profession.ENTREPRENEUR, // Mismatch with campaign profession
      metadata: { cnpj: '12345678000199' },
    };

    const mockCampaign = {
      id: campaignId,
      profession: Profession.DOCTOR, // Expects doctor -> mismatch penalty -5.0 applies
      filters: { min_fit_score: 6.0 },
    };

    vi.mocked(prisma.lead.findMany).mockResolvedValue([mockLead] as any);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);

    const worker = new EnrichLeadsWorker();
    const result = await worker.run(mockJob);

    expect(result.processed).toBe(1);
    expect(result.enriched).toBe(0);
    expect(result.archived).toBe(1);

    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-2' },
        data: expect.objectContaining({
          status: LeadStatus.ARCHIVED,
        }),
      })
    );
    expect(prisma.leadEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'archived',
        }),
      })
    );
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
      tenantId,
      campaignId,
      whatsapp: '5517998764422',
      profession: Profession.DOCTOR,
    };

    vi.mocked(prisma.lead.findMany).mockResolvedValue([mockLead] as any);

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
      expect(prisma.lead.findMany).not.toHaveBeenCalled();
    } finally {
      if (originalEvolutionKey === undefined) {
        delete process.env.EVOLUTION_GUILDS_API_KEY;
      } else {
        process.env.EVOLUTION_GUILDS_API_KEY = originalEvolutionKey;
      }
    }
  });
});
