import '../multi-tenant/use-restricted-db.js';
import '../../src/config/env.js';
import fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { authRoutes } from '../../src/routes/auth/index.js';

const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let dbAvailable = true;
let adminUserId: string | null = null;

async function findSeedAdmin() {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('email', 'gustavo.macedo@guilds.com.br')
    .eq('role', 'GUILDS_ADMIN')
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

describe('AUD-P1-017 admin login with RLS-backed database', () => {
  beforeAll(async () => {
    try {
      // Verify connection with a simple query
      const { error } = await db.from('users').select('id').limit(1);
      if (error) throw error;

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
      await db.from('sessions').delete().eq('user_id', adminUserId!);
    }
    // Supabase doesn't need explicit disconnection
  });

  it('creates an admin session while RLS is active for the app database user', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const app = fastify({ logger: false });
    await app.register(authRoutes, { prefix: '/v1/auth' });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/admin-login',
      payload: {
        email: 'gustavo.macedo@guilds.com.br',
        password: process.env.SEED_ADMIN_PASSWORD || 'super-secret-password-123',
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

    const { count, error } = await db
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', adminUserId!);
    if (error) throw error;
    expect(count).toBeGreaterThan(0);
  });
});
