import { createClient } from '@supabase/supabase-js';

const configuredSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const configuredSupabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

if (import.meta.env.PROD) {
  if (!configuredSupabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is required for production builds.');
  }

  if (!configuredSupabaseAnonKey) {
    throw new Error('VITE_SUPABASE_ANON_KEY is required for production builds.');
  }
}

const supabaseUrl = configuredSupabaseUrl || 'http://127.0.0.1:54321';
const supabaseAnonKey = configuredSupabaseAnonKey || 'local-dev-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
