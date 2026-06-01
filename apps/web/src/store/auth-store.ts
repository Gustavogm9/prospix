import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';

export interface UserSession {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ASSISTANT' | 'ADMIN';
}

interface AuthState {
  tenantId: string | null;
  user: UserSession | null;
  /** Whether the Supabase session has been checked at least once */
  initialized: boolean;
  setSession: (user: UserSession) => void;
  clearSession: () => void;
  setInitialized: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      tenantId: null,
      user: null,
      initialized: false,
      setSession: (user) =>
        set({
          tenantId: user.tenant_id,
          user,
        }),
      clearSession: () => {
        // Sign out from Supabase (fire-and-forget; don't block the UI)
        supabase.auth.signOut().catch(() => {});
        set({
          tenantId: null,
          user: null,
          initialized: false,
        });
      },
      setInitialized: (value) => set({ initialized: value }),
    }),
    {
      name: 'prospix-auth-storage',
      // Only persist user-level metadata; the token lives in the Supabase session
      partialize: (state) => ({
        tenantId: state.tenantId,
        user: state.user,
      }) as AuthState,
    }
  )
);

/**
 * Helper: get the current Supabase access token.
 * Used by api-client.ts and useRealtimeEvents.ts.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
