'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowUpRight, Building2, Check, CheckCircle2, ChevronRight, FileText, Lightbulb, Loader2, MessageSquare, RefreshCw, ShieldCheck, Smartphone, Target, UserRound } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { nextStep, ONBOARDING_STEPS, type StepId } from '@/lib/onboarding-progress';
import { ONBOARDING_STARTED, onboardingSessionKey, writeOnboardingSession } from '@/lib/onboarding-session';
import { useOnboardingProgress } from './onboarding/OnboardingProgressContext';
import { WhatsAppStep } from './onboarding/WhatsAppStep';
import styles from './onboarding/onboarding-shell.module.css';

const loadingForm = () => <p role="status" className="py-8 text-sm text-text-secondary">Carregando formulário…</p>;
const NewLeadForm = dynamic(() => import('./onboarding/NewLeadForm').then(module => module.NewLeadForm), { loading: loadingForm });
const IcpStep = dynamic(() => import('./onboarding/SetupForms').then(module => module.IcpStep), { loading: loadingForm });
const BusinessStep = dynamic(() => import('./onboarding/SetupForms').then(module => module.BusinessStep), { loading: loadingForm });
const ScriptStep = dynamic(() => import('./onboarding/SetupForms').then(module => module.ScriptStep), { loading: loadingForm });

const STEP_PRESENTATION = {
  whatsapp: { label: 'Conectar WhatsApp', icon: Smartphone },
  firstLead: { label: 'Adicionar um cliente', icon: UserRound },
  icp: { label: 'Definir seu público', icon: Target },
  context: { label: 'Apresentar seu negócio', icon: Building2 },
  firstScript: { label: 'Preparar seu roteiro', icon: FileText },
};
const GUIDANCE: Record<Exclude<StepId, 'whatsapp'>, { title: string; tips: string[] }> = {
  firstLead: { title: 'Comece com um contato de confiança.', tips: ['Escolha alguém que autorizou o contato.', 'Informe o WhatsApp com DDD.', 'E-mail e cidade são opcionais.'] },
  icp: { title: 'Dê foco à sua prospecção.', tips: ['Use um nome que sua equipe reconheça.', 'Indique as regiões em que quer atuar.', 'Os critérios podem ser ajustados depois.'] },
  context: { title: 'Uma assistente com a sua voz.', tips: ['Descreva sua oferta com clareza.', 'Conte como sua equipe atende.', 'Escolha um tom próximo do seu negócio.'] },
  firstScript: { title: 'Prepare uma boa primeira conversa.', tips: ['Abra com uma mensagem objetiva.', 'Revise o texto antes de ativar.', 'Ativar o roteiro não ativa uma campanha.'] },
};

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
  return <section aria-labelledby="onboarding-title" className={styles.shell}>
    <aside aria-label="Resumo da configuração" className={styles.rail}>
      <div className={styles.brand}><span className={styles.brandMark}><img src="/logo-mark.svg" width={24} height={24} alt="" /></span><span>prospix<span className="text-secondary">.</span></span></div>
      <div className={styles.railIntro}>
        <p className={styles.railEyebrow}>Vamos começar</p>
        <p className={styles.railHeadline}>Seu atendimento, pronto para começar.</p>
        <p className={styles.railDescription}>Conecte seu WhatsApp, organize seu público e prepare a primeira conversa.</p>
      </div>
      <ol aria-label="Etapas da configuração" className={styles.steps}>
        {ONBOARDING_STEPS.map(step => {
          const presentation = STEP_PRESENTATION[step.id];
          const finished = progress?.[step.id] === true;
          const active = current === step.id;
          const Icon = finished ? Check : presentation.icon;
          return <li key={step.id} aria-current={active ? 'step' : undefined} className={`${styles.step} ${active ? styles.stepActive : finished ? styles.stepDone : ''}`}>
            <span className={styles.stepIcon}><Icon aria-hidden size={17} /></span>
            <span><span className={styles.stepTitle}>{presentation.label}</span><span className={styles.stepState}>{finished ? 'Concluído' : active ? 'Você está aqui' : 'Em seguida'}</span></span>
          </li>;
        })}
      </ol>
      <div className={styles.railNote}><ShieldCheck aria-hidden size={18} /><p>Uma etapa de cada vez.<br />O que você já salvou fica preservado para continuar depois.</p></div>
    </aside>
    <div className={styles.main}>
    <header className={styles.header}>
      <div className={styles.topbar}>
        <p className={styles.topLabel}><MessageSquare aria-hidden size={16} />Primeiros passos</p>
        <Link href="/inicio" onClick={pause} className={styles.pause}>Continuar depois<ArrowUpRight aria-hidden size={14} /></Link>
      </div>
      <h1 id="onboarding-title" className={styles.title}>Vamos preparar seu primeiro atendimento</h1>
      <p className={styles.subtitle}>Configure sua conta em cinco passos. A cada confirmação, seguimos para a próxima etapa.</p>
      <div className={styles.progressMeta}><span className={styles.stepBadge}><span className="h-1.5 w-1.5 rounded-full bg-primary" />{complete ? 'Tudo pronto' : `Etapa ${Math.max(index + 1, 1)} de ${ONBOARDING_STEPS.length}`}</span><span>{progress ? `${done} de ${ONBOARDING_STEPS.length} etapas confirmadas` : error && !loading ? 'Verificação pendente' : 'Conferindo sua conta…'}</span></div>
      <div role="progressbar" aria-label="Progresso da configuração" aria-valuemin={0} aria-valuemax={5} aria-valuenow={progress ? done : undefined} className={styles.track}>
        {ONBOARDING_STEPS.map((step, position) => <span key={step.id} className={`${styles.segment} ${progress?.[step.id] ? styles.segmentDone : position === index || !progress && position === 0 ? styles.segmentActive : ''}`} />)}
      </div>
    </header>
    <div className={styles.content}>
      {error && <div role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">Não foi possível verificar seu progresso agora. As informações que você já salvou continuam guardadas. <button type="button" disabled={loading} onClick={() => void refresh()} className="min-h-11 font-semibold underline disabled:opacity-60">Tentar novamente</button></div>}
      {!progress && !error && <p role="status" className="mb-5 flex items-center gap-2 text-sm text-text-secondary"><Loader2 aria-hidden className="h-4 w-4 animate-spin" />Conferindo sua conexão e seus cadastros…</p>}
      {current === 'whatsapp' && <WhatsAppStep />}
      {current && current !== 'whatsapp' && <div className={styles.formLayout}>
        <div className={styles.formArea}>
          {current === 'firstLead' && <NewLeadForm embedded />}
          {current === 'icp' && <IcpStep />}
          {current === 'context' && <BusinessStep />}
          {current === 'firstScript' && <ScriptStep />}
        </div>
        <aside aria-label="Orientações para esta etapa" className={styles.guidance}>
          <span className={styles.guidanceIcon}><Lightbulb aria-hidden size={19} /></span>
          <p className={styles.guidanceLabel}>Para começar bem</p>
          <h3>{GUIDANCE[current].title}</h3>
          <ul>{GUIDANCE[current].tips.map(tip => <li key={tip}><CheckCircle2 aria-hidden size={13} /><span>{tip}</span></li>)}</ul>
          <div className={styles.nextStep}><p>Na próxima etapa</p><span>{current === 'firstScript' ? 'Conheça como o Prospix funciona' : STEP_PRESENTATION[ONBOARDING_STEPS[index + 1]!.id].label}</span></div>
        </aside>
      </div>}
      {complete && <div className="py-5 text-center"><CheckCircle2 aria-hidden className="mx-auto h-12 w-12 text-primary" /><h2 className="mt-4 text-2xl font-bold text-text">Sua configuração está pronta</h2><p className="mt-3 text-sm text-text-secondary">Agora você pode preparar sua agenda e revisar a primeira campanha.</p><Link href="/inicio" onClick={pause} className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white">Ir para o painel</Link></div>}
    </div>
    <footer className={styles.footer}>
      <p className={styles.footerNote}><ShieldCheck aria-hidden size={15} />Você pode continuar depois. O que já foi salvo fica preservado.</p>
      <button type="button" disabled={loading} onClick={() => void refresh()} className={styles.refresh}><RefreshCw aria-hidden className={loading ? 'animate-spin' : ''} size={13} />{loading ? 'Conferindo…' : 'Conferir etapas'}<ChevronRight aria-hidden size={13} /></button>
    </footer>
    </div>
  </section>;
}
export default OnboardingChecklist;
