import './use-restricted-db.js';
import '../../src/config/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Prisma } from '@prisma/client';
import { SEED_TENANTS } from '@prospix/mocks';
import { prisma } from '../../src/lib/prisma.js';
import { tenantContextStorage } from '../../src/lib/tenant-context-storage.js';

type CountRow = {
  leadCount: number | bigint | string;
};

type TenantCountRow = CountRow & {
  tenantId: string;
};

type RoleRow = {
  roleName: string | null;
};

const tenantAId = SEED_TENANTS.A.id;
const tenantBId = SEED_TENANTS.B.id;

let preflightSkipReason: string | null = null;
const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';

function countValue(row: CountRow | undefined): number {
  return Number(row?.leadCount ?? 0);
}

function errorSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withGuildsAdminRole<TResult>(operation: (tx: Prisma.TransactionClient) => Promise<TResult>): Promise<TResult> {
  return tenantContextStorage.run({ tenantId: null, userId: null, bypassRls: true }, () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE guilds_admin`;
      return operation(tx as unknown as Prisma.TransactionClient);
    })
  );
}

async function countTenantLeadsWithAdminRole(tenantId: string): Promise<number> {
  return withGuildsAdminRole(async (tx) => {
    const rows = await tx.$queryRaw<CountRow[]>`
      SELECT count(*)::int AS "leadCount"
      FROM leads
      WHERE tenant_id::text = ${tenantId}
    `;

    return countValue(rows[0]);
  });
}

async function detectPreflightSkipReason(): Promise<string | null> {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    return `PostgreSQL unavailable for DB-backed AUD-P1-004 test: ${errorSummary(err)}`;
  }

  try {
    const roles = await prisma.$queryRaw<RoleRow[]>`SELECT to_regrole('guilds_admin')::text AS "roleName"`;
    if (!roles[0]?.roleName) {
      return 'PostgreSQL role guilds_admin is missing; run migrations/RLS bootstrap before enabling this DB-backed test.';
    }
  } catch (err) {
    return `Unable to inspect PostgreSQL guilds_admin role: ${errorSummary(err)}`;
  }

  try {
    const [tenantALeadCount, tenantBLeadCount] = await Promise.all([
      countTenantLeadsWithAdminRole(tenantAId),
      countTenantLeadsWithAdminRole(tenantBId),
    ]);

    if (tenantALeadCount === 0 || tenantBLeadCount === 0) {
      return `Seed data incomplete for AUD-P1-004 DB-backed test: tenant A leads=${tenantALeadCount}, tenant B leads=${tenantBLeadCount}.`;
    }
  } catch (err) {
    return `SET LOCAL ROLE guilds_admin preflight failed; role may lack membership/grants: ${errorSummary(err)}`;
  }

  return null;
}

describe('AUD-P1-004 guilds_admin role leak guard', () => {
  beforeAll(async () => {
    preflightSkipReason = await detectPreflightSkipReason();
    if (requireDbEvidence && preflightSkipReason) {
      throw new Error(preflightSkipReason);
    }
  });

  afterAll(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // Ignore teardown errors after failed DB preflight.
    }
  });

  it('does not leak SET LOCAL ROLE guilds_admin into a later tenant-scoped query', async (context) => {
    if (preflightSkipReason) {
      console.warn(`\n[AUD-P1-004 SKIPPED] ${preflightSkipReason}`);
      context.skip();
      return;
    }

    const adminCounts = await withGuildsAdminRole(async (tx) => {
      return tx.$queryRaw<TenantCountRow[]>`
        SELECT tenant_id::text AS "tenantId", count(*)::int AS "leadCount"
        FROM leads
        GROUP BY tenant_id
      `;
    });

    const adminCountByTenant = new Map(adminCounts.map((row) => [row.tenantId, countValue(row)]));
    const tenantAAdminCount = adminCountByTenant.get(tenantAId) ?? 0;
    const tenantBAdminCount = adminCountByTenant.get(tenantBId) ?? 0;

    expect(tenantAAdminCount).toBeGreaterThan(0);
    expect(tenantBAdminCount).toBeGreaterThan(0);

    const tenantScopedLeads = await tenantContextStorage.run(
      { tenantId: tenantAId, userId: 'aud-p1-004-test-user', bypassRls: false },
      async () =>
        await prisma.lead.findMany({
          select: {
            id: true,
            tenantId: true,
          },
          orderBy: {
            id: 'asc',
          },
        })
    );

    expect(tenantScopedLeads).toHaveLength(tenantAAdminCount);
    expect(tenantScopedLeads.every((lead) => lead.tenantId === tenantAId)).toBe(true);
    expect(tenantScopedLeads.some((lead) => lead.tenantId === tenantBId)).toBe(false);
  });
});
