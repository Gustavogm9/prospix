'use client';

import { supabaseAdmin } from './supabase';
import { useAdminAuthStore } from '../store/admin-auth-store';

/**
 * Lightweight fetch wrapper for admin Next.js API route handlers.
 * Automatically injects Authorization header from admin session.
 */
export async function adminApiFetch(
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
