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
  /** Check Supabase session and load admin user data from the users table */
  initializeFromSupabase: () => Promise<void>;
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
      initializeFromSupabase: async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const session = sessionData.session;

          if (!session?.user) {
            set({ initialized: true });
            return;
          }

          const { data: userData, error } = await supabase
            .from('users')
            .select('id, name, email, role')
            .eq('id', session.user.id)
            .maybeSingle();

          if (error || !userData) {
            // Force clear session if admin user does not exist in the public table (e.g. after DB reset)
            supabase.auth.signOut().catch(() => {});
            set({
              adminUser: null,
              initialized: true,
            });
            return;
          }

          // Only allow admin roles
          const adminRoles: AdminSession['role'][] = ['SUPER_ADMIN', 'ADMIN', 'GUILDS_ADMIN'];
          if (!adminRoles.includes(userData.role as AdminSession['role'])) {
            set({ initialized: true });
            return;
          }

          set({
            adminUser: userData as AdminSession,
            initialized: true,
          });
        } catch {
          set({ initialized: true });
        }
      },
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
