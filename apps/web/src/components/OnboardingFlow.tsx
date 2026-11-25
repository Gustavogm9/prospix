'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { loadOnboardingProgress } from '@/lib/load-onboarding-progress';
import { advanceOnboardingSession, onboardingSessionKey, ONBOARDING_REFRESH, ONBOARDING_STARTED, readOnboardingSession, startOnboardingSession, writeOnboardingSession, type OnboardingSession } from '@/lib/onboarding-session';

export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const { tenantId, user } = useAuthStore();
  if (!tenantId || !user) return null;
  return <Flow key={onboardingSessionKey(tenantId, user.id)} tenantId={tenantId} userId={user.id} onComplete={onComplete} />;
}

function Flow({ tenantId, userId, onComplete }: { tenantId: string; userId: string; onComplete: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const key = onboardingSessionKey(tenantId, userId);
  const [session, setSession] = useState<OnboardingSession | null>(null);
  const [ready, setReady] = useState(false);
  const [restart, setRestart] = useState(0);
  const current = useRef<OnboardingSession | null>(null);
  const busy = useRef(false);
  const queued = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const apply = useCallback((value: OnboardingSession | null) => {
    current.current = value;
    writeOnboardingSession(key, value);
    setSession(value);
  }, [key]);

  useEffect(() => {
    apply(readOnboardingSession(key));
    setReady(true);
    const started = (event: Event) => {
      if ((event as CustomEvent).detail !== key) return;
      apply(readOnboardingSession(key)); setRestart(value => value + 1);
    };
    window.addEventListener(ONBOARDING_STARTED, started);
    return () => window.removeEventListener(ONBOARDING_STARTED, started);
  }, [key, apply]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!current.current) return;
    if (busy.current) { queued.current = true; return; }
    busy.current = true;
    const requestGeneration = generation.current;
    try {
      const result = await loadOnboardingProgress(tenantId);
      if (!alive.current || requestGeneration !== generation.current || !current.current) return;
      apply(advanceOnboardingSession(current.current, result));
    } catch {
      // The dedicated page owns the error and retry UI.
      if (alive.current && requestGeneration === generation.current && current.current?.open) router.replace('/onbording');
    } finally {
      busy.current = false;
      if (queued.current && alive.current && current.current) { queued.current = false; void refresh(); }
    }
  }, [tenantId, apply, router]);

  const active = session !== null;
  useEffect(() => {
    if (!active) return;
    alive.current = true;
    void refresh();
    const check = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    const interval = setInterval(check, 20000);
    window.addEventListener(ONBOARDING_REFRESH, check);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive.current = false; generation.current += 1;
      clearInterval(interval);
      window.removeEventListener(ONBOARDING_REFRESH, check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active, pathname, refresh, restart]);

  useEffect(() => {
    if (ready && pathname === '/onbording' && !current.current) startOnboardingSession(tenantId, userId);
  }, [ready, pathname, tenantId, userId]);

  useEffect(() => {
    if (!session) return;
    if (session.step === 'complete') {
      // Consume the completion before opening the tour so refresh cannot reopen it.
      apply(null);
      onComplete();
      router.replace('/inicio');
    } else if (session.open && session.step !== 'checking') {
      apply({ ...session, open: false });
      if (pathname !== '/onbording') router.replace('/onbording');
    }
  }, [session, pathname, apply, onComplete, router]);

  return null;
}
