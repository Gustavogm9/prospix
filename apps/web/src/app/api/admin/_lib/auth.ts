import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Shared Supabase admin client for all API route handlers.
 * Uses the service role key for unrestricted server-side access.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Verifies the caller is an authenticated GUILDS_ADMIN user.
 * Returns the admin user ID on success, or a NextResponse error.
 */
export async function requireAdmin(
  request: NextRequest,
): Promise<{ adminId: string } | NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Missing Authorization header.' },
      { status: 401 },
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or expired token.' },
      { status: 401 },
    );
  }

  // Verify GUILDS_ADMIN role in the users table
  const { data: userData } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (userData?.role !== 'GUILDS_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Requires GUILDS_ADMIN role.' },
      { status: 403 },
    );
  }

  return { adminId: user.id };
}
