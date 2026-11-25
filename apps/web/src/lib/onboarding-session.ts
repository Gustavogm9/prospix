import { nextStep, onboardingKey, ONBOARDING_STEPS, type OnboardingProgress, type StepId } from './onboarding-progress';

export type OnboardingSession = { open: boolean; step: StepId | 'checking' | 'complete' };
export const ONBOARDING_STARTED = 'prospix-onboarding-started';
export const ONBOARDING_REFRESH = 'prospix-onboarding-refresh';
const memory = new Map<string, OnboardingSession | null>();
export const onboardingSessionKey = (tenantId: string, userId: string) => `prospix-onboarding-flow:v1:${tenantId}:${userId}`;

export function advanceOnboardingSession(session: OnboardingSession, progress: OnboardingProgress): OnboardingSession | null {
  const step = nextStep(progress) ?? 'complete';
  if (session.step === 'checking' && step === 'complete') return null;
  return { step, open: session.open || step !== session.step };
}

export function readOnboardingSession(key: string): OnboardingSession | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    const steps = ['checking', 'complete', ...ONBOARDING_STEPS.map(step => step.id)];
    if (value && typeof value.open === 'boolean' && steps.includes(value.step)) return value;
  } catch { /* Storage is an optional continuity aid, never the source of completion. */ }
  return null;
}

export function writeOnboardingSession(key: string, session: OnboardingSession | null) {
  memory.set(key, session);
  try {
    if (session) sessionStorage.setItem(key, JSON.stringify(session));
    else sessionStorage.removeItem(key);
  } catch { /* Keep the flow working in memory. */ }
}

export function startOnboardingSession(tenantId: string, userId: string) {
  const key = onboardingSessionKey(tenantId, userId);
  writeOnboardingSession(key, { open: true, step: 'checking' });
  try { localStorage.setItem(onboardingKey(tenantId, userId), 'expanded'); } catch { /* Optional preference. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ONBOARDING_STARTED, { detail: key }));
}

export function notifyOnboardingProgress() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ONBOARDING_REFRESH));
}
