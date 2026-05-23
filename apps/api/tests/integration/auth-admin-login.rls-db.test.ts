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
let adminUserId: string | null = null;

async function findSeedAdmin() {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
    return tx.user.findFirst({
      where: {
        email: 'gustavo.macedo@guilds.com.br',
        role: 'GUILDS_ADMIN',
      },
      select: { id: true },
    });
  });
}

describe('AUD-P1-017 admin login with RLS-backed database', () => {
  beforeAll(async () => {
    try {
      await db.$connect();
      await db.$queryRaw`SELECT 1`;
      const admin = await findSeedAdmin();
      adminUserId = admin?.id ?? null;

      if (!adminUserId && requireDbEvidence) {
        throw new Error('Seed admin user not found for DB-backed admin-login evidence');
      }
    } catch (err) {
      dbAvailable = false;
      if (requireDbEvidence) {
        throw new Error(`Postgres unavailable for admin-login RLS evidence: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  afterAll(async () => {
    if (adminUserId) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
        await tx.session.deleteMany({ where: { userId: adminUserId! } });
      });
    }

    await db.$disconnect();
  });

  it('creates an admin session while RLS is active for the app database user', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const app = fastify({ logger: false });
    await app.register(fastifyJwt, { secret: 'admin-login-rls-test-secret' });
    await app.register(authRoutes, { prefix: '/v1/auth' });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/admin-login',
      payload: {
        email: 'gustavo.macedo@guilds.com.br',
        password: 'G.gm9189',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(body.user).toEqual(expect.objectContaining({
      id: adminUserId,
      tenant_id: null,
      email: 'gustavo.macedo@guilds.com.br',
      role: 'GUILDS_ADMIN',
    }));

    const sessionCount = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
      return tx.session.count({ where: { userId: adminUserId! } });
    });
    expect(sessionCount).toBeGreaterThan(0);
  });
});
