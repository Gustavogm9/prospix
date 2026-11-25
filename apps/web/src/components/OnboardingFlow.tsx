'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check, MessageCircle, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { loadOnboardingProgress } from '@/lib/load-onboarding-progress';
import { ONBOARDING_STEPS, type OnboardingProgress } from '@/lib/onboarding-progress';
import { advanceOnboardingSession, onboardingSessionKey, ONBOARDING_REFRESH, ONBOARDING_STARTED, readOnboardingSession, startOnboardingSession, writeOnboardingSession, type OnboardingSession } from '@/lib/onboarding-session';
import { OnboardingChecklist } from './OnboardingChecklist';

export function OnboardingFlow({ showChecklist }: { showChecklist: boolean }) {
  const { tenantId, user } = useAuthStore();
  if (!tenantId || !user) return null;
  return <Flow key={onboardingSessionKey(tenantId, user.id)} tenantId={tenantId} userId={user.id} showChecklist={showChecklist} />;
}

function Flow({ tenantId, userId, showChecklist }: { tenantId: string; userId: string; showChecklist: boolean }) {
  const pathname = usePathname();
  const key = onboardingSessionKey(tenantId, userId);
  const [session, setSession] = useState<OnboardingSession | null>(null);
  const [ready, setReady] = useState(false);
  const [restart, setRestart] = useState(0);
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
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
      setProgress(null); setError(false);
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
    setLoading(true);
    try {
      const result = await loadOnboardingProgress(tenantId);
      if (!alive.current || requestGeneration !== generation.current || !current.current) return;
      setProgress(result); setError(false);
      apply(advanceOnboardingSession(current.current, result));
    } catch {
      if (alive.current && requestGeneration === generation.current) setError(true);
    } finally {
      busy.current = false;
      if (alive.current && requestGeneration === generation.current) setLoading(false);
      if (queued.current && alive.current && current.current) { queued.current = false; void refresh(); }
    }
  }, [tenantId, apply]);

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

  if (!ready) return null;
  if (!session) {
    if (showChecklist) return <OnboardingChecklist />;
    if (pathname === '/configuracoes' || pathname === '/icps' || pathname?.startsWith('/roteiros')) return <div className="mb-4 rounded-xl border border-border bg-white px-4 text-sm text-text-secondary">
      Preparando sua conta? <button type="button" className="min-h-11 font-semibold text-primary underline" onClick={() => startOnboardingSession(tenantId, userId)}>Retomar primeiros passos</button>
    </div>;
    return null;
  }
  return <>
    {!session.open && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/20 bg-white px-4 py-2 text-sm text-text-secondary">
      <span>Configuração em andamento · {ONBOARDING_STEPS.find(step => step.id === session.step)?.title || 'Primeiros passos'}</span>
      <button type="button" className="min-h-11 font-semibold text-primary underline" onClick={() => { apply({ ...session, open: true }); void refresh(); }}>Ver próxima etapa</button>
    </div>}
    {session.open && <OnboardingDialog session={session} progress={progress} error={error} loading={loading} onRetry={() => void refresh()} onClose={() => apply(null)} onContinue={() => apply({ ...session, open: false })} />}
  </>;
}

function OnboardingDialog({ session, progress, error, loading, onClose, onContinue, onRetry }: {
  session: OnboardingSession; progress: OnboardingProgress | null; error: boolean; loading: boolean;
  onClose: () => void; onContinue: () => void; onRetry: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(); const descriptionId = useId();
  const complete = session.step === 'complete';
  const step = ONBOARDING_STEPS.find(item => item.id === session.step);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} className="m-auto w-[calc(100%_-_2rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-white p-0 text-text shadow-xl backdrop:bg-slate-950/50">
    <div className="flex max-h-[calc(100dvh_-_2rem)] flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-border p-5">
        <MessageCircle aria-hidden className="mt-1 h-6 w-6 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-lg font-bold">{complete ? 'Configuração inicial concluída' : 'Vamos configurar sua conta'}</h2>
          <p id={descriptionId} className="mt-1 text-sm text-text-secondary">{complete ? 'Sua conta está preparada para os próximos passos.' : 'Faça uma etapa por vez. Ao concluir, eu mostro a próxima.'}</p>
        </div>
        <button type="button" aria-label="Fechar primeiros passos" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-primary" onClick={onClose}><X aria-hidden className="h-5 w-5" /></button>
      </header>
      <div role="region" aria-label="Detalhes das etapas" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        {error ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Não foi possível confirmar a etapa. Seus dados foram preservados. Tente verificar novamente.</div> : !progress ? <p role="status" className="py-5 text-sm text-text-secondary">Conferindo sua configuração…</p> : <>
          <ol aria-label="Etapas da configuração" className="space-y-2">
            {ONBOARDING_STEPS.map((item, index) => <li key={item.id} aria-current={item.id === session.step ? 'step' : undefined} className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${item.id === session.step ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken font-semibold text-primary">{progress[item.id] ? <Check aria-label="Concluído" className="h-4 w-4" /> : index + 1}</span>
              <span className="min-w-0 flex-1 font-medium">{item.title}</span>
              {item.id === session.step && <span className="text-xs font-semibold text-primary">Agora</span>}
            </li>)}
          </ol>
          {step && <p className="mt-4 text-sm leading-relaxed text-text-secondary">{step.description}</p>}
          {complete && <p className="mt-4 text-sm text-text-secondary">No painel, você pode preparar sua agenda e revisar a primeira campanha.</p>}
        </>}
      </div>
      <footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-white p-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-primary">{complete ? 'Fechar' : 'Continuar depois'}</button>
        {error ? <button type="button" disabled={loading} onClick={onRetry} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60">{loading ? 'Conferindo…' : 'Verificar novamente'}</button> : complete ? <Link href="/inicio" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white">Ir para o painel</Link> : step && progress && <Link href={step.href} onClick={onContinue} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-center text-sm font-semibold text-white">{step.action}<ArrowRight aria-hidden className="h-4 w-4 shrink-0" /></Link>}
      </footer>
    </div>
  </dialog>;
}
