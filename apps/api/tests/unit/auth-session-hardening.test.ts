/**
 * Auth session hardening unit tests — Supabase Auth.
 *
 * The old tests for createSession/rotateSession/revokeSession
 * have been replaced. Those functions no longer exist — Supabase
 * Auth handles session management natively.
 *
 * These tests verify the new Supabase Auth wrapper functions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Supabase client
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockUpdateUserById = vi.fn();
const mockGetUser = vi.fn();

vi.mock('../../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
      getUser: (...args: any[]) => mockGetUser(...args),
      admin: {
        signOut: (...args: any[]) => mockSignOut(...args),
        updateUserById: (...args: any[]) => mockUpdateUserById(...args),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { signInWithPassword, signOut, changePassword } from '../../src/services/auth-service.js';

describe('auth Supabase integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signInWithPassword returns tokens on success', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
        user: { id: 'user-1' },
      },
      error: null,
    });

    const result = await signInWithPassword('test@example.com', 'password');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accessToken).toBe('test-access-token');
      expect(result.value.refreshToken).toBe('test-refresh-token');
      expect(result.value.userId).toBe('user-1');
    }

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password',
    });
  });

  it('signInWithPassword returns failure on invalid credentials', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Invalid login credentials' },
    });

    const result = await signInWithPassword('bad@example.com', 'wrong');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('signOut calls supabase admin signOut with user ID', async () => {
    mockSignOut.mockResolvedValue({ error: null });

    await signOut('user-1');

    expect(mockSignOut).toHaveBeenCalledWith('user-1');
  });

  it('changePassword updates password via supabase admin', async () => {
    mockUpdateUserById.mockResolvedValue({ data: { user: {} }, error: null });

    const result = await changePassword('user-1', 'new-password');

    expect(result.ok).toBe(true);
    expect(mockUpdateUserById).toHaveBeenCalledWith('user-1', {
      password: 'new-password',
    });
  });

  it('changePassword returns failure on supabase error', async () => {
    mockUpdateUserById.mockResolvedValue({
      data: null,
      error: { message: 'Password too weak' },
    });

    const result = await changePassword('user-1', 'weak');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });
});
