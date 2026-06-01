'use client';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// During Next.js build/prerender, env vars may not be available.
// Use dummy values to avoid crashing the build — the client won't
// make real requests during SSR anyway.
const DUMMY_URL = 'https://placeholder.supabase.co';
const DUMMY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.placeholder';

const resolvedUrl = supabaseUrl || DUMMY_URL;
const resolvedKey = supabaseAnonKey || DUMMY_KEY;

/**
 * Supabase client for the Web/Dashboard app.
 * Uses localStorage to match Zustand's default persist strategy.
 */
export const supabase = createClient(resolvedUrl, resolvedKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'prospix-supabase-auth',
    detectSessionInUrl: false,
  },
});

/**
 * Supabase client for Admin sessions.
 * Uses sessionStorage so closing the tab = logout.
 */
export const supabaseAdmin = createClient(resolvedUrl, resolvedKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
    storageKey: 'prospix-admin-supabase-auth',
    detectSessionInUrl: false,
  },
});
