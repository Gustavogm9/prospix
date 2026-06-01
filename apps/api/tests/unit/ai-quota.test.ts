import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRouter } from '../../src/ai/router.js';
import {
  AIQuotaExceededError,
  assertAIQuotaBeforeCall,
  estimateAICallCostCents,
  getAIPlanLimitCents,
} from '../../src/ai/quota.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';
import { redis } from '../../src/lib/redis.js';
import { getDecryptedSecrets } from '../../src/tenant/secrets-vault.js';

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

vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/tenant/secrets-vault.js', () => ({
  getDecryptedSecrets: vi.fn(),
}));

describe('AI quota guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue('OK');
  });

  it('uses one plan limit table for AI quotas', () => {
    expect(getAIPlanLimitCents('STARTER')).toBe(5000);
    expect(getAIPlanLimitCents('STANDARD')).toBe(15000);
    expect(getAIPlanLimitCents('PREMIUM')).toBe(50000);
    expect(getAIPlanLimitCents(undefined)).toBe(15000);
  });

  it('blocks an AI call when the estimated request would exceed the monthly plan limit', async () => {
    // Mock tenant lookup
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'tenant-1', plan: 'STARTER' }, error: null }),
        } as any;
      }
      if (table === 'tenant_usage') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { llm_cost_cents: 4999 }, error: null }),
        } as any;
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    await expect(assertAIQuotaBeforeCall({
      tenantId: 'tenant-1',
      model: 'gpt-4o-mini',
      messages: [{ content: 'A'.repeat(4000) }],
      maxTokens: 4096,
      now: new Date('2026-05-22T12:00:00.000Z'),
    })).rejects.toBeInstanceOf(AIQuotaExceededError);
  });

  it('lets AIRouter fail before loading secrets or providers when quota is exceeded', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'tenant_ai_configs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              tenant_id: 'tenant-1',
              system_provider: 'openai',
              system_model: 'gpt-4o-mini',
              fallback_chain: ['openai'],
              system_temperature: 0.4,
              max_output_tokens: 4096,
            },
            error: null,
          }),
        } as any;
      }
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'tenant-1', plan: 'STARTER' }, error: null }),
        } as any;
      }
      if (table === 'tenant_usage') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { llm_cost_cents: 4999 }, error: null }),
        } as any;
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) } as any;
    });

    await expect(AIRouter.call({
      tenantId: 'tenant-1',
      useCase: 'system',
      messages: [{ role: 'user', content: 'Preciso de uma resposta completa.' }],
      maxTokens: 4096,
    })).rejects.toBeInstanceOf(AIQuotaExceededError);

    expect(getDecryptedSecrets).not.toHaveBeenCalled();
  });

  it('estimates a non-zero maximum cost for known models', () => {
    expect(estimateAICallCostCents({
      model: 'gpt-4o-mini',
      messages: [{ content: 'Pergunta do lead' }],
      maxTokens: 1024,
    })).toBeGreaterThan(0);
  });
});
