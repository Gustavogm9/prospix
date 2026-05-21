import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserSession {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ASSISTANT' | 'ADMIN';
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tenantId: string | null;
  user: UserSession | null;
  setSession: (accessToken: string, refreshToken: string, user: UserSession) => void;
  updateToken: (accessToken: string, refreshToken: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      tenantId: null,
      user: null,
      setSession: (accessToken, refreshToken, user) =>
        set({
          accessToken,
          refreshToken,
          tenantId: user.tenant_id,
          user,
        }),
      updateToken: (accessToken, refreshToken) =>
        set({
          accessToken,
          refreshToken,
        }),
      clearSession: () =>
        set({
          accessToken: null,
          refreshToken: null,
          tenantId: null,
          user: null,
        }),
    }),
    {
      name: 'prospix-auth-storage',
    }
  )
);
