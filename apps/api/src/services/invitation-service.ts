import crypto from 'crypto';
import { dbAdmin } from '../lib/db.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { ResultHelper } from '../lib/result.js';
import { Result } from '@prospix/shared-types';
import { sendMagicLink } from './auth-service.js';
import { hashPassword } from '../lib/crypto.js';

// TenantInvitation type alias (not exported from shared-types)
type TenantInvitation = Record<string, any>;

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
    const { data: activeInvitation } = await dbAdmin
      .from('tenant_invitations')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .single();

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
    const { data: collision } = await dbAdmin
      .from('tenant_invitations')
      .select('id')
      .eq('code', code)
      .single();

    while (collision) {
      code = generateInvitationCode();
      const { data: nextCollision } = await dbAdmin
        .from('tenant_invitations')
        .select('id')
        .eq('code', code)
        .single();
      if (!nextCollision) break;
    }

    // 3. Save to database
    const ttlDays = env.INVITATION_CODE_TTL_DAYS;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    const { data: invitation, error: createErr } = await dbAdmin
      .from('tenant_invitations')
      .insert({
        code,
        tenant_id: tenantId,
        role: 'OWNER',
        created_by_id: createdById,
        expires_at: expiresAt.toISOString(),
        notes,
      } as any)
      .select()
      .single();

    if (createErr) throw createErr;

    logger.info({ tenantId, code }, '✨ Invitation code generated successfully');
    return ResultHelper.success(invitation as unknown as TenantInvitation);
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
    const { data: invitation } = await dbAdmin
      .from('tenant_invitations')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .limit(1)
      .single();

    if (!invitation) {
      return ResultHelper.failure({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Invitation not found.',
      });
    }

    if (invitation.used_at) {
      return ResultHelper.failure({
        code: 'VALIDATION_ERROR',
        message: 'Cannot revoke an invitation that has already been used.',
      });
    }

    const { data: updated, error: updateErr } = await dbAdmin
      .from('tenant_invitations')
      .update({
        revoked_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    logger.info({ id }, '🚫 Invitation code revoked successfully');
    return ResultHelper.success(updated as unknown as TenantInvitation);
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
    const { data: invitation } = await dbAdmin
      .from('tenant_invitations')
      .select('*, tenants(name)')
      .eq('code', code)
      .single();

    if (!invitation) {
      return ResultHelper.failure({
        code: 'INVITATION_INVALID',
        message: 'Invalid invitation code.',
      });
    }

    if (invitation.revoked_at) {
      return ResultHelper.failure({
        code: 'INVITATION_INVALID',
        message: 'Invitation code has been revoked.',
      });
    }

    if (invitation.used_at) {
      return ResultHelper.failure({
        code: 'INVITATION_ALREADY_USED',
        message: 'Invitation code has already been used.',
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return ResultHelper.failure({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation code has expired.',
      });
    }

    return ResultHelper.success({
      tenantName: (invitation.tenants as any)?.name || '',
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
 * Redeems an invitation code, creating the user and optional password, and conditionally sending a magic link.
 */
export async function redeemInvitation(
  code: string,
  userData: { name: string; email: string; whatsapp: string; susep?: string; city?: string; password?: string }
): Promise<Result<{ userId: string; tenantId: string; magicLinkSent: boolean }>> {
  try {
    const verification = await verifyInvitation(code);
    if (!verification.ok) {
      return ResultHelper.failure(verification.error);
    }

    const { data: invitation } = await dbAdmin
      .from('tenant_invitations')
      .select('*')
      .eq('code', code)
      .single();

    if (!invitation) {
      return ResultHelper.failure({
        code: 'INVITATION_INVALID',
        message: 'Invalid invitation code.',
      });
    }

    // Sequential operations (replacing $transaction)
    // 1. Create User
    const { data: user, error: userErr } = await dbAdmin
      .from('users')
      .insert({
        tenant_id: invitation.tenant_id,
        role: invitation.role,
        name: userData.name,
        email: userData.email,
        whatsapp: userData.whatsapp,
        susep: userData.susep,
        city: userData.city,
        password_hash: userData.password ? hashPassword(userData.password) : undefined,
      } as any)
      .select()
      .single();

    if (userErr) throw userErr;

    // 2. Update Invitation as used
    const { error: invErr } = await dbAdmin
      .from('tenant_invitations')
      .update({
        used_at: new Date().toISOString(),
        used_by_user_id: user.id,
      })
      .eq('id', invitation.id);
    if (invErr) throw invErr;

    // 3. Update Tenant status from ONBOARDING to ACTIVE
    const { error: tenantErr } = await dbAdmin
      .from('tenants')
      .update({
        status: 'ACTIVE',
      })
      .eq('id', invitation.tenant_id);
    if (tenantErr) throw tenantErr;

    // 4. Send Magic Link via WhatsApp (only if password not provided for backwards-compatibility)
    let magicLinkSent = false;
    if (!userData.password) {
      const magicLinkRes = await sendMagicLink(userData.whatsapp);
      magicLinkSent = magicLinkRes.ok;
    }
    
    logger.info({ code, tenantId: invitation.tenant_id, userId: user.id }, '✨ Invitation redeemed successfully');

    return ResultHelper.success({
      userId: user.id,
      tenantId: invitation.tenant_id,
      magicLinkSent,
    });
  } catch (err: any) {
    logger.error({ err, code }, '❌ Failed to redeem invitation');
    
    // Supabase unique violation code is 23505
    if (err.code === '23505' && err.message?.includes('email')) {
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
