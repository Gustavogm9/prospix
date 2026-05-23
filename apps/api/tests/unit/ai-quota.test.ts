import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRouter } from '../../src/ai/router.js';
import {
  AIQuotaExceededError,
  assertAIQuotaBeforeCall,
  estimateAICallCostCents,
  getAIPlanLimitCents,
} from '../../src/ai/quota.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';
import { getDecryptedSecrets } from '../../src/tenant/secrets-vault.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    tenantAIConfig: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    tenantUsage: {
      findUnique: vi.fn(),
    },
  },
}));

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
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1', plan: 'STARTER' } as any);
    vi.mocked(prisma.tenantUsage.findUnique).mockResolvedValue({ llmCostCents: 4999 } as any);

    await expect(assertAIQuotaBeforeCall({
      tenantId: 'tenant-1',
      model: 'gpt-4o-mini',
      messages: [{ content: 'A'.repeat(4000) }],
      maxTokens: 4096,
      now: new Date('2026-05-22T12:00:00.000Z'),
    })).rejects.toBeInstanceOf(AIQuotaExceededError);
  });

  it('lets AIRouter fail before loading secrets or providers when quota is exceeded', async () => {
    vi.mocked(prisma.tenantAIConfig.findUnique).mockResolvedValue({
      tenantId: 'tenant-1',
      systemProvider: 'openai',
      systemModel: 'gpt-4o-mini',
      fallbackChain: ['openai'],
      systemTemperature: 0.4,
      maxOutputTokens: 4096,
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1', plan: 'STARTER' } as any);
    vi.mocked(prisma.tenantUsage.findUnique).mockResolvedValue({ llmCostCents: 4999 } as any);

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
