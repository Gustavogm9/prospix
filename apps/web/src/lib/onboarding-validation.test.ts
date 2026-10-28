import { describe, expect, it } from 'vitest';
import { normalizeOwnerEmail } from './onboarding-validation';

describe('e-mail do responsável no onboarding', () => {
  it.each(['email teste 123', 'sem-arroba', 'nome@dominio', 'nome@@dominio.com', 'nome@-dominio.com'])('rejeita %s antes de criar um tenant', (value) => {
    expect(normalizeOwnerEmail(value)).toBeNull();
  });

  it('aceita e normaliza um e-mail corporativo válido', () => {
    expect(normalizeOwnerEmail('  Owner+Novo@Empresa.COM.BR  ')).toBe('owner+novo@empresa.com.br');
  });
});
