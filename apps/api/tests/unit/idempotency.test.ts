import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { idempotencyPlugin } from '../../src/middlewares/idempotency.js';
import { prisma } from '../../src/lib/prisma.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    idempotencyKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

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
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('should create pending record in database and then cache response when key is provided for the first time', async () => {
    const key = 'test-key-1';
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.idempotencyKey.create).mockResolvedValue({} as any);
    vi.mocked(prisma.idempotencyKey.update).mockResolvedValue({} as any);

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      headers: {
        'x-idempotency-key': key,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.idempotencyKey.findUnique).toHaveBeenCalledWith({ where: { key } });
    expect(prisma.idempotencyKey.create).toHaveBeenCalled();
    expect(prisma.idempotencyKey.update).toHaveBeenCalled();
  });

  it('should return 409 Conflict if same key is sent concurrently (pending stage)', async () => {
    const key = 'test-key-concurrent';
    
    // Simulate pending (responseCache is null)
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue({
      key,
      responseCache: null,
      statusCode: null,
      expiresAt: new Date(Date.now() + 100000),
    } as any);

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
    
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue({
      key,
      responseCache: mockCachedResponse,
      statusCode: 201,
      expiresAt: new Date(Date.now() + 100000),
    } as any);

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
    
    // Request handler should be bypassed entirely
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });
});
