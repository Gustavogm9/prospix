import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabaseAdmin as supabase } from '../lib/supabase';

interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'GUILDS_ADMIN';
}

interface AdminAuthState {
  adminUser: AdminSession | null;
  /** Whether the Supabase session has been checked at least once */
  initialized: boolean;
  setAdminSession: (user: AdminSession) => void;
  clearAdminSession: () => void;
  setInitialized: (value: boolean) => void;
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      adminUser: null,
      initialized: false,
      setAdminSession: (adminUser) =>
        set({
          adminUser,
        }),
      clearAdminSession: () => {
        // Sign out from Supabase (fire-and-forget; don't block the UI)
        supabase.auth.signOut().catch(() => {});
        set({
          adminUser: null,
          initialized: false,
        });
      },
      setInitialized: (value) => set({ initialized: value }),
    }),
    {
      name: 'prospix-admin-auth-storage',
      // Keep sessionStorage for admin (closing tab = logout)
      storage: {
        getItem: (name) => {
          const value = sessionStorage.getItem(name);
          return value ? JSON.parse(value) : null;
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name);
        },
      },
      // Only persist user-level metadata; the token lives in the Supabase session
      partialize: (state) => ({
        adminUser: state.adminUser,
      }) as AdminAuthState,
    }
  )
);

/**
 * Helper: get the current Supabase access token.
 * Used by the admin api-client.ts interceptor.
 */
export async function getAdminAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
