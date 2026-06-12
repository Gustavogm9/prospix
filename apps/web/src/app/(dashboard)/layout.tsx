'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { supabase } from '@/lib/supabase';
import AppShell from '@/layout/AppShell';
import { Button } from '@prospix/ui';
import { AlertTriangle } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, tenantId, clearSession, initialized, setInitialized } = useAuthStore();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

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
        if (event === 'SIGNED_OUT' || (event as string) === 'TOKEN_REFRESH_FAILED') {
          setIsSessionExpired(true);
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
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg">
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
    <>
      <AppShell>{children}</AppShell>

      {/* Session Expired Forced Modal */}
      {isSessionExpired && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <div className="bg-white border border-border rounded-2xl w-full max-w-sm p-6 shadow-2xl flex flex-col items-center text-center animate-scaleIn">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4 border-4 border-amber-50">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold font-heading text-text mb-2">
              Sessão Expirada
            </h3>
            <p className="text-sm text-text-secondary mb-6 leading-relaxed">
              Por segurança, sua sessão foi encerrada. Por favor, faça login novamente para continuar acessando o Prospix.
            </p>
            <Button
              onClick={() => {
                clearSession();
                router.replace('/login');
              }}
              className="w-full h-11 text-sm font-semibold rounded-xl bg-primary hover:bg-primary-hover text-white shadow-sm"
            >
              Fazer Login Novamente
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
