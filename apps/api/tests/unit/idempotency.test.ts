import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { idempotencyPlugin } from '../../src/middlewares/idempotency.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';

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

describe('Idempotency Middleware', () => {
  let app: ReturnType<typeof fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = fastify();
    await app.register(idempotencyPlugin);
    
    // Test route
    app.post('/test', async (_req: any, _reply: any) => {
      return { success: true, timestamp: Date.now() };
    });
  });

  it('should pass straight through and NOT save cache if no idempotency key is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).success).toBe(true);
    // Verify no DB calls were made (no idempotency key)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('idempotency_keys');
  });

  it('should create pending record in database and then cache response when key is provided for the first time', async () => {
    const key = 'test-key-1';

    // Mock: lookup returns no existing key
    const lookupChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    // Mock: insert returns success
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };
    // Mock: update returns success
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
      ...lookupChain,
      ...insertChain,
      ...updateChain,
    }) as any);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-idempotency-key': key,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('idempotency_keys');
  });

  it('should return 409 Conflict if same key is sent concurrently (pending stage)', async () => {
    const key = 'test-key-concurrent';
    
    // Simulate pending (response_cache is null)
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          key,
          response_cache: null,
          status_code: null,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          key,
          response_cache: null,
          status_code: null,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        },
        error: null,
      }),
    }) as any);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-idempotency-key': key,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload).message).toContain('already in progress');
  });

  it('should return cached response if key exists and has completed responseCache', async () => {
    const key = 'test-key-completed';
    const mockCachedResponse = { cached: true, value: 42 };
    
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          key,
          response_cache: mockCachedResponse,
          status_code: 201,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          key,
          response_cache: mockCachedResponse,
          status_code: 201,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        },
        error: null,
      }),
    }) as any);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-idempotency-key': key,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['x-cache-lookup']).toBe('HIT - Idempotency');
    expect(JSON.parse(response.payload)).toEqual(mockCachedResponse);
  });
});
