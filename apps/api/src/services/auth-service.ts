import crypto from 'crypto';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { ResultHelper } from '../lib/result.js';
import { Result } from '@prospix/shared-types';

// =============================================================================
// Auth Service — Supabase Auth
// =============================================================================
// Replaces custom JWT (RS256) + session table + Redis blacklisting.
// Supabase manages sessions, tokens, and password hashing (bcrypt) natively.
// =============================================================================

/**
 * Normalizes a WhatsApp number to a clean, digit-only format.
 * (e.g., "+55 (17) 99999-0001" becomes "5517999990001")
 */
export function normalizeWhatsappNumber(whatsapp: string): string {
  return whatsapp.replace(/\D/g, '');
}

/**
 * Generates a magic link token, saves it in Redis, and sends a WhatsApp message via Evolution API.
 * NOTE: Magic link via WhatsApp is disabled for now (user decision).
 * This function is kept for potential future re-enablement.
 */
export async function sendMagicLink(whatsapp: string): Promise<Result<{ expires_in: number }>> {
  const normalizedNumber = normalizeWhatsappNumber(whatsapp);
  if (!normalizedNumber) {
    return ResultHelper.failure({
      code: 'VALIDATION_ERROR',
      message: 'Invalid WhatsApp number format',
    });
  }

  // Check if Evolution API is configured for WhatsApp sending
  if (!env.EVOLUTION_GUILDS_API_KEY) {
    logger.warn({ whatsapp: normalizedNumber }, '🔑 Magic Link: Evolution API not configured, cannot send WhatsApp');
    return ResultHelper.failure({
      code: 'SERVICE_NOT_CONFIGURED',
      message: 'WhatsApp gateway is not configured. Please use email/password login or contact support.',
    });
  }

  // 1. Verify if user exists using Supabase admin (bypasses RLS)
  const { data: users, error: lookupError } = await supabaseAdmin
    .from('users')
    .select('id, name, whatsapp')
    .ilike('whatsapp', `%${normalizedNumber}%`)
    .limit(1);

  if (lookupError || !users || users.length === 0) {
    logger.warn({ whatsapp: normalizedNumber }, '🔑 Magic Link: User not found');
    return ResultHelper.failure({
      code: 'UNAUTHORIZED',
      message: 'No user registered with this WhatsApp number',
    });
  }

  const user = users[0];
  if (!user) {
    logger.warn({ whatsapp: normalizedNumber }, '🔑 Magic Link: User not found');
    return ResultHelper.failure({
      code: 'UNAUTHORIZED',
      message: 'No user registered with this WhatsApp number',
    });
  }

  // 2. Generate secure token
  const token = crypto.randomUUID();
  const redisKey = `magic:${token}`;
  const ttl = env.MAGIC_LINK_TTL_SECONDS; // 10 minutes

  await redis.set(redisKey, user.id, 'EX', ttl);

  // 3. Send message via Evolution API
  const magicLink = `${env.APP_URL}/auth/callback?token=${token}`;
  const messageText = `Olá ${user.name}! Clique no link para entrar no Prospix: ${magicLink}\n\nEste link é de uso único e expira em 10 minutos.`;

  logger.info({ userId: user.id, whatsapp: normalizedNumber }, '🔑 Magic Link token generated');

  try {
    const url = `${env.EVOLUTION_BASE_URL}/message/sendText/${env.EVOLUTION_GUILDS_INSTANCE}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.EVOLUTION_GUILDS_API_KEY,
      },
      body: JSON.stringify({
        number: normalizedNumber,
        text: messageText,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      logger.error(
        { status: response.status, body: responseText },
        '❌ Evolution API failed to send Magic Link'
      );
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: 'Failed to send WhatsApp message. Please try again later.',
      });
    }

    logger.info({ userId: user.id }, '📬 Magic Link sent successfully via WhatsApp');
    return ResultHelper.success({ expires_in: ttl });
  } catch (err) {
    logger.error({ err }, '❌ Network error connecting to Evolution API');
    return ResultHelper.failure({
      code: 'EXTERNAL_SERVICE_DOWN',
      message: 'Failed to send WhatsApp message due to a connection error.',
    });
  }
}

/**
 * Validates the magic link token, consumes it (single-use), and resolves user information.
 */
export async function validateMagicLink(
  token: string
): Promise<Result<{ user_id: string; tenant_id: string | null }>> {
  const redisKey = `magic:${token}`;

  // 1. Fetch user ID from Redis
  const userId = await redis.get(redisKey);
  if (!userId) {
    logger.warn({ token }, '🔑 Magic Link: Token invalid or expired');
    return ResultHelper.failure({
      code: 'INVITATION_INVALID',
      message: 'Invalid or expired magic link token',
    });
  }

  // 2. Consume token (single-use rule)
  await redis.del(redisKey);

  // 3. Resolve user details using Supabase admin
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, tenant_id')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return ResultHelper.failure({
      code: 'RESOURCE_NOT_FOUND',
      message: 'User no longer exists',
    });
  }

  logger.info({ userId: user.id, tenantId: user.tenant_id }, '🔑 Magic Link token validated successfully');

  return ResultHelper.success({
    user_id: user.id,
    tenant_id: user.tenant_id,
  });
}

/**
 * Signs in a user via Supabase Auth (email/password).
 * Returns Supabase session tokens.
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<Result<{
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: number;
}>> {
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    logger.warn({ email, error: error?.message }, '🔑 Sign-in failed');
    return ResultHelper.failure({
      code: 'UNAUTHORIZED',
      message: error?.message || 'Invalid credentials',
    });
  }

  return ResultHelper.success({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    userId: data.user.id,
    expiresAt: data.session.expires_at ?? 0,
  });
}

/**
 * Signs out a user from Supabase Auth.
 * Supabase handles session invalidation natively — no Redis blacklisting needed.
 */
export async function signOut(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.signOut(userId);
  if (error) {
    logger.warn({ userId, error: error.message }, '🔑 Sign-out error (non-fatal)');
  }
}

/**
 * Changes a user's password in Supabase Auth.
 */
export async function changePassword(userId: string, newPassword: string): Promise<Result<void>> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (error) {
    logger.error({ userId, error: error.message }, '❌ Password change failed');
    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: 'Failed to change password',
    });
  }

  return ResultHelper.success(undefined);
}

/**
 * Creates a user in Supabase Auth with app_metadata for role and tenant.
 * Used during invitation redemption.
 */
export async function createAuthUser(params: {
  email: string;
  password: string;
  tenantId: string;
  role: string;
  name: string;
}): Promise<Result<{ authUserId: string }>> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true, // Skip email verification (invitation-based signup)
    app_metadata: {
      tenant_id: params.tenantId,
      role: params.role,
    },
    user_metadata: {
      name: params.name,
    },
  });

  if (error) {
    logger.error({ email: params.email, error: error.message }, '❌ Failed to create auth user');
    return ResultHelper.failure({
      code: 'VALIDATION_ERROR',
      message: error.message.includes('already registered')
        ? 'Email already registered'
        : error.message,
    });
  }

  return ResultHelper.success({ authUserId: data.user.id });
}
