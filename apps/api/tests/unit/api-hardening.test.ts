import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const allowedAppOrigin = 'https://app.prospix.test';
const allowedAdminOrigin = 'https://admin.prospix.test';
const allowedLandingOrigin = 'https://prospix.test';
const rejectedOrigin = 'https://evil.example';
const internalErrorMessage = 'database password leaked from connection string';

let importedApp: FastifyInstance | undefined;

const noopPlugin: FastifyPluginAsync = async () => {};
const throwingTenantRoutes: FastifyPluginAsync = async (app) => {
  app.get('/internal-error', async () => {
    throw new Error(internalErrorMessage);
  });
};

async function importAppForEnvironment(nodeEnv: 'development' | 'production') {
  process.env.NODE_ENV = 'test';
  vi.resetModules();

  vi.doMock('../../src/config/env.js', () => ({
    env: {
      NODE_ENV: nodeEnv,
      PORT: 3000,
      APP_URL: allowedAppOrigin,
      ADMIN_URL: allowedAdminOrigin,
      LANDING_URL: allowedLandingOrigin,
      JWT_PRIVATE_KEY: 'test-private-key',
      JWT_PUBLIC_KEY: 'test-public-key',
      JWT_EXPIRES_IN: '7d',
    },
  }));

  vi.doMock('@fastify/helmet', () => ({ default: noopPlugin }));
  vi.doMock('@fastify/jwt', () => ({ default: noopPlugin }));
  vi.doMock('@fastify/rate-limit', () => ({ default: noopPlugin }));

  vi.doMock('../../src/lib/logger.js', () => ({
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
  }));

  vi.doMock('../../src/lib/supabase.js', () => ({
    supabaseAdmin: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: [1], error: null }),
      })),
      rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
    },
  }));

  vi.doMock('../../src/lib/redis.js', () => ({
    redis: {
      ping: vi.fn().mockResolvedValue('PONG'),
    },
  }));

  vi.doMock('../../src/middlewares/idempotency.js', () => ({
    idempotencyPlugin: noopPlugin,
  }));

  vi.doMock('../../src/middlewares/tenant-context.js', () => ({
    tenantContext: vi.fn(async () => {}),
  }));

  vi.doMock('../../src/routes/auth/index.js', () => ({
    authRoutes: noopPlugin,
  }));

  vi.doMock('../../src/routes/admin/index.js', () => ({ adminRoutes: noopPlugin }));
  vi.doMock('../../src/routes/tenant/index.js', () => ({ tenantRoutes: throwingTenantRoutes }));
  vi.doMock('../../src/routes/webhooks/index.js', () => ({ webhookRoutes: noopPlugin }));
  vi.doMock('../../src/routes/webhooks/evolution.js', () => ({ evolutionWebhookRoutes: noopPlugin }));

  const module = await import('../../src/index.js');
  importedApp = module.app;
  await importedApp.ready();
  return importedApp;
}

afterEach(async () => {
  if (importedApp) {
    await importedApp.close();
    importedApp = undefined;
  }

  vi.clearAllMocks();
  vi.resetModules();
  vi.unmock('../../src/config/env.js');
});

describe('API hardening', () => {
  it('AUD-P1-006 does not leak internal error messages in production responses', async () => {
    const app = await importAppForEnvironment('production');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenant/internal-error',
    });

    const body = JSON.parse(response.payload);

    expect(response.statusCode).toBe(500);
    expect(body).toEqual({
      error: 'Internal Error',
      message: 'An unexpected error occurred. Please contact support.',
    });
    expect(response.payload).not.toContain(internalErrorMessage);
  });

  it('AUD-P1-005 allows only configured origins in production CORS', async () => {
    const app = await importAppForEnvironment('production');

    const allowedResponse = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: allowedAppOrigin,
        'access-control-request-method': 'GET',
      },
    });

    const rejectedResponse = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: rejectedOrigin,
        'access-control-request-method': 'GET',
      },
    });

    expect(allowedResponse.statusCode).toBe(204);
    expect(allowedResponse.headers['access-control-allow-origin']).toBe(allowedAppOrigin);
    expect(rejectedResponse.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('AUD-P1-005 keeps development CORS behavior permissive for local clients', async () => {
    const app = await importAppForEnvironment('development');

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: rejectedOrigin,
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});
