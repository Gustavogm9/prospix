import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth-store';

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

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: inject Authorization and X-Tenant-Id headers
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken, tenantId } = useAuthStore.getState();

    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`);
    }

    if (tenantId) {
      config.headers.set('X-Tenant-Id', tenantId);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Keep track of refresh token promises to prevent duplicate requests
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response Interceptor: handle token refresh on 401 Unauthorized
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If it's a 401 and we haven't retried yet, and it's not a login/refresh request itself
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      originalRequest.url &&
      !originalRequest.url.includes('/auth/magic-link') &&
      !originalRequest.url.includes('/auth/callback') &&
      !originalRequest.url.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.set('Authorization', `Bearer ${token}`);
            return apiClient(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const { refreshToken, updateToken, clearSession } = useAuthStore.getState();

      if (!refreshToken) {
        clearSession();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token } = response.data;
        updateToken(access_token, refresh_token);

        processQueue(null, access_token);
        originalRequest.headers.set('Authorization', `Bearer ${access_token}`);
        
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearSession();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
