import axios, { InternalAxiosRequestConfig } from 'axios';
import { useAdminAuthStore } from '../store/admin-auth-store';

const localApiBaseUrl = 'http://localhost:3000/v1';
const configuredApiBaseUrl = String(import.meta.env.VITE_API_URL ?? '').trim();

const isLocalApiUrl = (value: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);

if (import.meta.env.PROD) {
  if (!configuredApiBaseUrl) {
    throw new Error('VITE_API_URL is required for production builds.');
  }

  if (isLocalApiUrl(configuredApiBaseUrl)) {
    throw new Error('VITE_API_URL cannot point to localhost in production builds.');
  }
}

export const API_BASE_URL = configuredApiBaseUrl || localApiBaseUrl;

export const adminApiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

adminApiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { adminToken } = useAdminAuthStore.getState();

    if (adminToken) {
      config.headers.set('Authorization', `Bearer ${adminToken}`);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: handle 401 Unauthorized or 403 Forbidden to eject unauthorized users
adminApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      const { clearAdminSession } = useAdminAuthStore.getState();
      clearAdminSession();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
