import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, authenticateRequest } from './supabase-admin';
import type { AuthenticatedRequest } from './supabase-admin';

export { supabaseAdmin };

/**
 * Authenticate an admin request — verifies JWT and checks GUILDS_ADMIN role.
 * Returns { user, userId, adminId, tenantId, role } on success, or a
 * NextResponse that must be returned immediately by the route handler.
 */
export type AdminAuthContext = Omit<AuthenticatedRequest, 'role'> & {
  adminId: string;
  role: 'GUILDS_ADMIN';
};

export async function requireAdmin(
  request: NextRequest,
): Promise<AdminAuthContext | NextResponse> {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  if (auth.role !== 'GUILDS_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Admin access required' },
      { status: 403 }
    );
  }

  return {
    ...auth,
    role: 'GUILDS_ADMIN',
    adminId: auth.userId,  // Alias for admin routes that use adminId
  };
}
