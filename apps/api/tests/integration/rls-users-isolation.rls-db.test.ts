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
import { PrismaClient } from '@prisma/client';

const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

let dbAvailable = true;
let tenantAId: string | null = null;
let tenantBId: string | null = null;
let adminUserId: string | null = null;

describe('AUD-P1-018 · RLS users policy · tenant nao enxerga admin nem outro tenant', () => {
  beforeAll(async () => {
    try {
      await db.$connect();
      await db.$queryRaw`SELECT 1`;

      // Locate seed tenants + admin via bypass
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
        const tenants = await tx.tenant.findMany({
          where: { slug: { in: ['tenant-a-dev', 'tenant-b-dev'] } },
          select: { id: true, slug: true },
        });
        const a = tenants.find((t) => t.slug === 'tenant-a-dev');
        const b = tenants.find((t) => t.slug === 'tenant-b-dev');
        tenantAId = a?.id ?? null;
        tenantBId = b?.id ?? null;

        const admin = await tx.user.findFirst({
          where: { role: 'GUILDS_ADMIN' },
          select: { id: true },
        });
        adminUserId = admin?.id ?? null;
      });

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
    await db.$disconnect();
  });

  it('com app.tenant_id = tenant A · users.findMany retorna SOMENTE users do tenant A · sem admin', async (context) => {
    if (!dbAvailable || !tenantAId || !tenantBId || !adminUserId) {
      context.skip();
      return;
    }

    const users = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantAId}, true)`;
      return tx.user.findMany({
        select: { id: true, tenantId: true, role: true },
      });
    });

    // TODOS users retornados devem ter tenantId = tenantA
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.tenantId).toBe(tenantAId);
    }

    // NENHUM deve ter role GUILDS_ADMIN (admin tem tenantId = null)
    const adminLeaks = users.filter((u) => u.role === 'GUILDS_ADMIN');
    expect(adminLeaks, `Admin leak: tenant comum enxergou ${adminLeaks.length} admins`).toHaveLength(0);

    // Nenhum user do tenant B
    const tenantBLeaks = users.filter((u) => u.tenantId === tenantBId);
    expect(tenantBLeaks).toHaveLength(0);
  });

  it('com app.tenant_id = tenant B · NAO retorna users do tenant A nem admin', async (context) => {
    if (!dbAvailable || !tenantAId || !tenantBId || !adminUserId) {
      context.skip();
      return;
    }

    const users = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantBId}, true)`;
      return tx.user.findMany({
        select: { id: true, tenantId: true, role: true },
      });
    });

    for (const u of users) {
      expect(u.tenantId).toBe(tenantBId);
    }
    expect(users.find((u) => u.id === adminUserId)).toBeUndefined();
  });

  it('com app.tenant_id vazio · users.findMany retorna 0 rows (sem leak)', async (context) => {
    if (!dbAvailable) {
      context.skip();
      return;
    }

    const users = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_id TO ''`;
      return tx.user.findMany({ select: { id: true } });
    });

    expect(users).toHaveLength(0);
  });

  it('admin via role guilds_admin (BYPASSRLS) · enxerga TODOS (tenants + admin)', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const users = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
      return tx.user.findMany({
        select: { id: true, tenantId: true, role: true },
      });
    });

    // Admin DEVE ver tudo
    expect(users.length).toBeGreaterThan(2); // pelo menos tenants A, B + admin

    // Inclui o admin user
    expect(users.find((u) => u.id === adminUserId)).toBeDefined();
  });
});
