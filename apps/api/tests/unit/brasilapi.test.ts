import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { getCnpjInfo } from '../../src/integrations/brasilapi.js';
import { brasilApiHandlers } from '../../../../packages/mocks/src/brasilapi.js';
import { redis } from '../../src/lib/redis.js';

// Mock Redis connection
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const server = setupServer(...brasilApiHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

describe('BrasilAPI & ReceitaWS Integration', () => {
  it('should get CNPJ info from BrasilAPI successfully and save to Redis cache', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const result = await getCnpjInfo('12345678000199');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cnpj).toBe('12345678000199');
      expect(result.value.razaoSocial).toBe('MOCK CLINIC LTDA');
      expect(result.value.nomeFantasia).toBe('CLINICA MOCK');
      expect(result.value.situacaoCadastral).toBe('ATIVA');
      expect(result.value.uf).toBe('SP');
      expect(result.value.bairro).toBe('CENTRO');
      expect(result.value.qsa).toHaveLength(1);
      expect(result.value.qsa?.[0]?.nome).toBe('DR. ROBERTO LIMA');
    }

    // Must cache result in Redis for 7 days (604800 seconds)
    expect(redis.set).toHaveBeenCalledWith(
      'cnpj:12345678000199',
      expect.stringContaining('MOCK CLINIC LTDA'),
      'EX',
      604800
    );
  });

  it('should return cached CNPJ info from Redis without hitting the APIs', async () => {
    const cachedCnpj = {
      cnpj: '12345678000199',
      razaoSocial: 'CACHED CLINIC',
      situacaoCadastral: 'ATIVA',
    };
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedCnpj));

    const result = await getCnpjInfo('12345678000199');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.razaoSocial).toBe('CACHED CLINIC');
    }

    // Should not call redis.set
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('should fallback to ReceitaWS if BrasilAPI fails with a 500 error', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    // 55555555000155 is mocked to return 500 in BrasilAPI and return success in ReceitaWS
    const result = await getCnpjInfo('55555555000155');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cnpj).toBe('55555555000155');
      expect(result.value.razaoSocial).toBe('FALLBACK CLINIC CLINICAL SERVICES');
      expect(result.value.nomeFantasia).toBe('FALLBACK CLINIC');
      expect(result.value.situacaoCadastral).toBe('ATIVA');
      expect(result.value.dataInicioAtividade).toBe('2015-10-21');
    }

    expect(redis.set).toHaveBeenCalledWith(
      'cnpj:55555555000155',
      expect.stringContaining('FALLBACK CLINIC CLINICAL SERVICES'),
      'EX',
      604800
    );
  });

  it('should return RESOURCE_NOT_FOUND if CNPJ does not exist in both APIs', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const result = await getCnpjInfo('00000000000000');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RESOURCE_NOT_FOUND');
    }
  });
});
