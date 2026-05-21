import axios, { InternalAxiosRequestConfig } from 'axios';
import { useAdminAuthStore } from '../store/admin-auth-store';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/v1';

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

