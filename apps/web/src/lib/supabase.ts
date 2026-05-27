/**
 * @deprecated Supabase Realtime has been replaced by SSE via Redis pub/sub.
 * This file is kept for backward compatibility but is no longer used.
 * See: hooks/useRealtimeEvents.ts for the SSE-based replacement.
 */
import { createClient } from '@supabase/supabase-js';

const configuredSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const configuredSupabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

// No longer throw in production — Supabase is optional now
const supabaseUrl = configuredSupabaseUrl || 'http://127.0.0.1:54321';
const supabaseAnonKey = configuredSupabaseAnonKey || 'local-dev-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
