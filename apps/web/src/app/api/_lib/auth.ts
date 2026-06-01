import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, authenticateRequest } from './supabase-admin';

export { supabaseAdmin };

/**
 * Authenticate an admin request — verifies JWT and checks GUILDS_ADMIN role.
 * Returns { user, userId, adminId, tenantId, role } on success, or { error: NextResponse } on failure.
 */
export async function requireAdmin(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth;

  if (auth.role !== 'GUILDS_ADMIN') {
    return {
      error: NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required' },
        { status: 403 }
      ),
    };
  }

  return {
    ...auth,
    adminId: auth.userId,  // Alias for admin routes that use adminId
  };
}
