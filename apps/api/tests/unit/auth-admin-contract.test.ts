import fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CRITICAL_API_CONTRACTS,
  type ApiErrorShape,
  type ApiResponseShape,
  type CriticalApiContract,
} from '@prospix/shared-types/api';
import { adminRoutes } from '../../src/routes/admin/index.js';
import { authRoutes } from '../../src/routes/auth/index.js';

const adminTenantId = 'tenant-admin-contract-1';
const adminUserId = 'guilds-admin-contract-1';
const billingId = 'billing-admin-contract-1';
const templateId = 'template-admin-contract-1';
const invitationId = 'invitation-admin-contract-1';
const invitationCode = 'PRSPX-A1B2-C3D4';

const prismaMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn((callback) => callback(prismaMock)),
  tenant: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tenantSecret: {
    create: vi.fn(),
  },
  tenantAIConfig: {
    create: vi.fn(),
  },
  tenantUsage: {
    findMany: vi.fn(),
  },
  user: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  campaign: {
    updateMany: vi.fn(),
  },
  tenantInvitation: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  tenantBilling: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  scriptTemplate: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

const sendMagicLinkMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());
const verifyInvitationMock = vi.hoisted(() => vi.fn());
const redeemInvitationMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/services/auth-service.js', () => ({
  sendMagicLink: sendMagicLinkMock,
  validateMagicLink: vi.fn(),
  createSession: createSessionMock,
  rotateSession: vi.fn(),
  revokeSession: vi.fn(),
  withAuthRlsBypass: vi.fn((operation) => operation(prismaMock)),
}));

vi.mock('../../src/services/invitation-service.js', () => ({
  generateInvitationCode: vi.fn(() => invitationCode),
  verifyInvitation: verifyInvitationMock,
  redeemInvitation: redeemInvitationMock,
}));

vi.mock('../../src/lib/crypto.js', () => ({
  verifyPassword: vi.fn(() => true),
}));

async function buildAuthApp() {
  const app = fastify({ logger: false });
  await app.register(fastifyJwt, { secret: 'contract-test-secret' });
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.ready();
  return app;
}

async function buildAdminApp() {
  const app = fastify({ logger: false });

  app.addHook('preHandler', async (request) => {
    request.role = 'GUILDS_ADMIN';
    request.userId = adminUserId;
  });

  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.ready();
  return app;
}

function parsePayload(payload: string) {
  return payload ? JSON.parse(payload) : undefined;
}

function expectResponseShape(body: unknown, shape: ApiResponseShape) {
  if (shape === 'raw-array') {
    expect(Array.isArray(body)).toBe(true);
    return;
  }

  if (shape === 'raw-object') {
    expect(body).toEqual(expect.any(Object));
    expect(Array.isArray(body)).toBe(false);
    expect(body).not.toHaveProperty('data');
    return;
  }

  if (shape === 'data-array') {
    expect(body).toEqual(expect.objectContaining({
      data: expect.any(Array),
    }));
    return;
  }

  if (shape === 'data-object') {
    expect(body).toEqual(expect.objectContaining({
      data: expect.any(Object),
    }));
    expect(Array.isArray((body as { data: unknown }).data)).toBe(false);
    return;
  }

  expect(body).toBeUndefined();
}

function expectErrorShape(body: unknown, shape: ApiErrorShape) {
  if (shape === 'flat-error') {
    expect(body).toEqual(expect.objectContaining({
      error: expect.any(String),
      message: expect.any(String),
    }));
    return;
  }

  expect(body).toEqual(expect.objectContaining({
    error: expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
    }),
  }));
}

function seedAuthMocks() {
  sendMagicLinkMock.mockResolvedValue({
    ok: true,
    value: { expires_in: 600 },
  });
  createSessionMock.mockResolvedValue({
    accessTokenId: 'access-token-contract-1',
    refreshToken: 'refresh-token-contract-1',
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: adminUserId,
    tenantId: null,
    name: 'Guilds Admin',
    email: 'admin@prospix.test',
    role: 'GUILDS_ADMIN',
    passwordHash: 'hashed-password',
  });
  verifyInvitationMock.mockResolvedValue({
    ok: true,
    value: { tenantName: 'Contract Tenant', role: 'OWNER' },
  });
  redeemInvitationMock.mockResolvedValue({
    ok: true,
    value: { userId: 'user-1', tenantId: adminTenantId, magicLinkSent: true },
  });
}

function seedAdminMocks() {
  const tenantRecord = {
    id: adminTenantId,
    name: 'Contract Tenant',
    slug: 'contract-tenant',
    status: 'ACTIVE',
    plan: 'STANDARD',
    mrrCents: 15000,
    users: [],
    secret: null,
  };

  prismaMock.tenant.findMany.mockResolvedValue([
    { id: adminTenantId, name: 'Contract Tenant', slug: 'contract-tenant' },
  ]);
  prismaMock.tenant.findUnique.mockImplementation(({ where }: { where?: { slug?: string } }) => {
    if (where?.slug === 'contract-tenant') {
      return Promise.resolve(null);
    }

    return Promise.resolve(tenantRecord);
  });
  prismaMock.tenant.create.mockResolvedValue({
    id: adminTenantId,
    name: 'Contract Tenant',
    slug: 'contract-tenant',
    plan: 'STANDARD',
    status: 'ONBOARDING',
    mrrCents: 15000,
  });
  prismaMock.tenant.update.mockResolvedValue({
    id: adminTenantId,
    name: 'Contract Tenant',
    plan: 'STANDARD',
    status: 'SUSPENDED',
  });
  prismaMock.tenantSecret.create.mockResolvedValue({ tenantId: adminTenantId });
  prismaMock.tenantAIConfig.create.mockResolvedValue({ tenantId: adminTenantId });
  prismaMock.campaign.updateMany.mockResolvedValue({ count: 2 });
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  prismaMock.tenantUsage.findMany.mockResolvedValue([
    {
      tenantId: adminTenantId,
      llmCostCents: 1200,
      whatsappCostCents: 300,
      googleMapsCostCents: 100,
      tenant: {
        id: adminTenantId,
        name: 'Contract Tenant',
        mrrCents: 15000,
        plan: 'STANDARD',
      },
    },
  ]);
  prismaMock.tenantBilling.findMany.mockResolvedValue([
    {
      id: billingId,
      tenantId: adminTenantId,
      status: 'PENDING',
      totalCents: 15000,
      dueAt: new Date('2026-05-30T12:00:00.000Z'),
      tenant: { name: 'Contract Tenant' },
    },
  ]);
  prismaMock.tenantBilling.findUnique.mockResolvedValue({
    id: billingId,
    tenantId: adminTenantId,
    status: 'PENDING',
    totalCents: 15000,
    tenant: {
      id: adminTenantId,
      status: 'SUSPENDED',
    },
  });
  prismaMock.tenantBilling.update.mockResolvedValue({
    id: billingId,
    tenantId: adminTenantId,
    status: 'PAID',
  });
  prismaMock.tenantInvitation.findFirst.mockImplementation(({ where }: { where?: { id?: string } }) => {
    if (where?.id === invitationId) {
      return Promise.resolve({
        id: invitationId,
        tenantId: adminTenantId,
        code: invitationCode,
        usedAt: null,
        revokedAt: null,
      });
    }

    return Promise.resolve(null);
  });
  prismaMock.tenantInvitation.findUnique.mockResolvedValue(null);
  prismaMock.tenantInvitation.create.mockResolvedValue({
    id: invitationId,
    tenantId: adminTenantId,
    code: invitationCode,
    role: 'OWNER',
  });
  prismaMock.tenantInvitation.update.mockResolvedValue({
    id: invitationId,
    tenantId: adminTenantId,
    revokedAt: new Date('2026-05-23T12:00:00.000Z'),
  });
  prismaMock.tenantInvitation.findMany.mockResolvedValue([
    { id: invitationId, tenantId: adminTenantId, code: invitationCode },
  ]);
  prismaMock.scriptTemplate.findMany.mockResolvedValue([
    { id: templateId, name: 'Contract Template', active: true },
  ]);
  prismaMock.scriptTemplate.findUnique.mockResolvedValue({
    id: templateId,
    name: 'Contract Template',
    active: true,
  });
  prismaMock.scriptTemplate.create.mockResolvedValue({
    id: templateId,
    name: 'Contract Template',
    active: true,
  });
  prismaMock.scriptTemplate.update.mockResolvedValue({
    id: templateId,
    name: 'Contract Template Updated',
    active: true,
  });
}

function successRequestFor(contract: CriticalApiContract) {
  const routeId = contract.path.includes('/billing/')
    ? billingId
    : contract.path.includes('/templates/')
      ? templateId
      : adminTenantId;
  const url = `/v1${contract.path}`
    .replace('{id}', routeId)
    .replace('{invitationId}', invitationId);
  const payloadById: Record<string, unknown> = {
    'auth.magicLink': { whatsapp: '+5517999999999' },
    'auth.adminLogin': { email: 'admin@prospix.test', password: 'secret' },
    'auth.invitations.verify': { code: invitationCode },
    'auth.invitations.redeem': {
      code: invitationCode,
      user: {
        name: 'Contract Owner',
        email: 'owner@prospix.test',
        whatsapp: '+5517999999999',
        password: 'super-secret-password-123',
      },
      accept_terms: true,
    },
    'admin.tenants.create': {
      name: 'Contract Tenant',
      slug: 'contract-tenant',
      plan: 'STANDARD',
      mrrCents: 15000,
    },
    'admin.tenants.update': {
      name: 'Contract Tenant Updated',
      mrrCents: 18000,
    },
    'admin.tenants.invitations.create': {
      notes: 'Contract invite',
    },
    'admin.templates.create': {
      name: 'Contract Template',
      segment: 'insurance',
      category: 'APPROACH',
      flowTemplate: { nodes: [] },
      variables: [],
    },
    'admin.templates.update': {
      name: 'Contract Template Updated',
      flowTemplate: { nodes: [] },
    },
  };

  return {
    method: contract.method,
    url,
    payload: payloadById[contract.id],
  };
}

function validationRequestFor(contract: CriticalApiContract) {
  const request = successRequestFor(contract);
  const invalidPayloadById: Record<string, unknown> = {
    'auth.magicLink': {},
    'auth.adminLogin': { email: 'invalid', password: '' },
    'auth.invitations.verify': { code: 'invalid' },
    'auth.invitations.redeem': {
      code: invitationCode,
      user: {
        name: '',
        email: 'not-an-email',
        whatsapp: '',
      },
      accept_terms: false,
    },
    'admin.tenants.create': {},
    'admin.tenants.update': { mrrCents: 'invalid' },
    'admin.templates.create': {},
    'admin.templates.update': { variables: 'invalid' },
  };

  return {
    ...request,
    payload: invalidPayloadById[contract.id],
  };
}

describe('AUD-P1-012/AUD-P1-014 auth and admin contract routes', () => {
  let authApp: Awaited<ReturnType<typeof buildAuthApp>> | undefined;
  let adminApp: Awaited<ReturnType<typeof buildAdminApp>> | undefined;
  const criticalContracts = CRITICAL_API_CONTRACTS as readonly CriticalApiContract[];
  const authContracts = criticalContracts.filter((contract) => contract.path.startsWith('/auth/'));
  const adminContracts = criticalContracts.filter((contract) => contract.path.startsWith('/admin/'));
  const scopedContracts = [...authContracts, ...adminContracts];

  beforeEach(async () => {
    vi.clearAllMocks();
    seedAuthMocks();
    seedAdminMocks();
    authApp = await buildAuthApp();
    adminApp = await buildAdminApp();
  });

  afterEach(async () => {
    if (authApp) {
      await authApp.close();
      authApp = undefined;
    }

    if (adminApp) {
      await adminApp.close();
      adminApp = undefined;
    }
  });

  it('keeps critical auth/admin success and validation envelopes in sync with shared-types', async () => {
    for (const contract of scopedContracts) {
      const app = contract.path.startsWith('/auth/') ? authApp! : adminApp!;
      const response = await app.inject(successRequestFor(contract) as any);

      expect(response.statusCode, contract.id).toBe(contract.successStatus);
      expectResponseShape(parsePayload(response.payload), contract.successShape);
    }

    for (const contract of scopedContracts) {
      if (!contract.validationErrorStatus || !contract.validationErrorShape) {
        continue;
      }

      const app = contract.path.startsWith('/auth/') ? authApp! : adminApp!;
      const response = await app.inject(validationRequestFor(contract) as any);

      expect(response.statusCode, contract.id).toBe(contract.validationErrorStatus);
      expectErrorShape(parsePayload(response.payload), contract.validationErrorShape);
    }
  });
});
