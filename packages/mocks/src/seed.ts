/**
 * Seed determinístico de 2 tenants fictícios + dados de domínio.
 * Usado por:
 *  - apps/api/prisma/seed.ts (dev DB)
 *  - testes de multi-tenant isolation (CI obrigatório)
 *
 * UUIDs fixos pra testes serem reprodutíveis.
 */

export const SEED_TENANTS = {
  A: {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'tenant-a-dev',
    name: 'Giovane Carrara · MetLife · SJRP (seed)',
    segment: 'insurance_metlife',
    plan: 'STANDARD',
    status: 'ACTIVE',
  },
  B: {
    id: '22222222-2222-2222-2222-222222222222',
    slug: 'tenant-b-dev',
    name: 'Roberta Mendes · Prudential · SP (seed)',
    segment: 'insurance_other',
    plan: 'STANDARD',
    status: 'ACTIVE',
  },
} as const;

export const SEED_USERS = {
  ownerA: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tenantId: SEED_TENANTS.A.id,
    role: 'OWNER',
    name: 'Giovane Carrara',
    email: 'giovane@seed.prospix.dev',
    whatsapp: '+5517999990001',
  },
  ownerB: {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    tenantId: SEED_TENANTS.B.id,
    role: 'OWNER',
    name: 'Roberta Mendes',
    email: 'roberta@seed.prospix.dev',
    whatsapp: '+5511999990002',
  },
  guildsAdmin: {
    id: '99999999-9999-9999-9999-999999999999',
    tenantId: null,
    role: 'GUILDS_ADMIN',
    name: 'Gustavo Macedo',
    email: 'gustavo.macedo@guilds.com.br',
    whatsapp: '+5511999990000',
  },
} as const;

export const SEED_LEAD_COUNT = {
  tenantA: 200, // tenant A com volume realista
  tenantB: 100, // tenant B só pra validar isolamento
};
