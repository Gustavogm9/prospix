import { describe, expect, it } from 'vitest';
import { findUniqueOwnerByEmail, normalizeOwnerEmail } from './onboarding-validation';

describe('e-mail do responsável no onboarding', () => {
  it.each(['email teste 123', 'sem-arroba', 'nome@dominio', 'nome@@dominio.com', 'nome@-dominio.com'])('rejeita %s antes de criar um tenant', (value) => {
    expect(normalizeOwnerEmail(value)).toBeNull();
  });

  it('aceita e normaliza um e-mail corporativo válido', () => {
    expect(normalizeOwnerEmail('  Owner+Novo@Empresa.COM.BR  ')).toBe('owner+novo@empresa.com.br');
  });
});

describe('resgate de convite com mais de um OWNER', () => {
  const owners = [
    { id: 'owner-1', email: 'primeira@empresa.com.br' },
    { id: 'owner-2', email: 'Segunda@Empresa.com.br' },
  ];

  it('seleciona somente o OWNER com o e-mail informado', () => {
    expect(findUniqueOwnerByEmail(owners, 'segunda@empresa.com.br')).toEqual(owners[1]);
  });

  it('nega e-mail de terceiro e resultado ambíguo', () => {
    expect(findUniqueOwnerByEmail(owners, 'terceira@empresa.com.br')).toBeNull();
    expect(findUniqueOwnerByEmail([...owners, { id: 'owner-3', email: 'SEGUNDA@empresa.com.br' }], 'segunda@empresa.com.br')).toBeNull();
  });
});
