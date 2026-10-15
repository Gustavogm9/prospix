'use client';

import { supabase } from './supabase';
import { useAuthStore } from '../store/auth-store';
import { fetchWithSessionRetry } from './authenticated-fetch';

/**
 * Lightweight fetch wrapper for Next.js API route handlers.
 * Automatically injects Authorization and X-Tenant-Id headers.
 * 
 * Usage:
 *   const res = await apiFetch('/api/integrations/credentials');
 *   const data = await res.json();
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const { tenantId } = useAuthStore.getState();
  return fetchWithSessionRetry(
    path,
    options,
    {
      getAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      },
      refreshAccessToken: async () => {
        const { data, error } = await supabase.auth.refreshSession();
        return error ? null : data.session?.access_token ?? null;
      },
      onUnauthorized: () => {
        if (path.includes('/auth/login')) return;
        useAuthStore.getState().clearSession();
        if (typeof window !== 'undefined') window.location.href = '/login';
      },
    },
    tenantId ? { 'X-Tenant-Id': tenantId } : {},
  );
}
