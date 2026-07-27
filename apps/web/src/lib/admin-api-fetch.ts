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

type AdminApiError = Error & {
  status?: number;
  response?: {
    status: number;
    data: unknown;
  };
};

async function parseAdminResponse(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = isJson && data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message || `HTTP ${res.status}`)
      : `HTTP ${res.status}: resposta inesperada do servidor`;
    const error = new Error(message) as AdminApiError;
    error.status = res.status;
    error.response = { status: res.status, data };
    throw error;
  }

  if (!isJson) {
    const error = new Error('Resposta inesperada do servidor: conteudo nao JSON.') as AdminApiError;
    error.status = res.status;
    error.response = { status: res.status, data };
    throw error;
  }

  return data;
}

/**
 * Admin API client with Axios-like convenience methods.
 * Usage: adminNextApi.get('/api/admin/users'), adminNextApi.post('/api/admin/users', body)
 */
export const adminNextApi = {
  async get(path: string) {
    const res = await baseFetch(path);
    return { data: await parseAdminResponse(res) };
  },
  async post(path: string, body?: unknown) {
    const res = await baseFetch(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data: await parseAdminResponse(res) };
  },
  async put(path: string, body?: unknown) {
    const res = await baseFetch(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data: await parseAdminResponse(res) };
  },
  async patch(path: string, body?: unknown) {
    const res = await baseFetch(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data: await parseAdminResponse(res) };
  },
  async delete(path: string) {
    const res = await baseFetch(path, { method: 'DELETE' });
    return { data: await parseAdminResponse(res) };
  },
};

/** Raw fetch alias for cases that need full Response control */
export const adminApiFetch = baseFetch;
