import '../multi-tenant/use-restricted-db.js';
import '../../src/config/env.js';
import fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { authRoutes } from '../../src/routes/auth/index.js';

const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';

const db = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

let dbAvailable = true;
let brokerUserId: string | null = null;

async function findSeedBroker() {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
    return tx.user.findFirst({
      where: {
        email: 'giovane@seed.prospix.dev',
        role: 'OWNER',
      },
      select: { id: true },
    });
  });
}

describe('AUD-P1-018 broker email/password login with RLS-backed database', () => {
  beforeAll(async () => {
    try {
      await db.$connect();
      await db.$queryRaw`SELECT 1`;
      const broker = await findSeedBroker();
      brokerUserId = broker?.id ?? null;

      if (!brokerUserId && requireDbEvidence) {
        throw new Error('Seed broker user (giovane@seed.prospix.dev) not found for DB-backed broker-login evidence');
      }
    } catch (err) {
      dbAvailable = false;
      if (requireDbEvidence) {
        throw new Error(`Postgres unavailable for broker-login RLS evidence: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  afterAll(async () => {
    if (brokerUserId) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
        await tx.session.deleteMany({ where: { userId: brokerUserId! } });
      });
    }

    await db.$disconnect();
  });

  it('authenticates a broker with correct email and password', async (context) => {
    if (!dbAvailable || !brokerUserId) {
      context.skip();
      return;
    }

    const app = fastify({ logger: false });
    await app.register(fastifyJwt, { secret: 'broker-login-rls-test-secret' });
    await app.register(authRoutes, { prefix: '/v1/auth' });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'giovane@seed.prospix.dev',
        password: process.env.SEED_ADMIN_PASSWORD || 'super-secret-password-123',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(body.user).toEqual(expect.objectContaining({
      id: brokerUserId,
      tenant_id: '11111111-1111-1111-1111-111111111111',
      email: 'giovane@seed.prospix.dev',
      role: 'OWNER',
    }));

    const sessionCount = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
      return tx.session.count({ where: { userId: brokerUserId! } });
    });
    expect(sessionCount).toBeGreaterThan(0);
  });

  it('rejects authentication if the password is incorrect', async (context) => {
    if (!dbAvailable || !brokerUserId) {
      context.skip();
      return;
    }

    const app = fastify({ logger: false });
    await app.register(fastifyJwt, { secret: 'broker-login-rls-test-secret' });
    await app.register(authRoutes, { prefix: '/v1/auth' });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'giovane@seed.prospix.dev',
        password: 'wrong-password-12345',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.message).toContain('Senha incorreta');
  });

  it('rejects authentication for non-existent brokers', async (context) => {
    if (!dbAvailable) {
      context.skip();
      return;
    }

    const app = fastify({ logger: false });
    await app.register(fastifyJwt, { secret: 'broker-login-rls-test-secret' });
    await app.register(authRoutes, { prefix: '/v1/auth' });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'nonexistent-broker@seed.prospix.dev',
        password: 'any-password-123',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('rejects authentication with 403 if the broker belongs to a suspended tenant', async (context) => {
    if (!dbAvailable || !brokerUserId) {
      context.skip();
      return;
    }

    // 1. Temporarily suspend Tenant A
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
      await tx.tenant.update({
        where: { id: '11111111-1111-1111-1111-111111111111' },
        data: { status: 'SUSPENDED' },
      });
    });

    const app = fastify({ logger: false });
    await app.register(fastifyJwt, { secret: 'broker-login-rls-test-secret' });
    await app.register(authRoutes, { prefix: '/v1/auth' });
    await app.ready();

    // 2. Try to authenticate
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'giovane@seed.prospix.dev',
        password: process.env.SEED_ADMIN_PASSWORD || 'super-secret-password-123',
      },
    });

    await app.close();

    // 3. Restore Tenant A status
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
      await tx.tenant.update({
        where: { id: '11111111-1111-1111-1111-111111111111' },
        data: { status: 'ACTIVE' },
      });
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('TENANT_INACTIVE');
    expect(body.message).toContain('Acesso bloqueado');
  });
});
