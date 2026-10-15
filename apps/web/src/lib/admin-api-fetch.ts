'use client';

import { supabaseAdmin } from './supabase';
import { useAdminAuthStore } from '../store/admin-auth-store';
import { fetchWithSessionRetry } from './authenticated-fetch';

/**
 * Low-level fetch wrapper for admin Next.js API route handlers.
 * Automatically injects Authorization header from admin session.
 */
async function baseFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetchWithSessionRetry(path, options, {
    getAccessToken: async () => {
      const { data } = await supabaseAdmin.auth.getSession();
      return data.session?.access_token ?? null;
    },
    refreshAccessToken: async () => {
      const { data, error } = await supabaseAdmin.auth.refreshSession();
      return error ? null : data.session?.access_token ?? null;
    },
    onUnauthorized: () => {
      if (path.includes('/admin/login')) return;
      useAdminAuthStore.getState().clearAdminSession();
      if (typeof window !== 'undefined') window.location.href = '/admin/login';
    },
  });
}

export class AdminApiError extends Error {
  status?: number;
  response?: {
    status: number;
    data: any;
  };

  constructor(message: string, status?: number, data?: any) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    if (status !== undefined) this.response = { status, data };
  }
}

async function parseAdminResponse(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = isJson && data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message || `HTTP ${res.status}`)
      : `HTTP ${res.status}: resposta inesperada do servidor`;
    throw new AdminApiError(message, res.status, data);
  }

  if (!isJson) {
    throw new AdminApiError(
      'Resposta inesperada do servidor: conteúdo não JSON.',
      res.status,
      data,
    );
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
