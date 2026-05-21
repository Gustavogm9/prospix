import crypto from 'crypto';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { ResultHelper } from '../lib/result.js';
import { Result } from '@prospix/shared-types';

/**
 * Normalizes a WhatsApp number to a clean, digit-only format.
 * (e.g., "+55 (17) 99999-0001" becomes "5517999990001")
 */
export function normalizeWhatsappNumber(whatsapp: string): string {
  return whatsapp.replace(/\D/g, '');
}

/**
 * Generates a magic link token, saves it in Redis, and sends a WhatsApp message via Evolution API.
 */
export async function sendMagicLink(whatsapp: string): Promise<Result<{ expires_in: number }>> {
  const normalizedNumber = normalizeWhatsappNumber(whatsapp);
  if (!normalizedNumber) {
    return ResultHelper.failure({
      code: 'VALIDATION_ERROR',
      message: 'Invalid WhatsApp number format',
    });
  }

  // 1. Verify if user exists
  // Since this is auth, we query without tenant context (admin bypass or global query)
  const user = await prisma.user.findFirst({
    where: {
      whatsapp: {
        contains: normalizedNumber, // match partially to tolerate country code variations
      },
    },
  });

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

  // 3. Resolve user details
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true },
  });

  if (!user) {
    return ResultHelper.failure({
      code: 'RESOURCE_NOT_FOUND',
      message: 'User no longer exists',
    });
  }

  logger.info({ userId: user.id, tenantId: user.tenantId }, '🔑 Magic Link token validated successfully');
  
  return ResultHelper.success({
    user_id: user.id,
    tenant_id: user.tenantId,
  });
}

/**
 * Creates a new session in the database for the user.
 */
export async function createSession(params: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ refreshToken: string; expiresAt: Date }> {
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days standard

  await prisma.session.create({
    data: {
      userId: params.userId,
      refreshToken,
      expiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
  });

  return { refreshToken, expiresAt };
}

/**
 * Rotates a refresh token: revokes the old session and issues a new one.
 */
export async function rotateSession(
  oldRefreshToken: string,
  params: { ipAddress?: string; userAgent?: string }
): Promise<Result<{ userId: string; refreshToken: string; expiresAt: Date }>> {
  const session = await prisma.session.findUnique({
    where: { refreshToken: oldRefreshToken },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    logger.warn({ oldRefreshToken }, '🔑 Session refresh: Invalid or revoked refresh token');
    return ResultHelper.failure({
      code: 'UNAUTHORIZED',
      message: 'Invalid, revoked or expired session',
    });
  }

  // Revoke old session
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  // Issue new session
  const newSession = await createSession({
    userId: session.userId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return ResultHelper.success({
    userId: session.userId,
    refreshToken: newSession.refreshToken,
    expiresAt: newSession.expiresAt,
  });
}

/**
 * Revokes a session, optionally revoking all user sessions.
 */
export async function revokeSession(refreshToken: string, jti?: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { refreshToken },
  });

  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  // Blacklist the active JWT jti in Redis for instant invalidation
  if (jti) {
    await redis.set(`revoked:${jti}`, 'true', 'EX', 7 * 24 * 60 * 60); // 7 days matching JWT expiration
  }
}
