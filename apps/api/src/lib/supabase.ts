import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import type { Database } from './database.types.js';

// =============================================================================
// Supabase Client Factory
// =============================================================================
// Two clients:
// 1. supabaseAdmin — service_role key, bypasses RLS (for workers, auth ops, admin)
// 2. createSupabaseClient(jwt) — user-scoped client that respects RLS
// =============================================================================

/**
 * Admin client with service_role key.
 * ⚠️ Bypasses ALL RLS policies — use only in:
 *   - Workers (background jobs)
 *   - Auth endpoints (user creation, password reset)
 *   - Admin routes (GUILDS_ADMIN operations)
 *   - Seed scripts
 */
export const supabaseAdmin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

/**
 * Creates a user-scoped Supabase client that respects RLS.
 * The JWT carries tenant_id in app_metadata, which RLS policies read
 * via `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`.
 *
 * @param accessToken - The Supabase access token from the request
 */
export function createSupabaseClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

/**
 * Helper to get a typed Supabase client from a Fastify request.
 * Uses the Bearer token from the Authorization header.
 */
export function getSupabaseFromRequest(req: { headers: { authorization?: string } }): SupabaseClient<Database> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);
  return createSupabaseClient(token);
}
