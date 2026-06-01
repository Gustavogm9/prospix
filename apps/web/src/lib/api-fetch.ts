'use client';

import { supabase } from './supabase';
import { useAuthStore } from '../store/auth-store';

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
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const { tenantId } = useAuthStore.getState();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (tenantId) {
    headers['X-Tenant-Id'] = tenantId;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  // Auto-redirect on 401 (session expired)
  if (
    response.status === 401 &&
    !path.includes('/auth/login')
  ) {
    const { clearSession } = useAuthStore.getState();
    clearSession();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  return response;
}
