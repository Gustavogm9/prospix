import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
}

interface AdminAuthState {
  adminToken: string | null;
  adminUser: AdminSession | null;
  setAdminSession: (token: string, user: AdminSession) => void;
  clearAdminSession: () => void;
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      adminToken: null,
      adminUser: null,
      setAdminSession: (adminToken, adminUser) =>
        set({
          adminToken,
          adminUser,
        }),
      clearAdminSession: () =>
        set({
          adminToken: null,
          adminUser: null,
        }),
    }),
    {
      name: 'prospix-admin-auth-storage',
    }
  )
);
