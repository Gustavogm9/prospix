import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, revokeSession, rotateSession } from '../../src/services/auth-service.js';
import { hashOpaqueToken } from '../../src/lib/crypto.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn((callback) => callback(prisma)),
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/lib/redis.js', () => ({
  redis: {
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

describe('auth session hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores only a hash of the refresh token and returns a separate access token id', async () => {
    vi.mocked(prisma.session.create).mockResolvedValue({ id: 'session-1' } as any);

    const session = await createSession({
      userId: 'user-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    const storedData = vi.mocked(prisma.session.create).mock.calls[0]?.[0].data;

    expect(session.refreshToken).toHaveLength(80);
    expect(session.accessTokenId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.accessTokenId).not.toBe(session.refreshToken);
    expect(storedData?.refreshToken).toBe(hashOpaqueToken(session.refreshToken));
    expect(storedData?.refreshToken).not.toBe(session.refreshToken);
  });

  it('rotates sessions by looking up the hashed refresh token and issuing a fresh access token id', async () => {
    const oldRefreshToken = 'old-refresh-token';

    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 'session-old',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as any);
    vi.mocked(prisma.session.update).mockResolvedValue({ id: 'session-old' } as any);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: 'session-new' } as any);

    const result = await rotateSession(oldRefreshToken, {
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(result.ok).toBe(true);
    expect(prisma.session.findUnique).toHaveBeenCalledWith({
      where: { refreshToken: hashOpaqueToken(oldRefreshToken) },
    });

    if (result.ok) {
      expect(result.value.refreshToken).toHaveLength(80);
      expect(result.value.accessTokenId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.value.accessTokenId).not.toBe(result.value.refreshToken);
    }
  });

  it('revokes by hashed refresh token and blacklists the active JWT jti separately', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
    } as any);
    vi.mocked(prisma.session.update).mockResolvedValue({ id: 'session-1' } as any);
    vi.mocked(redis.set).mockResolvedValue('OK');

    await revokeSession('refresh-token-value', 'access-token-jti');

    expect(prisma.session.findUnique).toHaveBeenCalledWith({
      where: { refreshToken: hashOpaqueToken('refresh-token-value') },
    });
    expect(redis.set).toHaveBeenCalledWith('revoked:access-token-jti', 'true', 'EX', 7 * 24 * 60 * 60);
  });
});
