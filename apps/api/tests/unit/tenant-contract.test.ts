import fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CRITICAL_API_CONTRACTS,
  type ApiErrorShape,
  type ApiResponseShape,
  type CriticalApiContract,
} from '@prospix/shared-types/api';
import { tenantRoutes } from '../../src/routes/tenant/index.js';

const tenantId = 'tenant-contract-1';
const userId = 'user-contract-1';
const templateId = '11111111-1111-4111-8111-111111111111';
const meetingId = '22222222-2222-4222-8222-222222222222';

const prismaMock = vi.hoisted(() => ({
  conversation: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  script: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  scriptTemplate: {
    findUnique: vi.fn(),
  },
  scriptVariation: {
    upsert: vi.fn(),
  },
  lead: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  leadEvent: {
    create: vi.fn(),
  },
  optout: {
    upsert: vi.fn(),
  },
  leadNote: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  meeting: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
  tenantSecret: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  tenantUsage: {
    findUnique: vi.fn(),
  },
  notificationPreference: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn((callback) => callback(prismaMock)),
}));

const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const createTenantQueueMock = vi.hoisted(() => vi.fn(() => ({ add: queueAddMock })));
const evolutionClientMock = vi.hoisted(() => ({
  getConnectionState: vi.fn(),
  createInstance: vi.fn(),
  setWebhook: vi.fn(),
  getQrCode: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
}));
const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

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

vi.mock('../../src/lib/queue.js', () => ({
  createTenantQueue: createTenantQueueMock,
  getTenantQueueName: vi.fn((activeTenantId: string, workerName: string) => `queue:${activeTenantId}:${workerName}`),
}));

vi.mock('../../src/lib/redis.js', () => ({
  redis: redisMock,
  redisConnection: {},
}));

vi.mock('../../src/config/env.js', () => ({
  env: {
    API_URL: 'https://api.prospix.test',
    APP_URL: 'https://app.prospix.test',
    EVOLUTION_BASE_URL: 'https://evolution.prospix.test',
    EVOLUTION_GUILDS_API_KEY: 'test-evolution-key',
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
  },
}));

vi.mock('../../src/tenant/secrets-vault.js', () => ({
  encryptSecret: vi.fn(async (value: string) => `encrypted:${value}`),
  getDecryptedSecrets: vi.fn(async () => null),
}));

vi.mock('../../src/integrations/evolution.js', () => ({
  createEvolutionClient: vi.fn(() => evolutionClientMock),
}));

async function buildTenantApp() {
  const app = fastify({ logger: false });

  app.addHook('preHandler', async (request) => {
    request.tenantId = tenantId;
    request.userId = userId;
    request.role = 'OWNER';
  });

  await app.register(tenantRoutes, { prefix: '/v1/tenant' });
  await app.ready();

  return app;
}

function getOpenApiSource() {
  const candidates = [
    resolve(process.cwd(), 'docs/api/openapi.yaml'),
    resolve(process.cwd(), '../../docs/api/openapi.yaml'),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));

  if (!path) {
    throw new Error(`OpenAPI file not found. Checked: ${candidates.join(', ')}`);
  }

  return readFileSync(path, 'utf8');
}

function getOpenApiOperationBlock(source: string, contract: CriticalApiContract) {
  const pathPattern = `  ${contract.path}:`;
  const pathStart = source.indexOf(pathPattern);
  expect(pathStart, `${contract.id}: missing OpenAPI path ${contract.path}`).toBeGreaterThanOrEqual(0);

  const nextPathMatch = source.slice(pathStart + pathPattern.length).match(/\n  \/[^:\n]+:\n/);
  const pathEnd = nextPathMatch?.index === undefined
    ? source.length
    : pathStart + pathPattern.length + nextPathMatch.index;
  const pathBlock = source.slice(pathStart, pathEnd);

  const methodPattern = `    ${contract.method.toLowerCase()}:`;
  const methodStart = pathBlock.indexOf(methodPattern);
  expect(methodStart, `${contract.id}: missing OpenAPI method ${contract.method}`).toBeGreaterThanOrEqual(0);

  const nextMethodMatch = pathBlock.slice(methodStart + methodPattern.length).match(/\n    (get|post|patch|put|delete):\n/);
  const methodEnd = nextMethodMatch?.index === undefined
    ? pathBlock.length
    : methodStart + methodPattern.length + nextMethodMatch.index;

  return pathBlock.slice(methodStart, methodEnd);
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

function seedCriticalContractMocks() {
  prismaMock.conversation.findMany.mockResolvedValue([{ id: 'conversation-1', tenantId }]);
  prismaMock.message.findMany.mockResolvedValue([{ id: 'message-1', tenantId, conversationId: 'conversation-1' }]);
  prismaMock.conversation.findUnique.mockResolvedValue({ id: 'conversation-1', tenantId, aiHandling: false });
  prismaMock.message.create.mockResolvedValue({ id: 'message-2', tenantId, conversationId: 'conversation-1' });
  prismaMock.conversation.update.mockResolvedValue({
    id: 'conversation-1',
    tenantId,
    aiHandling: false,
    status: 'PAUSED',
  });
  prismaMock.script.findMany.mockResolvedValue([{ id: 'script-1', tenantId, variations: [] }]);
  prismaMock.scriptTemplate.findUnique.mockResolvedValue({
    id: templateId,
    name: 'Template',
    category: 'COLD_OUTREACH',
    targetProfession: 'LAWYER',
    flowTemplate: { nodes: [] },
    baseMessageTemplate: 'Base',
    variables: {},
  });
  prismaMock.script.create.mockResolvedValue({ id: 'script-2', tenantId, status: 'DRAFT' });
  prismaMock.script.findUnique.mockResolvedValue({
    id: 'script-1',
    tenantId,
    baseMessage: 'Preview',
    flow: { nodes: [{ id: 'node-1' }] },
    variations: [{ variantLetter: 'A', message: 'Variant A', active: true }],
  });
  prismaMock.script.update.mockResolvedValue({ id: 'script-1', tenantId, name: 'Updated' });
  prismaMock.scriptVariation.upsert.mockResolvedValue({
    id: 'variation-1',
    tenantId,
    scriptId: 'script-1',
    variantLetter: 'A',
  });
  prismaMock.lead.findMany.mockResolvedValue([
    { id: 'lead-1', tenantId, name: 'Contract Lead', whatsapp: '5517998877665', status: 'CAPTURED' },
  ]);
  prismaMock.lead.findFirst.mockResolvedValue({
    id: 'lead-1',
    tenantId,
    whatsapp: '5517998877665',
    status: 'CAPTURED',
    metadata: {},
  });
  prismaMock.lead.findUnique.mockResolvedValue(null);
  prismaMock.lead.create.mockResolvedValue({
    id: 'lead-2',
    tenantId,
    name: 'New Lead',
    whatsapp: '5517998877665',
    status: 'CAPTURED',
  });
  prismaMock.lead.update.mockResolvedValue({
    id: 'lead-1',
    tenantId,
    status: 'ENRICHED',
  });
  prismaMock.leadEvent.create.mockResolvedValue({ id: 'event-1', tenantId, leadId: 'lead-1' });
  prismaMock.optout.upsert.mockResolvedValue({ id: 'optout-1', tenantId, whatsapp: '5517998877665' });
  prismaMock.leadNote.create.mockResolvedValue({ id: 'note-1', tenantId, leadId: 'lead-1', content: 'Good fit' });
  prismaMock.leadNote.findMany.mockResolvedValue([{ id: 'note-1', tenantId, leadId: 'lead-1', content: 'Good fit' }]);
  prismaMock.meeting.count.mockResolvedValue(3);
  prismaMock.meeting.aggregate.mockResolvedValue({
    _sum: {
      policyValueCents: 487000,
      commissionCents: 58440,
    },
    _count: {
      id: 1,
    },
  });
  prismaMock.meeting.findMany.mockResolvedValue([
    { id: meetingId, tenantId, leadId: 'lead-1', status: 'SCHEDULED' },
  ]);
  prismaMock.meeting.findFirst.mockResolvedValue({
    id: meetingId,
    tenantId,
    leadId: 'lead-1',
    scheduledFor: new Date('2026-05-23T13:00:00.000Z'),
    durationMinutes: 30,
    location: 'Google Meet',
  });
  prismaMock.meeting.update.mockResolvedValue({ id: meetingId, tenantId, status: 'HAPPENED' });
  prismaMock.meeting.create.mockResolvedValue({
    id: '33333333-3333-4333-8333-333333333333',
    tenantId,
    leadId: 'lead-1',
    status: 'SCHEDULED',
    scheduledFor: new Date('2026-05-24T13:00:00.000Z'),
  });
  prismaMock.conversation.count.mockResolvedValue(5);
  prismaMock.lead.count.mockResolvedValue(2);
  prismaMock.lead.groupBy.mockResolvedValue([
    { status: 'QUALIFIED', _count: { id: 4 } },
    { status: 'CLOSED_WON', _count: { id: 1 } },
  ]);
  prismaMock.tenantUsage.findUnique.mockResolvedValue({
    llmCostCents: 1200,
    whatsappCostCents: 300,
    googleMapsCostCents: 100,
  });
  prismaMock.tenant.findUnique.mockResolvedValue({ plan: 'STANDARD', slug: 'tenant-contract' });
  prismaMock.tenantSecret.findUnique.mockResolvedValue({
    tenantId,
    evolutionInstanceName: 'tenant_contract',
    evolutionBaseUrl: 'https://evolution.prospix.test',
    evolutionApiKeyEncrypted: null,
    evolutionWebhookSecret: 'webhook-secret',
  });
  prismaMock.tenantSecret.create.mockResolvedValue({
    tenantId,
    evolutionInstanceName: 'tenant_contract',
    evolutionWebhookSecret: 'webhook-secret',
  });
  prismaMock.tenantSecret.update.mockResolvedValue({
    tenantId,
    evolutionInstanceName: 'tenant_contract',
    evolutionWebhookSecret: 'webhook-secret',
  });
  evolutionClientMock.getConnectionState.mockResolvedValue({ ok: true, value: { state: 'open' } });
  evolutionClientMock.createInstance.mockResolvedValue({ ok: true, value: { apikey: 'test-evolution-key' } });
  evolutionClientMock.setWebhook.mockResolvedValue({ ok: true, value: {} });
  evolutionClientMock.getQrCode.mockResolvedValue({ ok: true, value: { base64: 'data:image/png;base64,abc123' } });
  evolutionClientMock.logoutInstance.mockResolvedValue({ ok: true, value: {} });
  evolutionClientMock.deleteInstance.mockResolvedValue({ ok: true, value: {} });
  prismaMock.notificationPreference.findMany.mockResolvedValue([
    { id: 'pref-1', userId, eventType: 'meeting_reminder_1h', channels: ['PUSH'], enabled: true },
  ]);
  prismaMock.notificationPreference.upsert.mockResolvedValue({
    id: 'pref-1',
    userId,
    eventType: 'meeting_reminder_1h',
    channels: ['PUSH', 'EMAIL'],
    enabled: true,
  });
}

function successRequestFor(contract: CriticalApiContract) {
  const url = `/v1${contract.path}`
    .replace('{id}', contract.path.includes('conversations')
      ? 'conversation-1'
      : contract.path.includes('scripts')
        ? 'script-1'
        : contract.path.includes('meetings')
          ? meetingId
          : 'lead-1');

  const payloadById: Record<string, unknown> = {
    'tenant.conversations.messages.create': { content: 'hello' },
    'tenant.conversations.update': { aiHandling: false },
    'tenant.scripts.create': {
      baseMessage: 'Base custom',
      variations: [{ name: 'Variante A', weight: 100, content: 'Mensagem A' }],
    },
    'tenant.scripts.simulate': {
      input: 'Quanto custa?',
      baseMessage: 'Base custom',
      variations: [{ name: 'Variante A', weight: 100, content: 'Mensagem A' }],
    },
    'tenant.scripts.clone': { templateId },
    'tenant.scripts.update': { name: 'Updated', status: 'ACTIVE' },
    'tenant.scripts.variations.upsert': { variantLetter: 'A', message: 'Variant A', weight: 0.5 },
    'tenant.leads.create': { name: 'New Lead', whatsapp: '17998877665', profession: 'DOCTOR' },
    'tenant.leads.update': { status: 'ENRICHED' },
    'tenant.leads.optout': { reason: 'Customer requested stop' },
    'tenant.leads.notes.create': { content: 'Good fit' },
    'tenant.meetings.update': {
      status: 'HAPPENED',
      outcome: 'CLOSED',
      policy_value_cents: 487000,
      commission_cents: 58440,
    },
    'tenant.meetings.reschedule': {
      meetingId,
      newTime: '2026-05-24T13:00:00.000Z',
    },
    'tenant.notifications.preferences.upsert': {
      eventType: 'meeting_reminder_1h',
      channels: ['PUSH', 'EMAIL'],
      enabled: true,
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
  if (contract.id === 'tenant.leads.list') {
    return {
      ...request,
      url: `${request.url}?limit=101`,
      payload: undefined,
    };
  }

  const invalidPayloadById: Record<string, unknown> = {
    'tenant.conversations.messages.create': {},
    'tenant.conversations.update': {},
    'tenant.scripts.create': {},
    'tenant.scripts.simulate': {},
    'tenant.scripts.clone': { templateId: 'invalid-template-id' },
    'tenant.scripts.update': { status: 'INVALID' },
    'tenant.scripts.variations.upsert': {},
    'tenant.leads.create': {},
    'tenant.leads.update': { status: 'INVALID' },
    'tenant.leads.notes.create': {},
    'tenant.meetings.update': { status: 'INVALID' },
    'tenant.meetings.reschedule': { meetingId: 'invalid', newTime: 'invalid' },
    'tenant.notifications.preferences.upsert': { eventType: '', channels: [] },
  };

  return {
    ...request,
    payload: invalidPayloadById[contract.id],
  };
}

describe('AUD-P1-012/AUD-P1-014 tenant contract routes', () => {
  let app: Awaited<ReturnType<typeof buildTenantApp>> | undefined;
  const criticalContracts = CRITICAL_API_CONTRACTS as readonly CriticalApiContract[];
  const tenantContracts = criticalContracts.filter((contract) => contract.path.startsWith('/tenant/'));

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTenantApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('mounts documented conversation routes under /v1/tenant', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([{ id: 'conversation-1', tenantId }]);
    prismaMock.message.findMany.mockResolvedValue([{ id: 'message-1', tenantId, conversationId: 'conversation-1' }]);
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'conversation-1', tenantId, aiHandling: false });
    prismaMock.message.create.mockResolvedValue({ id: 'message-2', tenantId, conversationId: 'conversation-1' });
    prismaMock.conversation.update.mockResolvedValue({
      id: 'conversation-1',
      tenantId,
      aiHandling: false,
      status: 'PAUSED',
    });

    const listResponse = await app!.inject({
      method: 'GET',
      url: '/v1/tenant/conversations',
    });
    const messagesResponse = await app!.inject({
      method: 'GET',
      url: '/v1/tenant/conversations/conversation-1/messages',
    });
    const sendResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/conversations/conversation-1/messages',
      payload: { content: 'hello' },
    });
    const patchResponse = await app!.inject({
      method: 'PATCH',
      url: '/v1/tenant/conversations/conversation-1',
      payload: { aiHandling: false },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(messagesResponse.statusCode).toBe(200);
    expect(sendResponse.statusCode).toBe(201);
    expect(patchResponse.statusCode).toBe(200);
    expect([listResponse, messagesResponse, sendResponse, patchResponse].map((response) => response.statusCode)).not.toContain(404);
    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId } })
    );
    expect(prismaMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, conversationId: 'conversation-1' } })
    );
    expect(createTenantQueueMock).toHaveBeenCalledWith(tenantId, 'send-messages');
    expect(queueAddMock).toHaveBeenCalledWith('send-whatsapp', {
      tenant_id: tenantId,
      conversation_id: 'conversation-1',
      message_id: 'message-2',
    }, {
      jobId: 'send-whatsapp-tenant-contract-1-message-2',
    });
  });

  it('mounts documented script routes under /v1/tenant', async () => {
    prismaMock.script.findMany.mockResolvedValue([{ id: 'script-1', tenantId, variations: [] }]);
    prismaMock.scriptTemplate.findUnique.mockResolvedValue({
      id: templateId,
      name: 'Template',
      category: 'COLD_OUTREACH',
      targetProfession: 'LAWYER',
      flowTemplate: { nodes: [] },
      baseMessageTemplate: 'Base',
      variables: {},
    });
    prismaMock.script.create.mockResolvedValue({ id: 'script-2', tenantId, status: 'DRAFT' });
    prismaMock.script.findUnique.mockResolvedValue({
      id: 'script-1',
      tenantId,
      baseMessage: 'Preview',
      flow: { nodes: [{ id: 'node-1' }] },
      variations: [{ variantLetter: 'A', message: 'Variant A', active: true }],
    });
    prismaMock.script.update.mockResolvedValue({ id: 'script-1', tenantId, name: 'Updated' });
    prismaMock.scriptVariation.upsert.mockResolvedValue({
      id: 'variation-1',
      tenantId,
      scriptId: 'script-1',
      variantLetter: 'A',
    });

    const listResponse = await app!.inject({
      method: 'GET',
      url: '/v1/tenant/scripts',
    });
    const createResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/scripts',
      payload: {
        baseMessage: 'Base custom',
        variations: [{ name: 'Variante A', weight: 100, content: 'Mensagem A' }],
      },
    });
    const simulateResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/scripts/simulate',
      payload: {
        input: 'Quanto custa?',
        baseMessage: 'Base custom',
        variations: [{ name: 'Variante A', weight: 100, content: 'Mensagem A' }],
      },
    });
    const cloneResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/scripts/clone',
      payload: { templateId },
    });
    const patchResponse = await app!.inject({
      method: 'PATCH',
      url: '/v1/tenant/scripts/script-1',
      payload: { name: 'Updated', status: 'ACTIVE' },
    });
    const variationsResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/scripts/script-1/variations',
      payload: { variantLetter: 'A', message: 'Variant A', weight: 0.5 },
    });
    const testResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/scripts/script-1/test',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(simulateResponse.statusCode).toBe(200);
    expect(cloneResponse.statusCode).toBe(201);
    expect(patchResponse.statusCode).toBe(200);
    expect(variationsResponse.statusCode).toBe(201);
    expect(testResponse.statusCode).toBe(200);
    expect([listResponse, createResponse, simulateResponse, cloneResponse, patchResponse, variationsResponse, testResponse].map((response) => response.statusCode)).not.toContain(404);
    expect(prismaMock.script.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, archivedAt: null } })
    );
    expect(prismaMock.script.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          baseMessage: 'Base custom',
          status: 'ACTIVE',
        }),
      })
    );
    expect(prismaMock.script.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          clonedFromTemplateId: templateId,
        }),
      })
    );
    expect(prismaMock.scriptVariation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tenantId,
          scriptId: 'script-1',
          variantLetter: 'A',
        }),
      })
    );
  });

  it('keeps shared-types critical contracts in sync with OpenAPI', () => {
    const source = getOpenApiSource();

    for (const contract of criticalContracts) {
      const operation = getOpenApiOperationBlock(source, contract);

      expect(operation, `${contract.id}: missing success status ${contract.successStatus}`)
        .toContain(`'${contract.successStatus}':`);
      expect(operation, `${contract.id}: missing response shape extension`)
        .toContain(`x-prospix-response-shape: ${contract.successShape}`);

      if (contract.validationErrorShape) {
        expect(operation, `${contract.id}: missing error shape extension`)
          .toContain(`x-prospix-error-shape: ${contract.validationErrorShape}`);
      }
    }
  });

  it('keeps critical success and validation envelopes in sync with shared-types', async () => {
    seedCriticalContractMocks();

    for (const contract of tenantContracts) {
      const response = await app!.inject(successRequestFor(contract) as any);

      expect(response.statusCode, contract.id).toBe(contract.successStatus);
      expectResponseShape(parsePayload(response.payload), contract.successShape);
    }

    for (const contract of tenantContracts) {
      if (!contract.validationErrorStatus || !contract.validationErrorShape) {
        continue;
      }

      const response = await app!.inject(validationRequestFor(contract) as any);

      expect(response.statusCode, contract.id).toBe(contract.validationErrorStatus);
      expectErrorShape(parsePayload(response.payload), contract.validationErrorShape);
    }
  });

  it('does not expose external OAuth or Evolution messages in integration responses', async () => {
    seedCriticalContractMocks();
    const sensitiveMessage = 'database password leaked from provider';

    const callbackResponse = await app!.inject({
      method: 'GET',
      url: `/v1/tenant/integrations/google/callback?error=${encodeURIComponent(sensitiveMessage)}`,
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe('https://app.prospix.test/dashboard/integrations?google=error');

    evolutionClientMock.getConnectionState.mockResolvedValueOnce({
      ok: false,
      error: new Error(sensitiveMessage),
    });
    const statusResponse = await app!.inject({
      method: 'GET',
      url: '/v1/tenant/integrations/whatsapp/status',
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.payload).toContain('CONNECTION_STATE_UNAVAILABLE');
    expect(statusResponse.payload).not.toContain(sensitiveMessage);

    evolutionClientMock.getQrCode.mockResolvedValueOnce({
      ok: false,
      error: new Error(sensitiveMessage),
    });
    const connectResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/integrations/whatsapp/connect',
    });

    expect(connectResponse.statusCode).toBe(500);
    expect(connectResponse.payload).toContain('QR_CODE_UNAVAILABLE');
    expect(connectResponse.payload).not.toContain(sensitiveMessage);

    prismaMock.tenantSecret.findUnique.mockRejectedValueOnce(new Error(sensitiveMessage));
    const disconnectResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/integrations/whatsapp/disconnect',
    });

    expect(disconnectResponse.statusCode).toBe(500);
    expect(disconnectResponse.payload).toContain('Failed to process WhatsApp integration request');
    expect(disconnectResponse.payload).not.toContain(sensitiveMessage);
  });
});
