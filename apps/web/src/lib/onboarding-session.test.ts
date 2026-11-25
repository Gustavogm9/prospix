import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceOnboardingSession, onboardingSessionKey, readOnboardingSession, startOnboardingSession, writeOnboardingSession } from './onboarding-session';
afterEach(() => vi.unstubAllGlobals());
const empty = { whatsapp: false, firstLead: false, icp: false, context: false, firstScript: false };
describe('pop-up de configuração por etapa', () => {
  it('abre a próxima etapa somente quando o sistema confirma a anterior', () => {
    expect(advanceOnboardingSession({ open: false, step: 'whatsapp' }, empty)).toEqual({ open: false, step: 'whatsapp' });
    expect(advanceOnboardingSession({ open: false, step: 'whatsapp' }, { ...empty, whatsapp: true })).toEqual({ open: true, step: 'firstLead' });
  });
  it('mantém a próxima pendência real sem perguntar novamente o que já foi preenchido', () => {
    expect(advanceOnboardingSession({ open: false, step: 'firstLead' }, { ...empty, whatsapp: true, firstLead: true, icp: true })).toEqual({ open: true, step: 'context' });
  });
  it('mostra conclusão ao terminar, sem repetir onboarding de conta já completa', () => {
    const complete = { whatsapp: true, firstLead: true, icp: true, context: true, firstScript: true };
    expect(advanceOnboardingSession({ open: false, step: 'firstScript' }, complete)).toEqual({ open: true, step: 'complete' });
    expect(advanceOnboardingSession({ open: true, step: 'checking' }, complete)).toBeNull();
  });
  it('separa a sessão de configuração por pessoa e organização', () => {
    expect(onboardingSessionKey('a', 'x')).not.toBe(onboardingSessionKey('b', 'x'));
    expect(onboardingSessionKey('a', 'x')).not.toBe(onboardingSessionKey('a', 'y'));
  });
  it('continua em memória quando o navegador bloqueia armazenamento', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
    vi.stubGlobal('sessionStorage', blocked); vi.stubGlobal('localStorage', blocked);
    expect(() => startOnboardingSession('private-a', 'private-x')).not.toThrow();
    const key = onboardingSessionKey('private-a', 'private-x');
    expect(readOnboardingSession(key)).toEqual({ open: true, step: 'checking' });
    writeOnboardingSession(key, null);
    expect(readOnboardingSession(key)).toBeNull();
  });
  it('ignora sessão inválida sem transformar isso em etapa concluída', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => '{invalid' });
    expect(readOnboardingSession('invalid-session')).toBeNull();
  });
});
