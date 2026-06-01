import '../multi-tenant/use-restricted-db.js';
import '../../src/config/env.js';
import fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { authRoutes } from '../../src/routes/auth/index.js';

const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let dbAvailable = true;
let brokerUserId: string | null = null;

async function findSeedBroker() {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('email', 'giovane@seed.prospix.dev')
    .eq('role', 'OWNER')
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

describe('AUD-P1-018 broker email/password login with RLS-backed database', () => {
  beforeAll(async () => {
    try {
      // Verify connection with a simple query
      const { error } = await db.from('users').select('id').limit(1);
      if (error) throw error;

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
      await db.from('sessions').delete().eq('user_id', brokerUserId!);
    }
    // Supabase doesn't need explicit disconnection
  });

  it('authenticates a broker with correct email and password', async (context) => {
    if (!dbAvailable || !brokerUserId) {
      context.skip();
      return;
    }

    const app = fastify({ logger: false });
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

    const { count, error } = await db
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', brokerUserId!);
    if (error) throw error;
    expect(count).toBeGreaterThan(0);
  });

  it('rejects authentication if the password is incorrect', async (context) => {
    if (!dbAvailable || !brokerUserId) {
      context.skip();
      return;
    }

    const app = fastify({ logger: false });
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
    const { error: suspendError } = await db
      .from('tenants')
      .update({ status: 'SUSPENDED' })
      .eq('id', '11111111-1111-1111-1111-111111111111');
    if (suspendError) throw suspendError;

    const app = fastify({ logger: false });
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
    const { error: restoreError } = await db
      .from('tenants')
      .update({ status: 'ACTIVE' })
      .eq('id', '11111111-1111-1111-1111-111111111111');
    if (restoreError) throw restoreError;

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('TENANT_INACTIVE');
    expect(body.message).toContain('Acesso bloqueado');
  });
});
