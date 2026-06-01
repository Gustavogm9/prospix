'use client';

import axios, { InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth-store';
import { supabase } from './supabase';

const localApiBaseUrl = 'http://localhost:3000/v1';
const configuredApiBaseUrl = String(process.env.NEXT_PUBLIC_API_URL ?? '').trim();

const isLocalApiUrl = (value: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  if (!configuredApiBaseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is required for production builds.');
  }
  if (isLocalApiUrl(configuredApiBaseUrl)) {
    throw new Error('NEXT_PUBLIC_API_URL cannot point to localhost in production builds.');
  }
}

export const API_BASE_URL = configuredApiBaseUrl || localApiBaseUrl;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`);
    }
    const { tenantId } = useAuthStore.getState();
    if (tenantId) {
      config.headers.set('X-Tenant-Id', tenantId);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      error.config?.url &&
      !error.config.url.includes('/auth/login')
    ) {
      const { clearSession } = useAuthStore.getState();
      clearSession();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
