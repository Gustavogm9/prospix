import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Supabase Admin client — uses the service role key for elevated operations.
 * Only use in server-side API route handlers (never expose to the client).
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Extract and verify the user from the Authorization header.
 * Returns { user, userId, tenantId } on success, or a NextResponse error.
 */
export async function authenticateRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized', message: 'Missing or invalid Authorization header' },
        { status: 401 }
      ),
    };
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      ),
    };
  }

  // Get user's tenant_id
  const { data: userData, error: userError } = await supabaseAdmin
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (userError || !userData) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized', message: 'User not found' },
        { status: 401 }
      ),
    };
  }

  return {
    user,
    userId: user.id,
    tenantId: userData.tenant_id as string,
    role: userData.role as string,
  };
}
