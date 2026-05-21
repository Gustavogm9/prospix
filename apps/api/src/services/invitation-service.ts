import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { ResultHelper } from '../lib/result.js';
import { Result } from '@prospix/shared-types';
import { TenantInvitation } from '@prisma/client';
import { sendMagicLink } from './auth-service.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Readable alphanumeric (omitted 0, 1, I, O)

/**
 * Generates a secure, readable random code following regex: PRSPX-XXXX-XXXX
 */
export function generateInvitationCode(): string {
  const generateSegment = (length: number): string => {
    let result = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      const byte = randomBytes[i];
      if (byte !== undefined) {
        const char = ALPHABET[byte % ALPHABET.length];
        if (char !== undefined) {
          result += char;
        }
      }
    }
    return result;
  };

  return `PRSPX-${generateSegment(4)}-${generateSegment(4)}`;
}

/**
 * Creates an onboarding invitation code for a tenant.
 * Guarantees that only 1 active invitation exists per tenant at any time.
 */
export async function createInvitation(
  tenantId: string,
  createdById: string,
  notes?: string
): Promise<Result<TenantInvitation>> {
  try {
    // 1. Check if there's already an active (unconsumed & unrevoked & unexpired) invitation for the tenant
    const activeInvitation = await prisma.tenantInvitation.findFirst({
      where: {
        tenantId,
        usedAt: null,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (activeInvitation) {
      logger.warn({ tenantId }, '⚠️ Invitation: Tenant already has an active invitation code');
      return ResultHelper.failure({
        code: 'VALIDATION_ERROR',
        message: 'This tenant already has an active invitation code.',
      });
    }

    // 2. Generate a unique, compliant code
    let code = generateInvitationCode();
    
    // Safety check against collisions
    let collision = await prisma.tenantInvitation.findUnique({
      where: { code },
    });
    while (collision) {
      code = generateInvitationCode();
      collision = await prisma.tenantInvitation.findUnique({
        where: { code },
      });
    }

    // 3. Save to database
    const ttlDays = env.INVITATION_CODE_TTL_DAYS;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    const invitation = await prisma.tenantInvitation.create({
      data: {
        code,
        tenantId,
        role: 'OWNER',
        createdById,
        expiresAt,
        notes,
      },
    });

    logger.info({ tenantId, code }, '✨ Invitation code generated successfully');
    return ResultHelper.success(invitation);
  } catch (err) {
    logger.error({ err, tenantId }, '❌ Failed to create invitation code');
    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: 'Failed to create invitation due to a database error.',
    });
  }
}

/**
 * Revokes an existing active invitation.
 */
export async function revokeInvitation(
  id: string,
  tenantId: string
): Promise<Result<TenantInvitation>> {
  try {
    const invitation = await prisma.tenantInvitation.findFirst({
      where: { id, tenantId },
    });

    if (!invitation) {
      return ResultHelper.failure({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Invitation not found.',
      });
    }

    if (invitation.usedAt) {
      return ResultHelper.failure({
        code: 'VALIDATION_ERROR',
        message: 'Cannot revoke an invitation that has already been used.',
      });
    }

    const updated = await prisma.tenantInvitation.update({
      where: { id },
      data: {
        revokedAt: new Date(),
      },
    });

    logger.info({ id }, '🚫 Invitation code revoked successfully');
    return ResultHelper.success(updated);
  } catch (err) {
    logger.error({ err, id }, '❌ Failed to revoke invitation');
    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: 'Failed to revoke invitation due to a database error.',
    });
  }
}

/**
 * Verifies if an invitation code is valid.
 */
export async function verifyInvitation(
  code: string
): Promise<Result<{ tenantName: string; role: string }>> {
  try {
    const invitation = await prisma.tenantInvitation.findUnique({
      where: { code },
      include: { tenant: true },
    });

    if (!invitation) {
      return ResultHelper.failure({
        code: 'INVITATION_INVALID',
        message: 'Invalid invitation code.',
      });
    }

    if (invitation.revokedAt) {
      return ResultHelper.failure({
        code: 'INVITATION_INVALID',
        message: 'Invitation code has been revoked.',
      });
    }

    if (invitation.usedAt) {
      return ResultHelper.failure({
        code: 'INVITATION_ALREADY_USED',
        message: 'Invitation code has already been used.',
      });
    }

    if (invitation.expiresAt < new Date()) {
      return ResultHelper.failure({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation code has expired.',
      });
    }

    return ResultHelper.success({
      tenantName: invitation.tenant.name,
      role: invitation.role,
    });
  } catch (err) {
    logger.error({ err, code }, '❌ Failed to verify invitation');
    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: 'Failed to verify invitation due to a database error.',
    });
  }
}

/**
 * Redeems an invitation code, creating the user and sending a magic link.
 */
export async function redeemInvitation(
  code: string,
  userData: { name: string; email: string; whatsapp: string; susep?: string; city?: string }
): Promise<Result<{ userId: string; tenantId: string; magicLinkSent: boolean }>> {
  try {
    const verification = await verifyInvitation(code);
    if (!verification.ok) {
      return ResultHelper.failure(verification.error);
    }

    const invitation = await prisma.tenantInvitation.findUnique({
      where: { code },
    });

    if (!invitation) {
      return ResultHelper.failure({
        code: 'INVITATION_INVALID',
        message: 'Invalid invitation code.',
      });
    }

    // Atomic transaction: Create User, Update Tenant status, Update Invitation
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          role: invitation.role,
          name: userData.name,
          email: userData.email,
          whatsapp: userData.whatsapp,
          susep: userData.susep,
          city: userData.city,
        },
      });

      // 2. Update Invitation as used
      await tx.tenantInvitation.update({
        where: { id: invitation.id },
        data: {
          usedAt: new Date(),
          usedByUserId: user.id,
        },
      });

      // 3. Update Tenant status from ONBOARDING to ACTIVE
      await tx.tenant.update({
        where: { id: invitation.tenantId },
        data: {
          status: 'ACTIVE',
        },
      });

      return { userId: user.id, tenantId: invitation.tenantId };
    });

    // 4. Send Magic Link via WhatsApp
    const magicLinkRes = await sendMagicLink(userData.whatsapp);
    
    logger.info({ code, tenantId: result.tenantId, userId: result.userId }, '✨ Invitation redeemed successfully');

    return ResultHelper.success({
      userId: result.userId,
      tenantId: result.tenantId,
      magicLinkSent: magicLinkRes.ok,
    });
  } catch (err: any) {
    logger.error({ err, code }, '❌ Failed to redeem invitation');
    
    if (err.code === 'P2002' && err.meta?.target?.includes('email')) {
      return ResultHelper.failure({
        code: 'VALIDATION_ERROR',
        message: 'A user with this email is already registered.',
      });
    }

    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: 'Failed to redeem invitation due to a database error.',
    });
  }
}

