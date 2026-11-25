'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { nextStep, ONBOARDING_STEPS } from '@/lib/onboarding-progress';
import { ONBOARDING_STARTED, onboardingSessionKey, writeOnboardingSession } from '@/lib/onboarding-session';
import { useOnboardingProgress } from './onboarding/OnboardingProgressContext';
import { WhatsAppStep } from './onboarding/WhatsAppStep';

const loadingForm = () => <p role="status" className="py-8 text-sm text-text-secondary">Carregando formulário…</p>;
const NewLeadForm = dynamic(() => import('./onboarding/NewLeadForm').then(module => module.NewLeadForm), { loading: loadingForm });
const IcpStep = dynamic(() => import('./onboarding/SetupForms').then(module => module.IcpStep), { loading: loadingForm });
const BusinessStep = dynamic(() => import('./onboarding/SetupForms').then(module => module.BusinessStep), { loading: loadingForm });
const ScriptStep = dynamic(() => import('./onboarding/SetupForms').then(module => module.ScriptStep), { loading: loadingForm });

export function OnboardingChecklist() {
  const { tenantId, user } = useAuthStore();
  const { progress, error, loading, refresh } = useOnboardingProgress();
  if (!tenantId || !user) return null;
  const current = progress ? nextStep(progress) : 'whatsapp';
  const index = ONBOARDING_STEPS.findIndex(step => step.id === current);
  const done = progress ? ONBOARDING_STEPS.filter(step => progress[step.id]).length : 0;
  const complete = progress !== null && current === null;
  const pause = () => {
    const key = onboardingSessionKey(tenantId, user.id);
    writeOnboardingSession(key, null);
    window.dispatchEvent(new CustomEvent(ONBOARDING_STARTED, { detail: key }));
  };
  return <section aria-labelledby="onboarding-title" className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
    <header className="border-b border-border px-5 py-5 sm:px-8 sm:py-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Sua conta, do começo</p>
        <Link href="/inicio" onClick={pause} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm font-medium text-primary">Continuar depois</Link>
      </div>
      <h1 id="onboarding-title" className="mt-3 text-xl font-bold tracking-tight text-text">Vamos preparar seu primeiro atendimento</h1>
      <div className="mt-6 flex items-center justify-between gap-3 text-xs text-text-secondary"><span className="font-semibold text-primary">{complete ? 'Tudo pronto' : `Etapa ${Math.max(index + 1, 1)} de ${ONBOARDING_STEPS.length}`}</span><span>{progress ? `${done} de ${ONBOARDING_STEPS.length} etapas confirmadas` : 'Conferindo sua conta…'}</span></div>
      <div role="progressbar" aria-label="Progresso da configuração" aria-valuemin={0} aria-valuemax={5} aria-valuenow={progress ? done : undefined} className="mt-3 flex gap-2">
        {ONBOARDING_STEPS.map((step, position) => <span key={step.id} className={`h-1.5 min-w-0 flex-1 rounded-full ${progress?.[step.id] ? 'bg-primary' : position === index || !progress && position === 0 ? 'bg-primary opacity-40' : 'bg-surface-sunken'}`} />)}
      </div>
    </header>
    <div className="px-5 py-7 sm:px-8 sm:py-8">
      {error && <div role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">Não foi possível confirmar a configuração. O que já foi salvo está preservado. <button type="button" disabled={loading} onClick={() => void refresh()} className="min-h-11 font-semibold underline disabled:opacity-60">Tentar novamente</button></div>}
      {!progress && !error && <p role="status" className="mb-5 flex items-center gap-2 text-sm text-text-secondary"><Loader2 aria-hidden className="h-4 w-4 animate-spin" />Conferindo sua conexão e seus cadastros…</p>}
      {current === 'whatsapp' && <WhatsAppStep />}
      {current === 'firstLead' && <NewLeadForm embedded />}
      {current === 'icp' && <IcpStep />}
      {current === 'context' && <BusinessStep />}
      {current === 'firstScript' && <ScriptStep />}
      {complete && <div className="py-5 text-center"><CheckCircle2 aria-hidden className="mx-auto h-12 w-12 text-primary" /><h2 className="mt-4 text-2xl font-bold text-text">Sua configuração está pronta</h2><p className="mt-3 text-sm text-text-secondary">Agora você pode preparar sua agenda e revisar a primeira campanha.</p><Link href="/inicio" onClick={pause} className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white">Ir para o painel</Link></div>}
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg px-5 py-4 sm:px-8">
      <p className="flex max-w-lg items-start gap-2 text-xs leading-relaxed text-text-secondary"><ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-primary" />Você pode continuar depois. O que já foi salvo fica preservado.</p>
      <button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-primary disabled:opacity-60"><RefreshCw aria-hidden className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Conferindo…' : 'Conferir etapas'}</button>
    </footer>
  </section>;
}
export default OnboardingChecklist;
