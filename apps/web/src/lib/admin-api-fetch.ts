'use client';

import { supabaseAdmin } from './supabase';
import { useAdminAuthStore } from '../store/admin-auth-store';

/**
 * Low-level fetch wrapper for admin Next.js API route handlers.
 * Automatically injects Authorization header from admin session.
 */
async function baseFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const { data } = await supabaseAdmin.auth.getSession();
  const accessToken = data.session?.access_token;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 401 && !path.includes('/admin/login')) {
    const { clearAdminSession } = useAdminAuthStore.getState();
    clearAdminSession();
    if (typeof window !== 'undefined') {
      window.location.href = '/admin/login';
    }
  }

  return response;
}

/**
 * Admin API client with Axios-like convenience methods.
 * Usage: adminNextApi.get('/api/admin/users'), adminNextApi.post('/api/admin/users', body)
 */
export const adminNextApi = {
  async get(path: string) {
    const res = await baseFetch(path);
    return { data: await res.json() };
  },
  async post(path: string, body?: unknown) {
    const res = await baseFetch(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data: await res.json() };
  },
  async put(path: string, body?: unknown) {
    const res = await baseFetch(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data: await res.json() };
  },
  async patch(path: string, body?: unknown) {
    const res = await baseFetch(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data: await res.json() };
  },
  async delete(path: string) {
    const res = await baseFetch(path, { method: 'DELETE' });
    return { data: await res.json() };
  },
};

/** Raw fetch alias for cases that need full Response control */
export const adminApiFetch = baseFetch;
