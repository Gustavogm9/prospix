'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { supabase } from '@/lib/supabase';
import AppShell from '@/layout/AppShell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, tenantId, clearSession, initialized, setInitialized } = useAuthStore();
  const [hasHydrated, setHasHydrated] = useState(false);

  // Wait for Zustand to hydrate from localStorage
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    if ((useAuthStore.persist as any).hasHydrated?.()) {
      setHasHydrated(true);
    }
    return unsub;
  }, []);

  // After hydration, verify Supabase session is still valid
  useEffect(() => {
    if (!hasHydrated) return;
    if (initialized) return;

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        // Don't call clearSession() here — it resets `initialized` to false,
        // creating a loop. Just clear user data directly without signOut.
        useAuthStore.setState({ tenantId: null, user: null });
      }
      setInitialized(true);
    }).catch(() => {
      // If getSession fails (network error, etc.), still mark initialized
      // so the layout can redirect to /login instead of showing spinner forever.
      setInitialized(true);
    });
  }, [hasHydrated, initialized, setInitialized]);

  // Listen for Supabase auth state changes (e.g. token refresh, sign-out)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_OUT') {
          clearSession();
          router.replace('/login');
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [clearSession, router]);

  const isAuthorized =
    !!tenantId &&
    !!user &&
    ['OWNER', 'ASSISTANT', 'ADMIN'].includes(user.role);

  // Redirect to login if not authorized after hydration + session check
  useEffect(() => {
    if (hasHydrated && initialized && !isAuthorized) {
      router.replace('/login');
    }
  }, [hasHydrated, initialized, isAuthorized, router]);

  // Show loading while hydrating or checking session
  if (!hasHydrated || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-xs text-text-secondary font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <AppShell>{children}</AppShell>
  );
}
