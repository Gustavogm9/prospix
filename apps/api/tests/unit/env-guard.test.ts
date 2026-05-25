import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const protectedRuntimes = ['staging', 'production'] as const;

const requiredCoreEnv = {
  APP_URL: 'https://app.prospix.test',
  ADMIN_URL: 'https://admin.prospix.test',
  LANDING_URL: 'https://prospix.test',
  API_URL: 'https://api.prospix.test',
  DATABASE_URL: 'postgresql://prospix:secret@db.prospix.test:5432/prospix',
  REDIS_URL: 'redis://redis.prospix.test:6379',
  JWT_PRIVATE_KEY: 'real-private-key',
  JWT_PUBLIC_KEY: 'real-public-key',
  SECRETS_ENCRYPTION_KEY: 'real-secrets-encryption-key-32-chars-long',
  EVOLUTION_GUILDS_API_KEY: 'real-evolution-guilds-api-key',
};

const realIntegrationEnv = {
  GOOGLE_CLIENT_ID: 'real-google-client-id',
  GOOGLE_CLIENT_SECRET: 'real-google-client-secret',
  ASAAS_API_KEY: 'real-asaas-api-key',
  ASAAS_BASE_URL: 'https://api.asaas.com/v3',
  ASAAS_WEBHOOK_SECRET: 'real-asaas-webhook-secret',
  RESEND_API_KEY: 'real-resend-api-key',
};

const mockCredentialCases = [
  ['GOOGLE_CLIENT_ID', 'mock-client-id'],
  ['GOOGLE_CLIENT_SECRET', 'mock-client-secret'],
  ['ASAAS_API_KEY', 'mock-asaas-key'],
  ['ASAAS_WEBHOOK_SECRET', 'mock-asaas-webhook-secret'],
  ['RESEND_API_KEY', 'mock-resend-key'],
  ['EVOLUTION_GUILDS_API_KEY', 'mock_guilds_api_key'],
] as const;

function setEnv(env: Record<string, string>) {
  process.env = { ...env } as NodeJS.ProcessEnv;
}

async function importEnv(env: Record<string, string>) {
  vi.resetModules();
  vi.doMock('dotenv', () => ({
    default: {
      config: vi.fn(),
    },
  }));

  setEnv(env);
  return import('../../src/config/env.js');
}

function loggedValidationOutput() {
  return vi.mocked(console.error).mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('environment production guards', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unmock('dotenv');
  });

  it.each(protectedRuntimes)('rejects mock credential defaults in %s', async (nodeEnv) => {
    await expect(importEnv({
      ...requiredCoreEnv,
      NODE_ENV: nodeEnv,
    })).rejects.toThrow('Invalid environment variables');

    expect(loggedValidationOutput()).toContain('GOOGLE_CLIENT_ID');
    expect(loggedValidationOutput()).toContain('GOOGLE_CLIENT_SECRET');
    expect(loggedValidationOutput()).toContain('ASAAS_API_KEY');
    expect(loggedValidationOutput()).toContain('ASAAS_WEBHOOK_SECRET');
    expect(loggedValidationOutput()).toContain('RESEND_API_KEY');
  });

  it.each(
    protectedRuntimes.flatMap((nodeEnv) =>
      mockCredentialCases.map(([key, value]) => [nodeEnv, key, value] as const),
    ),
  )('rejects %s when %s is mock', async (nodeEnv, key, value) => {
    await expect(importEnv({
      ...requiredCoreEnv,
      ...realIntegrationEnv,
      NODE_ENV: nodeEnv,
      [key]: value,
    })).rejects.toThrow('Invalid environment variables');

    expect(loggedValidationOutput()).toContain(key);
  });

  it.each(protectedRuntimes)('accepts non-mock credentials in %s', async (nodeEnv) => {
    const { env } = await importEnv({
      ...requiredCoreEnv,
      ...realIntegrationEnv,
      NODE_ENV: nodeEnv,
    });

    expect(env.NODE_ENV).toBe(nodeEnv);
    expect(env.GOOGLE_CLIENT_ID).toBe(realIntegrationEnv.GOOGLE_CLIENT_ID);
    expect(env.ASAAS_BASE_URL).toBe(realIntegrationEnv.ASAAS_BASE_URL);
  });

  it('rejects Asaas sandbox URL in production', async () => {
    await expect(importEnv({
      ...requiredCoreEnv,
      ...realIntegrationEnv,
      NODE_ENV: 'production',
      ASAAS_BASE_URL: 'https://sandbox.asaas.com/v3',
    })).rejects.toThrow('Invalid environment variables');

    expect(loggedValidationOutput()).toContain('ASAAS_BASE_URL');
  });

  it.each(['APP_URL', 'ADMIN_URL', 'LANDING_URL', 'API_URL', 'REDIS_URL'] as const)(
    'rejects localhost %s in production',
    async (key) => {
      await expect(importEnv({
        ...requiredCoreEnv,
        ...realIntegrationEnv,
        NODE_ENV: 'production',
        [key]: key === 'REDIS_URL' ? 'redis://localhost:6379' : 'http://localhost:3000',
      })).rejects.toThrow('Invalid environment variables');

      expect(loggedValidationOutput()).toContain(key);
    },
  );
});
