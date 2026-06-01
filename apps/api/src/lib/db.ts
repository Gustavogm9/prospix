import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin, createSupabaseClient } from './supabase.js';
import type { Database } from './database.types.js';
import type { FastifyRequest } from 'fastify';

// =============================================================================
// DB Access Layer — Supabase
// =============================================================================
// Replaces direct Prisma client usage across all routes and services.
// Two modes:
//   1. getDb(req) — user-scoped client respecting RLS (for tenant routes)
//   2. dbAdmin    — service_role client bypassing RLS (for workers, admin, auth)
// =============================================================================

/** Service-role client that bypasses RLS. Use for workers, admin ops, auth. */
export const dbAdmin = supabaseAdmin;

/**
 * Returns a user-scoped Supabase client from a Fastify request.
 * The client's JWT carries tenant_id in app_metadata, so RLS policies
 * automatically filter rows to the correct tenant.
 */
export function getDb(req: FastifyRequest): SupabaseClient<Database> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing Authorization header — cannot create scoped DB client');
  }
  return createSupabaseClient(authHeader.slice(7));
}

// =============================================================================
// Query Helpers
// =============================================================================

/** Supabase query result with data or error */
type QueryResult<T> = { data: T; error: null } | { data: null; error: { message: string; code?: string } };

/**
 * Unwraps a Supabase query result, throwing on error.
 * Use for queries where failure is unexpected / should be a 500.
 */
export function unwrap<T>(result: QueryResult<T>, context?: string): T {
  if (result.error) {
    const msg = context ? `${context}: ${result.error.message}` : result.error.message;
    throw new Error(msg);
  }
  return result.data;
}

/**
 * Unwraps a single-row query, returning null if not found (PGRST116).
 * Use for `.single()` queries where not-found is expected.
 */
export function unwrapMaybe<T>(result: QueryResult<T>): T | null {
  if (result.error) {
    // PGRST116 = "The result contains 0 rows" — expected for .single()
    if (result.error.code === 'PGRST116') return null;
    throw new Error(result.error.message);
  }
  return result.data;
}

/**
 * Applies Prisma-style pagination to a Supabase query builder.
 * Converts `skip`/`take` to Supabase `.range()`.
 */
export function paginate<T extends { range: (from: number, to: number) => T }>(
  query: T,
  params: { skip?: number; take?: number },
): T {
  const skip = params.skip ?? 0;
  const take = params.take ?? 50;
  return query.range(skip, skip + take - 1);
}

/**
 * Builds a count query result.
 * Supabase returns count via `{ count }` option in select.
 */
export async function getCount(
  client: SupabaseClient<Database>,
  table: keyof Database['public']['Tables'],
  filter?: (q: any) => any,
): Promise<number> {
  let query = client.from(table).select('*', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) throw new Error(`Count query failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Soft-delete filter — adds `.is('deleted_at', null)` to exclude soft-deleted rows.
 * Many Prospix tables use soft-delete via `deleted_at` column.
 */
export function notDeleted<T extends { is: (column: string, value: null) => T }>(query: T): T {
  return query.is('deleted_at', null);
}
