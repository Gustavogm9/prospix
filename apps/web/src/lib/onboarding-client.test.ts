import { describe, expect, it } from 'vitest';
import { onboardingClientSchema } from './onboarding-client';
const client = { name: 'Contato de teste', email: '', city: '' };
describe('primeiro cliente', () => {
  it('normaliza DDD 55 sem confundi-lo com o código do país', () => {
    expect(onboardingClientSchema.parse({ ...client, whatsapp: '(55) 99999-1234' }).whatsapp).toBe('5555999991234');
    expect(onboardingClientSchema.parse({ ...client, whatsapp: '+55 11 99999-1234' }).whatsapp).toBe('5511999991234');
  });
  it('recusa telefone com letras, número incompleto e e-mail inválido', () => {
    expect(onboardingClientSchema.safeParse({ ...client, whatsapp: 'abc11999991234' }).success).toBe(false);
    expect(onboardingClientSchema.safeParse({ ...client, whatsapp: '1234' }).success).toBe(false);
    expect(onboardingClientSchema.safeParse({ ...client, whatsapp: '11999991234', email: 'email errado' }).success).toBe(false);
  });
});
