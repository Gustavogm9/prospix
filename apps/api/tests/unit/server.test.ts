import { describe, it, expect, vi, beforeEach } from 'vitest';

import { app } from '../../src/index.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    ping: vi.fn(),
    get: vi.fn(),
  },
}));

describe('Liveness & Readiness Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 200 on /health liveness check', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ok' });
  });

  it('should return 200 on /ready readiness check if all services are healthy', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([1]);
    vi.mocked(redis.ping).mockResolvedValue('PONG');

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      status: 'ready',
      checks: {
        db: 'ok',
        redis: 'ok',
      },
    });
  });

  it('should return 503 on /ready readiness check if a service is offline', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('DB connection timeout'));
    vi.mocked(redis.ping).mockResolvedValue('PONG');

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.payload).status).toBe('not_ready');
  });
});
