import '../../src/config/env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { QueueEvents, Worker } from 'bullmq';
import { evolutionWebhookRoutes } from '../../src/routes/webhooks/evolution.js';
import { createTenantQueue, getTenantQueueName } from '../../src/lib/queue.js';
import { createDedicatedRedisConnection, redis } from '../../src/lib/redis.js';
import { ProcessInboundWorker } from '../../src/workers/process-inbound.js';

vi.mock('../../src/ai/classifier.js', () => ({
  classifyIntent: vi.fn(async () => ({
    intent: 'off_topic',
    confidence: 0.8,
    rationale: 'audit fixture',
  })),
}));

const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';
const requireRedisEvidence = process.env.AUDIT_REQUIRE_REDIS === '1' || process.env.CI === 'true';

const db = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

let dbAvailable = true;
let redisAvailable = true;
const cleanupTasks: Array<() => Promise<void>> = [];

function auditId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function waitForCompletedJob(events: QueueEvents): Promise<{ jobId: string; returnvalue: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for BullMQ completed event'));
    }, 10_000);

    events.once('completed', ({ jobId, returnvalue }) => {
      clearTimeout(timeout);
      resolve({ jobId, returnvalue });
    });
  });
}

async function seedWebhookFixture(seed: string) {
  const tenant = await db.tenant.create({
    data: {
      slug: `audit-evolution-${seed}`,
      name: `Audit Evolution ${seed}`,
      status: 'ACTIVE',
      plan: 'STARTER',
      mrrCents: 0,
      highValueAreas: [],
    },
  });

  const instanceName = `audit-evolution-${seed}`;
  const webhookSecret = `secret-${seed}`;
  const whatsapp = `55119${seed.replace(/\D/g, '').slice(-8).padStart(8, '0')}`;

  const { lead, conversation } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

    await tx.tenantSecret.create({
      data: {
        tenantId: tenant.id,
        evolutionBaseUrl: 'https://evolution.audit.test',
        evolutionInstanceName: instanceName,
        evolutionWebhookSecret: webhookSecret,
      },
    });

    const lead = await tx.lead.create({
      data: {
        tenantId: tenant.id,
        whatsapp,
        name: 'Lead Auditor',
        source: 'MANUAL',
        status: 'CONTACTED',
      },
    });

    const conversation = await tx.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        status: 'ACTIVE',
        aiHandling: false,
      },
    });

    return { lead, conversation };
  });

  cleanupTasks.push(async () => {
    await db.tenant.deleteMany({ where: { id: tenant.id } });
  });

  return { tenant, instanceName, webhookSecret, whatsapp, lead, conversation };
}

describe('AUD-P1-022 Evolution webhook idempotency with real DB and Redis', () => {
  beforeAll(async () => {
    try {
      await db.$connect();
      await db.$queryRaw`SELECT 1`;
    } catch (err) {
      dbAvailable = false;
      if (requireDbEvidence) {
        throw new Error(`Postgres unavailable for AUD-P1-022 DB-backed evidence: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      await redis.ping();
    } catch (err) {
      redisAvailable = false;
      if (requireRedisEvidence) {
        throw new Error(`Redis unavailable for AUD-P1-022 Redis-backed evidence: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  afterEach(async () => {
    while (cleanupTasks.length > 0) {
      const cleanup = cleanupTasks.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('deduplicates concurrent Evolution inbound webhooks and persists one inbound message', async (context) => {
    if (!dbAvailable || !redisAvailable) {
      context.skip();
      return;
    }

    const seed = auditId();
    const { tenant, instanceName, webhookSecret, whatsapp, conversation } = await seedWebhookFixture(seed);
    const queueName = getTenantQueueName(tenant.id, 'process-inbound');
    const queue = createTenantQueue(tenant.id, 'process-inbound', {
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    const eventsConnection = createDedicatedRedisConnection();
    const workerConnection = createDedicatedRedisConnection();
    const events = new QueueEvents(queueName, { connection: eventsConnection });
    const inboundWorker = new ProcessInboundWorker();
    const worker = new Worker(
      queueName,
      async (job) => inboundWorker.run(job as any),
      { connection: workerConnection, concurrency: 5 }
    );

    cleanupTasks.push(async () => {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      eventsConnection.disconnect();
      workerConnection.disconnect();
    });

    await queue.obliterate({ force: true });
    await events.waitUntilReady();
    await worker.waitUntilReady();

    const messageId = `wamid.audit.${seed}`;
    const body = {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: {
          id: messageId,
          remoteJid: `${whatsapp}@s.whatsapp.net`,
          fromMe: false,
        },
        pushName: 'Lead Auditor',
        message: {
          conversation: 'Oi, quero entender melhor.',
        },
      },
    };
    const payload = JSON.stringify(body);
    const completedJobPromise = waitForCompletedJob(events);

    const app = fastify({ logger: false });
    await app.register(evolutionWebhookRoutes);
    cleanupTasks.push(async () => {
      await app.close();
    });

    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/',
        headers: {
          'content-type': 'application/json',
          'x-evolution-signature': signPayload(payload, webhookSecret),
        },
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/',
        headers: {
          'content-type': 'application/json',
          'x-evolution-signature': signPayload(payload, webhookSecret),
        },
        payload,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toMatch(/^external-evolution-[a-f0-9]{32}$/);

    const completedJob = await completedJobPromise;
    expect(completedJob.jobId).toBe(jobs[0]?.id);

    const persistedState = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      const messages = await tx.message.findMany({
        where: {
          tenantId: tenant.id,
          whatsappMessageId: messageId,
        },
      });
      const refreshedConversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });

      return { messages, refreshedConversation };
    });

    expect(persistedState.messages).toHaveLength(1);
    expect(persistedState.messages[0]).toMatchObject({
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: 'INBOUND',
      content: 'Oi, quero entender melhor.',
    });
    expect(persistedState.refreshedConversation.messageCount).toBe(1);
    expect(persistedState.refreshedConversation.lastInboundAt).toBeInstanceOf(Date);
  });
});
