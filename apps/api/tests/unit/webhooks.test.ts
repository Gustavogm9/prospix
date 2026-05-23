import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import {
  CRITICAL_API_CONTRACTS,
  type ApiErrorShape,
  type ApiResponseShape,
  type CriticalApiContract,
} from '@prospix/shared-types/api';

const tenantSecretFindFirstMock = vi.hoisted(() => vi.fn());
const messageFindUniqueMock = vi.hoisted(() => vi.fn());
const leadFindUniqueMock = vi.hoisted(() => vi.fn());
const leadCreateMock = vi.hoisted(() => vi.fn());
const conversationFindFirstMock = vi.hoisted(() => vi.fn());
const conversationCreateMock = vi.hoisted(() => vi.fn());
const tenantBillingFindFirstMock = vi.hoisted(() => vi.fn());
const tenantBillingUpdateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const queueAddMock = vi.hoisted(() => vi.fn());
const createTenantQueueMock = vi.hoisted(() => vi.fn(() => ({ add: queueAddMock })));
const validateEvolutionWebhookSignatureMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
  },
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    tenantSecret: {
      findFirst: tenantSecretFindFirstMock,
    },
    message: {
      findUnique: messageFindUniqueMock,
    },
    lead: {
      findUnique: leadFindUniqueMock,
      create: leadCreateMock,
    },
    conversation: {
      findFirst: conversationFindFirstMock,
      create: conversationCreateMock,
    },
    tenantBilling: {
      findFirst: tenantBillingFindFirstMock,
      update: tenantBillingUpdateMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('../../src/lib/queue.js', () => ({
  createTenantQueue: createTenantQueueMock,
}));

vi.mock('../../src/lib/tenant-context-storage.js', () => ({
  tenantContextStorage: {
    run: vi.fn((_ctx, callback) => callback()),
  },
}));

vi.mock('../../src/integrations/evolution.js', () => ({
  validateEvolutionWebhookSignature: validateEvolutionWebhookSignatureMock,
}));

vi.mock('../../src/config/env.js', () => ({
  env: {
    ASAAS_WEBHOOK_SECRET: 'asaas-secret',
  },
}));

describe('Webhook routes hardening', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    transactionMock.mockImplementation(async (callback) => callback({}));
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  function parsePayload(payload: string) {
    return payload ? JSON.parse(payload) : undefined;
  }

  function expectResponseShape(body: unknown, shape: ApiResponseShape) {
    if (shape === 'raw-object') {
      expect(body).toEqual(expect.any(Object));
      expect(Array.isArray(body)).toBe(false);
      expect(body).not.toHaveProperty('data');
      return;
    }

    throw new Error(`Unsupported webhook response shape in test: ${shape}`);
  }

  function expectErrorShape(body: unknown, shape: ApiErrorShape) {
    if (shape === 'flat-error') {
      expect(body).toEqual(expect.objectContaining({
        error: expect.any(String),
        message: expect.any(String),
      }));
      return;
    }

    throw new Error(`Unsupported webhook error shape in test: ${shape}`);
  }

  function successRequestFor(contract: CriticalApiContract) {
    if (contract.id === 'webhooks.evolution.unified') {
      return {
        method: contract.method,
        url: `/v1${contract.path}`,
        payload: { event: 'instance.update' },
      };
    }

    return {
      method: contract.method,
      url: `/v1${contract.path}`,
      headers: {
        'asaas-access-token': 'asaas-secret',
      },
      payload: {
        event: 'PAYMENT_OVERDUE',
        payment: {
          id: 'pay-001',
        },
      },
    };
  }

  function validationRequestFor(contract: CriticalApiContract) {
    return {
      method: contract.method,
      url: `/v1${contract.path}`,
      headers: {
        'asaas-access-token': 'asaas-secret',
      },
      payload: {
        event: 'PAYMENT_OVERDUE',
      },
    };
  }

  it('rejects Evolution webhooks without tenant HMAC secret in production', async () => {
    process.env.NODE_ENV = 'production';
    tenantSecretFindFirstMock.mockResolvedValue({
      tenantId: 'tenant-001',
      evolutionWebhookSecret: null,
    });

    const { evolutionWebhookRoutes } = await import('../../src/routes/webhooks/evolution.js');
    const app = fastify({ logger: false });
    await app.register(evolutionWebhookRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: {
        event: 'messages.upsert',
        instance: 'instance-001',
        data: {
          key: {
            id: 'wamid-001',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false,
          },
          pushName: 'Lead Teste',
          message: {
            conversation: 'oi',
          },
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(validateEvolutionWebhookSignatureMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('enqueues Evolution inbound messages with a deterministic external jobId', async () => {
    process.env.NODE_ENV = 'test';
    tenantSecretFindFirstMock.mockResolvedValue({
      tenantId: 'tenant-001',
      evolutionWebhookSecret: 'webhook-secret',
    });
    validateEvolutionWebhookSignatureMock.mockReturnValue(true);
    messageFindUniqueMock.mockResolvedValue(null);
    leadFindUniqueMock.mockResolvedValue({
      id: 'lead-001',
      tenantId: 'tenant-001',
      whatsapp: '5511999999999',
    });
    conversationFindFirstMock.mockResolvedValue({
      id: 'conversation-001',
      tenantId: 'tenant-001',
      leadId: 'lead-001',
    });

    const { evolutionWebhookRoutes } = await import('../../src/routes/webhooks/evolution.js');
    const app = fastify({ logger: false });
    await app.register(evolutionWebhookRoutes);

    const payload = {
      event: 'messages.upsert',
      instance: 'instance-001',
      data: {
        key: {
          id: 'wamid-001',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        pushName: 'Lead Teste',
        message: {
          conversation: 'oi',
        },
      },
    };

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/',
      headers: {
        'x-evolution-signature': 'valid-signature',
      },
      payload,
    });
    const firstJobOptions = queueAddMock.mock.calls[0]?.[2];

    queueAddMock.mockClear();
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/',
      headers: {
        'x-evolution-signature': 'valid-signature',
      },
      payload,
    });
    const secondJobOptions = queueAddMock.mock.calls[0]?.[2];

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstJobOptions).toMatchObject({
      jobId: expect.stringMatching(/^external-evolution-[a-f0-9]{32}$/),
    });
    expect(secondJobOptions).toEqual(firstJobOptions);

    await app.close();
  });

  it('enqueues Asaas overdue suspension checks with a deterministic external jobId', async () => {
    tenantBillingFindFirstMock.mockResolvedValue({
      id: 'billing-001',
      tenantId: 'tenant-001',
    });
    tenantBillingUpdateMock.mockResolvedValue({});

    const { webhookRoutes } = await import('../../src/routes/webhooks/index.js');
    const app = fastify({ logger: false });
    await app.register(webhookRoutes);

    const payload = {
      event: 'PAYMENT_OVERDUE',
      payment: {
        id: 'pay-001',
      },
    };

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/asaas',
      headers: {
        'asaas-access-token': 'asaas-secret',
      },
      payload,
    });
    const firstJobOptions = queueAddMock.mock.calls[0]?.[2];

    queueAddMock.mockClear();
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/asaas',
      headers: {
        'asaas-access-token': 'asaas-secret',
      },
      payload,
    });
    const secondJobOptions = queueAddMock.mock.calls[0]?.[2];

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstJobOptions).toMatchObject({
      delay: 14 * 24 * 60 * 60 * 1000,
      jobId: expect.stringMatching(/^external-asaas-[a-f0-9]{32}$/),
    });
    expect(secondJobOptions).toEqual(firstJobOptions);

    await app.close();
  });

  it('keeps critical webhook envelopes in sync with shared-types', async () => {
    tenantBillingFindFirstMock.mockResolvedValue({
      id: 'billing-001',
      tenantId: 'tenant-001',
    });
    tenantBillingUpdateMock.mockResolvedValue({});

    const { webhookRoutes } = await import('../../src/routes/webhooks/index.js');
    const { evolutionWebhookRoutes } = await import('../../src/routes/webhooks/evolution.js');
    const app = fastify({ logger: false });
    await app.register(webhookRoutes, { prefix: '/v1/webhooks' });
    await app.register(evolutionWebhookRoutes, { prefix: '/v1/webhooks/evolution' });

    const webhookContracts = (CRITICAL_API_CONTRACTS as readonly CriticalApiContract[])
      .filter((contract) => contract.path.startsWith('/webhooks/'));

    for (const contract of webhookContracts) {
      const response = await app.inject(successRequestFor(contract) as any);

      expect(response.statusCode, contract.id).toBe(contract.successStatus);
      expectResponseShape(parsePayload(response.payload), contract.successShape);
    }

    for (const contract of webhookContracts) {
      if (!contract.validationErrorStatus || !contract.validationErrorShape) {
        continue;
      }

      const response = await app.inject(validationRequestFor(contract) as any);

      expect(response.statusCode, contract.id).toBe(contract.validationErrorStatus);
      expectErrorShape(parsePayload(response.payload), contract.validationErrorShape);
    }

    await app.close();
  });
});
