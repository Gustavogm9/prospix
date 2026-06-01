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
const conversationId = '33333333-3333-4333-8333-333333333333';
const scriptId = '44444444-4444-4444-8444-444444444444';
const leadId = '55555555-5555-4555-8555-555555555555';

const supabaseMock = vi.hoisted(() => {
  const chainable = () => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  return {
    from: vi.fn(() => chainable()),
  };
});

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

vi.mock('../../src/lib/supabase.js', () => ({
  supabaseAdmin: supabaseMock,
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

async function buildTenantApp(role = 'OWNER') {
  const app = fastify({ logger: false });

  app.addHook('preHandler', async (request) => {
    request.tenantId = tenantId;
    request.userId = userId;
    request.role = role;
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
  (supabaseMock.from as any).mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: conversationId, tenant_id: tenantId }],
          error: null,
        }),
        range: vi.fn().mockResolvedValue({
          data: [{ id: conversationId, tenant_id: tenantId }],
          error: null,
        }),
        single: vi.fn().mockResolvedValue({
          data: { id: conversationId, tenant_id: tenantId, ai_handling: false },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: conversationId, tenant_id: tenantId, ai_handling: false },
          error: null,
        }),
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
      } as any;
    }
    if (table === 'messages') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: 'message-1', tenant_id: tenantId, conversation_id: conversationId }],
          error: null,
        }),
        range: vi.fn().mockResolvedValue({
          data: [{ id: 'message-1', tenant_id: tenantId, conversation_id: conversationId }],
          error: null,
        }),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'message-2', tenant_id: tenantId, conversation_id: conversationId },
          error: null,
        }),
      } as any;
    }
    if (table === 'scripts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: scriptId, tenant_id: tenantId, script_variations: [] }],
          error: null,
        }),
        range: vi.fn().mockResolvedValue({
          data: [{ id: scriptId, tenant_id: tenantId, script_variations: [] }],
          error: null,
        }),
        single: vi.fn().mockResolvedValue({
          data: {
            id: scriptId,
            tenant_id: tenantId,
            base_message: 'Preview',
            flow: { nodes: [{ id: 'node-1' }] },
            script_variations: [{ variant_letter: 'A', message: 'Variant A', active: true }],
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: scriptId,
            tenant_id: tenantId,
            base_message: 'Preview',
            flow: { nodes: [{ id: 'node-1' }] },
            script_variations: [{ variant_letter: 'A', message: 'Variant A', active: true }],
          },
          error: null,
        }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
      } as any;
    }
    if (table === 'script_templates') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: templateId,
            name: 'Template',
            category: 'COLD_OUTREACH',
            target_profession: 'LAWYER',
            flow_template: { nodes: [] },
            base_message_template: 'Base',
            variables: {},
          },
          error: null,
        }),
      } as any;
    }
    if (table === 'script_variations') {
      return {
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'variation-1',
            tenant_id: tenantId,
            script_id: scriptId,
            variant_letter: 'A',
          },
          error: null,
        }),
      } as any;
    }
    if (table === 'leads') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: leadId, tenant_id: tenantId, name: 'Contract Lead', whatsapp: '5517998877665', status: 'CAPTURED' }],
          error: null,
        }),
        range: vi.fn().mockResolvedValue({
          data: [{ id: leadId, tenant_id: tenantId, name: 'Contract Lead', whatsapp: '5517998877665', status: 'CAPTURED' }],
          error: null,
        }),
        single: vi.fn().mockResolvedValue({
          data: {
            id: leadId,
            tenant_id: tenantId,
            whatsapp: '5517998877665',
            status: 'CAPTURED',
            metadata: {},
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: leadId,
            tenant_id: tenantId,
            whatsapp: '5517998877665',
            status: 'CAPTURED',
            metadata: {},
          },
          error: null,
        }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
      } as any;
    }
    if (table === 'lead_events') {
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'event-1', tenant_id: tenantId, lead_id: leadId },
          error: null,
        }),
      } as any;
    }
    if (table === 'optouts') {
      return {
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'optout-1', tenant_id: tenantId, whatsapp: '5517998877665' },
          error: null,
        }),
      } as any;
    }
    if (table === 'lead_notes') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{ id: 'note-1', tenant_id: tenantId, lead_id: leadId, content: 'Good fit' }],
          error: null,
        }),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'note-1', tenant_id: tenantId, lead_id: leadId, content: 'Good fit' },
          error: null,
        }),
      } as any;
    }
    if (table === 'meetings') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ id: meetingId, tenant_id: tenantId, lead_id: leadId, status: 'SCHEDULED' }],
          error: null,
          count: 3,
        }),
        range: vi.fn().mockResolvedValue({
          data: [{ id: meetingId, tenant_id: tenantId, lead_id: leadId, status: 'SCHEDULED' }],
          error: null,
        }),
        single: vi.fn().mockResolvedValue({
          data: {
            id: meetingId,
            tenant_id: tenantId,
            lead_id: leadId,
            scheduled_for: new Date('2026-05-23T13:00:00.000Z').toISOString(),
            duration_minutes: 30,
            location: 'Google Meet',
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: meetingId,
            tenant_id: tenantId,
            lead_id: leadId,
            scheduled_for: new Date('2026-05-23T13:00:00.000Z').toISOString(),
            duration_minutes: 30,
            location: 'Google Meet',
          },
          error: null,
        }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
      } as any;
    }
    if (table === 'tenants') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: tenantId,
            name: 'Contract Tenant',
            plan: 'STANDARD',
            mrr_cents: 15000,
            status: 'ACTIVE',
            slug: 'tenant-contract',
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: tenantId,
            name: 'Contract Tenant',
            plan: 'STANDARD',
            mrr_cents: 15000,
            status: 'ACTIVE',
            slug: 'tenant-contract',
          },
          error: null,
        }),
      } as any;
    }
    if (table === 'users') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: userId,
            tenant_id: tenantId,
            name: 'Old Name',
            email: 'old@example.com',
            susep: null,
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
        update: vi.fn().mockReturnThis(),
      } as any;
    }
    if (table === 'tenant_secrets') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            tenant_id: tenantId,
            evolution_instance_name: 'tenant_contract',
            evolution_base_url: 'https://evolution.prospix.test',
            evolution_api_key_encrypted: null,
            evolution_webhook_secret: 'webhook-secret',
          },
          error: null,
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            tenant_id: tenantId,
            evolution_instance_name: 'tenant_contract',
            evolution_base_url: 'https://evolution.prospix.test',
            evolution_api_key_encrypted: null,
            evolution_webhook_secret: 'webhook-secret',
          },
          error: null,
        }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
      } as any;
    }
    if (table === 'tenant_usage') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            llm_cost_cents: 1200,
            whatsapp_cost_cents: 300,
            google_maps_cost_cents: 100,
          },
          error: null,
        }),
      } as any;
    }
    if (table === 'tenant_billing') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'billing-1',
              tenant_id: tenantId,
              period_month: new Date('2026-05-01T00:00:00.000Z').toISOString(),
              mrr_cents: 15000,
              excess_cents: 1600,
              total_cents: 16600,
              status: 'PENDING',
              paid_at: null,
              due_at: new Date('2026-05-10T00:00:00.000Z').toISOString(),
              invoice_url: 'https://asaas.prospix.test/invoices/billing-1',
              payment_method: 'pix',
              external_invoice_id: 'asaas-1',
            },
          ],
          error: null,
        }),
      } as any;
    }
    if (table === 'notification_preferences') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            { id: 'pref-1', user_id: userId, event_type: 'meeting_reminder_1h', channels: ['PUSH'], enabled: true },
          ],
          error: null,
        }),
        upsert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'pref-1',
            user_id: userId,
            event_type: 'meeting_reminder_1h',
            channels: ['PUSH', 'EMAIL'],
            enabled: true,
          },
          error: null,
        }),
      } as any;
    }
    // Default fallback
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any;
  });

  evolutionClientMock.getConnectionState.mockResolvedValue({ ok: true, value: { state: 'open' } });
  evolutionClientMock.createInstance.mockResolvedValue({ ok: true, value: { apikey: 'test-evolution-key' } });
  evolutionClientMock.setWebhook.mockResolvedValue({ ok: true, value: {} });
  evolutionClientMock.getQrCode.mockResolvedValue({ ok: true, value: { base64: 'data:image/png;base64,abc123' } });
  evolutionClientMock.logoutInstance.mockResolvedValue({ ok: true, value: {} });
  evolutionClientMock.deleteInstance.mockResolvedValue({ ok: true, value: {} });
}

function successRequestFor(contract: CriticalApiContract) {
  const url = `/v1${contract.path}`
    .replace('{id}', contract.path.includes('conversations')
      ? conversationId
      : contract.path.includes('scripts')
        ? scriptId
        : contract.path.includes('meetings')
          ? meetingId
          : leadId);

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
    seedCriticalContractMocks();

    const listResponse = await app!.inject({
      method: 'GET',
      url: '/v1/tenant/conversations',
    });
    const messagesResponse = await app!.inject({
      method: 'GET',
      url: `/v1/tenant/conversations/${conversationId}/messages`,
    });
    const sendResponse = await app!.inject({
      method: 'POST',
      url: `/v1/tenant/conversations/${conversationId}/messages`,
      payload: { content: 'hello' },
    });
    const patchResponse = await app!.inject({
      method: 'PATCH',
      url: `/v1/tenant/conversations/${conversationId}`,
      payload: { aiHandling: false },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(messagesResponse.statusCode).toBe(200);
    expect(sendResponse.statusCode).toBe(201);
    expect(patchResponse.statusCode).toBe(200);
    expect([listResponse, messagesResponse, sendResponse, patchResponse].map((response) => response.statusCode)).not.toContain(404);
    expect(supabaseMock.from).toHaveBeenCalledWith('conversations');
    expect(supabaseMock.from).toHaveBeenCalledWith('messages');
    expect(createTenantQueueMock).toHaveBeenCalledWith(tenantId, 'send-messages');
    expect(queueAddMock).toHaveBeenCalledWith('send-whatsapp', {
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_id: 'message-2',
    }, {
      jobId: 'send-whatsapp-tenant-contract-1-message-2',
    });
  });

  it('mounts documented script routes under /v1/tenant', async () => {
    seedCriticalContractMocks();

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
      url: `/v1/tenant/scripts/${scriptId}`,
      payload: { name: 'Updated', status: 'ACTIVE' },
    });
    const variationsResponse = await app!.inject({
      method: 'POST',
      url: `/v1/tenant/scripts/${scriptId}/variations`,
      payload: { variantLetter: 'A', message: 'Variant A', weight: 0.5 },
    });
    const testResponse = await app!.inject({
      method: 'POST',
      url: `/v1/tenant/scripts/${scriptId}/test`,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(simulateResponse.statusCode).toBe(200);
    expect(cloneResponse.statusCode).toBe(201);
    expect(patchResponse.statusCode).toBe(200);
    expect(variationsResponse.statusCode).toBe(201);
    expect(testResponse.statusCode).toBe(200);
    expect([listResponse, createResponse, simulateResponse, cloneResponse, patchResponse, variationsResponse, testResponse].map((response) => response.statusCode)).not.toContain(404);
    expect(supabaseMock.from).toHaveBeenCalledWith('scripts');
    expect(supabaseMock.from).toHaveBeenCalledWith('script_templates');
    expect(supabaseMock.from).toHaveBeenCalledWith('script_variations');
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

    // For disconnect, mock the supabase query to reject with sensitive error
    (supabaseMock.from as any).mockImplementationOnce((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockRejectedValue(new Error(sensitiveMessage)),
      maybeSingle: vi.fn().mockRejectedValue(new Error(sensitiveMessage)),
    }) as any);

    const disconnectResponse = await app!.inject({
      method: 'POST',
      url: '/v1/tenant/integrations/whatsapp/disconnect',
    });

    expect(disconnectResponse.statusCode).toBe(500);
    expect(disconnectResponse.payload).toContain('Failed to process WhatsApp integration request');
    expect(disconnectResponse.payload).not.toContain(sensitiveMessage);
  });

  it('persists tenant credentials encrypted without exposing plaintext', async () => {
    (supabaseMock.from as any).mockImplementation((table: string) => {
      if (table === 'tenant_secrets') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              tenant_id: tenantId,
              ai_provider: 'TENANT_OWN',
              evolution_base_url: null,
              evolution_instance_name: null,
              evolution_api_key_encrypted: null,
              evolution_webhook_secret: null,
              google_calendar_id: null,
              google_oauth_refresh_encrypted: null,
              google_oauth_scope: null,
              google_maps_api_key_encrypted: null,
              openai_api_key_encrypted: 'encrypted:sk-real-openai-key',
              anthropic_api_key_encrypted: null,
              google_ai_api_key_encrypted: null,
              updated_at: new Date('2026-05-23T12:00:00.000Z').toISOString(),
            },
            error: null,
          }),
        } as any;
      }
      // Default
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const response = await app!.inject({
      method: 'PATCH',
      url: '/v1/tenant/integrations/credentials',
      payload: {
        aiProvider: 'TENANT_OWN',
        openaiApiKey: 'sk-real-openai-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(supabaseMock.from).toHaveBeenCalledWith('tenant_secrets');
    expect(response.payload).toContain('"configured":true');
    expect(response.payload).not.toContain('sk-real-openai-key');
    expect(response.payload).not.toContain('encrypted:');
  });

  it('blocks assistant users from changing tenant credentials', async () => {
    await app!.close();
    app = await buildTenantApp('ASSISTANT');

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/tenant/integrations/credentials',
      payload: {
        openaiApiKey: 'sk-assistant-should-not-save',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(supabaseMock.from).not.toHaveBeenCalledWith('tenant_secrets');
    expect(response.payload).not.toContain('sk-assistant-should-not-save');
  });

  it('persists profile changes for the authenticated tenant user', async () => {
    (supabaseMock.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn()
            .mockResolvedValueOnce({
              data: {
                id: userId,
                tenant_id: tenantId,
                name: 'Old Name',
                email: 'old@example.com',
                susep: null,
              },
              error: null,
            })
            .mockResolvedValueOnce({
              data: null, // email uniqueness check
              error: null,
            })
            .mockResolvedValueOnce({
              data: {
                id: userId,
                name: 'New Name',
                email: 'new@example.com',
                whatsapp: '+5511999999999',
                susep: 'SUSEP-123',
                role: 'OWNER',
              },
              error: null,
            }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
          update: vi.fn().mockReturnThis(),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const response = await app!.inject({
      method: 'PATCH',
      url: '/v1/tenant/profile',
      payload: {
        name: 'New Name',
        email: 'new@example.com',
        susep: 'SUSEP-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(supabaseMock.from).toHaveBeenCalledWith('users');
    expect(parsePayload(response.payload).data).toEqual(expect.objectContaining({
      name: 'New Name',
      email: 'new@example.com',
      susep: 'SUSEP-123',
    }));
  });

  it('returns tenant billing from persisted usage and invoices', async () => {
    (supabaseMock.from as any).mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: tenantId,
              name: 'Contract Tenant',
              plan: 'STANDARD',
              mrr_cents: 15000,
              status: 'ACTIVE',
            },
            error: null,
          }),
        } as any;
      }
      if (table === 'tenant_usage') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              llm_tokens_input: '12000',
              llm_tokens_output: '6000',
              llm_cost_cents: 1200,
              whatsapp_messages_sent: 40,
              whatsapp_cost_cents: 300,
              google_maps_calls: 10,
              google_maps_cost_cents: 100,
              conversations_started: 8,
              meetings_scheduled: 3,
            },
            error: null,
          }),
        } as any;
      }
      if (table === 'tenant_billing') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'billing-1',
                tenant_id: tenantId,
                period_month: new Date('2026-05-01T00:00:00.000Z').toISOString(),
                mrr_cents: 15000,
                excess_cents: 1600,
                total_cents: 16600,
                status: 'PENDING',
                paid_at: null,
                due_at: new Date('2026-05-10T00:00:00.000Z').toISOString(),
                invoice_url: 'https://asaas.prospix.test/invoices/billing-1',
                payment_method: 'pix',
                external_invoice_id: 'asaas-1',
              },
            ],
            error: null,
          }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any;
    });

    const response = await app!.inject({
      method: 'GET',
      url: '/v1/tenant/billing',
    });

    const body = parsePayload(response.payload);

    expect(response.statusCode).toBe(200);
    expect(supabaseMock.from).toHaveBeenCalledWith('tenants');
    expect(supabaseMock.from).toHaveBeenCalledWith('tenant_billing');
    expect(body.data.tenant).toEqual(expect.objectContaining({
      id: tenantId,
      plan: 'STANDARD',
      planName: 'Standard',
      mrrCents: 15000,
    }));
    expect(body.data.usage).toEqual(expect.objectContaining({
      llmTokensInput: 12000,
      llmTokensOutput: 6000,
      whatsappMessagesSent: 40,
    }));
    expect(body.data.currentInvoice).toEqual(expect.objectContaining({
      id: 'billing-1',
      totalCents: 16600,
      status: 'PENDING',
      invoiceUrl: 'https://asaas.prospix.test/invoices/billing-1',
    }));
  });
});
