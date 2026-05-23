import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

let importedApp: FastifyInstance | undefined;

const noopPlugin: FastifyPluginAsync = async () => {};

async function importAppWithMockedAuthRoutes() {
  process.env.NODE_ENV = 'test';
  vi.resetModules();

  const tenantContextMock = vi.fn(async () => {});

  const authRoutes: FastifyPluginAsync = async (app) => {
    app.post('/magic-link', async (_request, reply) => {
      return reply.code(202).send({ route: 'magic-link' });
    });

    app.post('/refresh', async (_request, reply) => {
      return reply.code(401).send({ route: 'refresh', error: 'INVALID_REFRESH_TOKEN' });
    });
  };

  vi.doMock('../../src/config/env.js', () => ({
    env: {
      NODE_ENV: 'test',
      PORT: 3000,
      APP_URL: 'https://app.prospix.test',
      ADMIN_URL: 'https://admin.prospix.test',
      LANDING_URL: 'https://prospix.test',
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

  vi.doMock('../../src/lib/prisma.js', () => ({
    prisma: {
      $queryRaw: vi.fn().mockResolvedValue([1]),
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
    tenantContext: tenantContextMock,
  }));

  vi.doMock('../../src/routes/auth/index.js', () => ({ authRoutes }));
  vi.doMock('../../src/routes/admin/index.js', () => ({ adminRoutes: noopPlugin }));
  vi.doMock('../../src/routes/tenant/index.js', () => ({ tenantRoutes: noopPlugin }));
  vi.doMock('../../src/routes/webhooks/index.js', () => ({ webhookRoutes: noopPlugin }));
  vi.doMock('../../src/routes/webhooks/evolution.js', () => ({ evolutionWebhookRoutes: noopPlugin }));

  const module = await import('../../src/index.js');
  importedApp = module.app;
  await importedApp.ready();

  return { app: importedApp, tenantContextMock };
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

describe('AUD-P0-011 versioned auth routes', () => {
  it('mounts POST /v1/auth/magic-link without falling through to 404 or tenant auth', async () => {
    const { app, tenantContextMock } = await importAppWithMockedAuthRoutes();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: {
        whatsapp: '+5511999999999',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.payload)).toEqual({ route: 'magic-link' });
    expect(tenantContextMock).not.toHaveBeenCalled();
  });

  it('mounts POST /v1/auth/refresh and preserves legacy /auth/magic-link compatibility', async () => {
    const { app, tenantContextMock } = await importAppWithMockedAuthRoutes();

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {
        refresh_token: 'expired-refresh-token',
      },
    });

    expect(refreshResponse.statusCode).toBe(401);
    expect(JSON.parse(refreshResponse.payload)).toEqual({
      route: 'refresh',
      error: 'INVALID_REFRESH_TOKEN',
    });

    const legacyResponse = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: {
        whatsapp: '+5511999999999',
      },
    });

    expect(legacyResponse.statusCode).toBe(202);
    expect(JSON.parse(legacyResponse.payload)).toEqual({ route: 'magic-link' });
    expect(tenantContextMock).toHaveBeenCalledTimes(1);
  });
});
