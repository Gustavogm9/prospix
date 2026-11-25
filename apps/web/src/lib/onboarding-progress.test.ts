import { describe, expect, it } from 'vitest';
import { nextStep, onboardingKey, ONBOARDING_STEPS } from './onboarding-progress';

describe('onboarding por conta', () => {
  it('exige WhatsApp antes do primeiro cliente e ICP', () => {
    expect(nextStep({ firstLead: true, icp: true })).toBe('whatsapp');
    expect(nextStep({ whatsapp: true })).toBe('firstLead');
    expect(nextStep({ whatsapp: true, firstLead: true })).toBe('icp');
  });
  it('retoma a pendência real e volta à conexão quando ela cai', () => {
    const complete = Object.fromEntries(ONBOARDING_STEPS.map(step => [step.id, true]));
    expect(nextStep(complete)).toBeNull();
    expect(nextStep({ ...complete, whatsapp: false })).toBe('whatsapp');
    expect(nextStep({ ...complete, context: false })).toBe('context');
  });
  it('não reutiliza progresso de outra organização, pessoa ou chave global antiga', () => {
    expect(onboardingKey('a', 'pessoa')).not.toBe(onboardingKey('b', 'pessoa'));
    expect(onboardingKey('a', 'pessoa')).not.toBe(onboardingKey('a', 'outra'));
    expect(onboardingKey('a', 'pessoa')).not.toBe('prospix-onboarding-state-v1');
  });
});
