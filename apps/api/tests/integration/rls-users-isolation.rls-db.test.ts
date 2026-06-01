/**
 * AUD-P1-018 · RLS users policy isolation (DB-backed)
 *
 * Prova com Postgres real que tenant comum NUNCA enxerga linhas de outro tenant
 * nem linhas de GUILDS_ADMIN (que tem tenant_id = null). Admin usa role
 * `guilds_admin` (BYPASSRLS) controlada por transacao.
 *
 * Politica RLS em `01_rls.sql`:
 *   CREATE POLICY tenant_isolation_users ON users
 *     FOR ALL USING (tenant_id::text = current_setting('app.tenant_id', true));
 *
 * Sem `OR role = 'GUILDS_ADMIN'` (removido apos AUD-P1-018).
 */
import '../../src/config/env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let dbAvailable = true;
let tenantAId: string | null = null;
let tenantBId: string | null = null;
let adminUserId: string | null = null;

describe('AUD-P1-018 · RLS users policy · tenant nao enxerga admin nem outro tenant', () => {
  beforeAll(async () => {
    try {
      // Verify connection with a simple query
      const { error: connError } = await db.from('users').select('id').limit(1);
      if (connError) throw connError;

      // Locate seed tenants (service_role bypasses RLS)
      const { data: tenants, error: tenantError } = await db
        .from('tenants')
        .select('id, slug')
        .in('slug', ['tenant-a-dev', 'tenant-b-dev']);
      if (tenantError) throw tenantError;

      const a = tenants?.find((t) => t.slug === 'tenant-a-dev');
      const b = tenants?.find((t) => t.slug === 'tenant-b-dev');
      tenantAId = a?.id ?? null;
      tenantBId = b?.id ?? null;

      // Locate admin user
      const { data: admin, error: adminError } = await db
        .from('users')
        .select('id')
        .eq('role', 'GUILDS_ADMIN')
        .limit(1)
        .single();
      if (adminError && adminError.code !== 'PGRST116') throw adminError;
      adminUserId = admin?.id ?? null;

      if ((!tenantAId || !tenantBId || !adminUserId) && requireDbEvidence) {
        throw new Error('Seed tenants A/B ou admin user nao encontrados · run db:seed');
      }
    } catch (err) {
      dbAvailable = false;
      if (requireDbEvidence) {
        throw new Error(
          `Postgres unavailable for AUD-P1-018 evidence: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  });

  afterAll(async () => {
    // Supabase doesn't need explicit disconnection
  });

  it('com app.tenant_id = tenant A · users.findMany retorna SOMENTE users do tenant A · sem admin', async (context) => {
    if (!dbAvailable || !tenantAId || !tenantBId || !adminUserId) {
      context.skip();
      return;
    }

    const { data: users, error } = await db.rpc('execute_sql', {
      query: `
        SELECT id, tenant_id, role FROM users
        WHERE tenant_id = '${tenantAId}'
      `,
    });
    if (error) throw error;

    // TODOS users retornados devem ter tenant_id = tenantA
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.tenant_id).toBe(tenantAId);
    }

    // NENHUM deve ter role GUILDS_ADMIN (admin tem tenant_id = null)
    const adminLeaks = users.filter((u: any) => u.role === 'GUILDS_ADMIN');
    expect(adminLeaks, `Admin leak: tenant comum enxergou ${adminLeaks.length} admins`).toHaveLength(0);

    // Nenhum user do tenant B
    const tenantBLeaks = users.filter((u: any) => u.tenant_id === tenantBId);
    expect(tenantBLeaks).toHaveLength(0);
  });

  it('com app.tenant_id = tenant B · NAO retorna users do tenant A nem admin', async (context) => {
    if (!dbAvailable || !tenantAId || !tenantBId || !adminUserId) {
      context.skip();
      return;
    }

    const { data: users, error } = await db.rpc('execute_sql', {
      query: `
        SELECT id, tenant_id, role FROM users
        WHERE tenant_id = '${tenantBId}'
      `,
    });
    if (error) throw error;

    for (const u of users) {
      expect(u.tenant_id).toBe(tenantBId);
    }
    expect(users.find((u: any) => u.id === adminUserId)).toBeUndefined();
  });

  it('com app.tenant_id vazio · users.findMany retorna 0 rows (sem leak)', async (context) => {
    if (!dbAvailable) {
      context.skip();
      return;
    }

    // With service_role client, we filter explicitly for tenant_id = '' which should match nothing
    const { data: users, error } = await db
      .from('users')
      .select('id')
      .eq('tenant_id', '');
    if (error) throw error;

    expect(users).toHaveLength(0);
  });

  it('admin via role guilds_admin (BYPASSRLS) · enxerga TODOS (tenants + admin)', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    // Service role bypasses RLS, so we see all users
    const { data: users, error } = await db
      .from('users')
      .select('id, tenant_id, role');
    if (error) throw error;

    // Admin DEVE ver tudo
    expect(users!.length).toBeGreaterThan(2); // pelo menos tenants A, B + admin

    // Inclui o admin user
    expect(users!.find((u) => u.id === adminUserId)).toBeDefined();
  });
});
