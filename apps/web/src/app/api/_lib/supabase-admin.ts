import { createClient, SupabaseClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Supabase Admin client — uses the service role key for elevated operations.
 * Only use in server-side API route handlers (never expose to the client).
 * Lazy-initialized to avoid build-time errors when env vars aren't available.
 */
let _supabaseAdmin: SupabaseClient | null = null;

function requiredServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Configuração obrigatória ausente: ${name}`);
  }
  return value;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const supabaseUrl =
      process.env.SUPABASE_URL?.trim() || requiredServerEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceRoleKey = requiredServerEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (serviceRoleKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY não pode ser igual à chave pública.');
    }

    _supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _supabaseAdmin;
}

/** @deprecated Use getSupabaseAdmin() — kept for backwards compatibility */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAdmin() as any)[prop];
  },
});

/**
 * Extract and verify the user from the Authorization header.
 * Returns { user, userId, tenantId } on success, or a NextResponse error.
 */
export type AuthenticatedRequest = {
  user: User;
  userId: string;
  tenantId: string;
  role: string;
};

export type AuthenticationResult =
  | AuthenticatedRequest
  | { error: NextResponse };

export async function authenticateRequest(request: NextRequest): Promise<AuthenticationResult> {
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
    .select('tenant_id, role, deleted_at')
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

  if (userData.deleted_at) {
    return {
      error: NextResponse.json(
        { error: 'Forbidden', message: 'User access is disabled' },
        { status: 403 },
      ),
    };
  }

  if (!userData.tenant_id && userData.role !== 'GUILDS_ADMIN') {
    return {
      error: NextResponse.json(
        { error: 'Forbidden', message: 'User has no active organization' },
        { status: 403 },
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
