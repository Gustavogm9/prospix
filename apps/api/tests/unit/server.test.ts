import { describe, it, expect, vi, beforeEach } from 'vitest';

import { app } from '../../src/index.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';
import { redis } from '../../src/lib/redis.js';

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
      rpc: vi.fn().mockResolvedValue({ data: [1], error: null }),
    },
  };
});

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
    // Mock supabase health check (rpc or from)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [1], error: null } as any);
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
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: 'DB connection timeout' } } as any);
    vi.mocked(redis.ping).mockResolvedValue('PONG');

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.payload).status).toBe('not_ready');
  });
});
