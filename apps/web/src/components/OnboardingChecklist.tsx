'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, LockKeyhole, RefreshCw, MessageSquare } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { loadOnboardingProgress } from '@/lib/load-onboarding-progress';
import { nextStep, onboardingKey, ONBOARDING_STEPS, type OnboardingProgress } from '@/lib/onboarding-progress';

export function OnboardingChecklist({ standalone = false }: { standalone?: boolean }) {
  const { tenantId, user } = useAuthStore();
  if (!tenantId || !user) return null;
  return <Guide key={onboardingKey(tenantId, user.id)} tenantId={tenantId} userId={user.id} standalone={standalone} />;
}

function Guide({ tenantId, userId, standalone }: { tenantId: string; userId: string; standalone: boolean }) {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const alive = useRef(false);
  const busy = useRef(false);
  const key = onboardingKey(tenantId, userId);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const result = await loadOnboardingProgress(tenantId);
      if (alive.current) { setProgress(result); setError(false); }
    } catch { if (alive.current) setError(true); }
    finally { busy.current = false; if (alive.current) setLoading(false); }
  }, [tenantId]);

  useEffect(() => {
    alive.current = true;
    try { setMinimized(localStorage.getItem(key) === 'minimized'); } catch { /* optional preference */ }
    void refresh();
    const check = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    const interval = setInterval(check, 30000);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive.current = false; clearInterval(interval);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [key, refresh]);

  const current = progress ? nextStep(progress) : null;
  const done = progress ? ONBOARDING_STEPS.filter(step => progress[step.id]).length : 0;
  const complete = progress !== null && current === null;
  const toggle = () => {
    setMinimized(value => {
      try { localStorage.setItem(key, value ? 'expanded' : 'minimized'); } catch { /* preference only */ }
      return !value;
    });
  };

  return <section aria-labelledby="onboarding-title" className="mb-6 overflow-hidden rounded-2xl border border-primary/20 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:p-6">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">Sua conta, do começo</p>
        <h2 id="onboarding-title" className="text-xl font-bold text-text">Vamos preparar seu primeiro atendimento</h2>
        <p className="mt-2 text-sm text-text-secondary">Comece pelo WhatsApp e avance uma etapa de cada vez.</p>
      </div>
      {!standalone && <button type="button" onClick={toggle} className="min-h-11 rounded-lg border border-border px-3 text-sm text-primary">{minimized ? 'Retomar configuração' : 'Minimizar guia'}</button>}
    </header>
    <div className="px-5 pt-4 sm:px-6" aria-live="polite">
      {error ? <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Não foi possível confirmar a configuração. As etapas não foram marcadas como concluídas.
        <button type="button" disabled={loading} onClick={() => void refresh()} className="ml-2 min-h-11 underline">Tentar novamente</button>
        <Link href="/configuracoes?tab=integracoes" className="ml-3 inline-flex min-h-11 items-center underline">Verificar WhatsApp</Link>
      </div> : !progress ? <p role="status" className="py-3 text-sm text-text-secondary">Conferindo sua conexão e seus cadastros…</p> :
        <p className="text-sm text-text-secondary">{done} de {ONBOARDING_STEPS.length} etapas confirmadas{complete ? ' · Configuração inicial concluída' : ''}</p>}
    </div>
    {((!minimized && !complete) || standalone) && progress && <ol className="space-y-3 p-5 sm:p-6">
      {ONBOARDING_STEPS.map((step, index) => {
        const finished = progress[step.id];
        const active = current === step.id;
        return <li key={step.id} aria-current={active ? 'step' : undefined} className={active ? 'rounded-xl border-2 border-primary bg-primary/5 p-4' : 'rounded-xl border border-border p-4'}>
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-sm font-bold text-primary">{finished ? <CheckCircle2 className="h-5 w-5" aria-label="Confirmado" /> : index + 1}</span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-text">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{step.description}</p>
              <p className="mt-2 text-xs font-medium text-text-secondary">{finished ? 'Confirmado no sistema' : active ? 'Próxima etapa' : 'Aguardando as etapas anteriores'}</p>
              {active && !error && <Link href={step.href} className="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">{step.action}<ArrowRight className="h-4 w-4 shrink-0" /></Link>}
              {!active && !finished && <LockKeyhole aria-hidden className="mt-2 h-4 w-4 text-text-secondary" />}
            </div>
          </div>
        </li>;
      })}
    </ol>}
    <footer className="flex flex-wrap items-center justify-between gap-3 p-5 pt-3 sm:px-6">
      <p className="flex max-w-lg items-start gap-2 text-xs leading-relaxed text-text-secondary"><MessageSquare className="h-4 w-4 shrink-0" />Este guia não envia mensagens. Faça o primeiro teste somente com um contato autorizado.</p>
      <button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-primary"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{loading ? 'Conferindo…' : 'Conferir etapas'}</button>
      {complete && !error && <div className="w-full border-t border-border pt-4 text-sm text-text-secondary">Próximos passos: <Link href="/configuracoes?tab=agenda" className="underline">configurar agenda</Link> e <Link href="/campanhas" className="underline">preparar uma campanha</Link>. Revise os dados e o roteiro antes de qualquer envio.</div>}
    </footer>
  </section>;
}
export default OnboardingChecklist;
