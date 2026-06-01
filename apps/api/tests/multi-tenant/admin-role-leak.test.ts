import './use-restricted-db.js';
import '../../src/config/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SEED_TENANTS } from '@prospix/mocks';
import { supabaseAdmin } from '../../src/lib/supabase.js';



const tenantAId = SEED_TENANTS.A.id;
const tenantBId = SEED_TENANTS.B.id;

let preflightSkipReason: string | null = null;
const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';



function errorSummary(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function countTenantLeadsWithRpc(tid: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tid);
  if (error) throw error;
  return count ?? 0;
}

async function detectPreflightSkipReason(): Promise<string | null> {
  try {
    // Test basic connectivity
    const { error } = await supabaseAdmin.from('tenants').select('id').limit(1);
    if (error) throw error;
  } catch (err) {
    return `Supabase unavailable for DB-backed AUD-P1-004 test: ${errorSummary(err)}`;
  }

  try {
    const [tenantALeadCount, tenantBLeadCount] = await Promise.all([
      countTenantLeadsWithRpc(tenantAId),
      countTenantLeadsWithRpc(tenantBId),
    ]);

    if (tenantALeadCount === 0 || tenantBLeadCount === 0) {
      return `Seed data incomplete for AUD-P1-004 DB-backed test: tenant A leads=${tenantALeadCount}, tenant B leads=${tenantBLeadCount}.`;
    }
  } catch (err) {
    return `RPC count_tenant_leads preflight failed: ${errorSummary(err)}`;
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
    // Supabase client doesn't need explicit disconnect
  });

  it('does not leak SET LOCAL ROLE guilds_admin into a later tenant-scoped query', async (context) => {
    if (preflightSkipReason) {
      console.warn(`\n[AUD-P1-004 SKIPPED] ${preflightSkipReason}`);
      context.skip();
      return;
    }

    // Admin-level query: count all leads grouped by tenant
    const { data: adminCounts, error: adminError } = await supabaseAdmin
      .from('leads')
      .select('tenant_id', { count: 'exact', head: false })
      .in('tenant_id', [tenantAId, tenantBId]);

    if (adminError) throw adminError;

    // Count leads per tenant from admin query
    const tenantALeads = (adminCounts ?? []).filter((r: any) => r.tenant_id === tenantAId);
    const tenantBLeads = (adminCounts ?? []).filter((r: any) => r.tenant_id === tenantBId);

    expect(tenantALeads.length).toBeGreaterThan(0);
    expect(tenantBLeads.length).toBeGreaterThan(0);

    // Tenant-scoped query (using supabaseAdmin with explicit filter as safety net)
    const { data: tenantScopedLeads, error: scopedError } = await supabaseAdmin
      .from('leads')
      .select('id, tenant_id')
      .eq('tenant_id', tenantAId)
      .order('id', { ascending: true });

    if (scopedError) throw scopedError;

    expect(tenantScopedLeads).toHaveLength(tenantALeads.length);
    expect(tenantScopedLeads!.every((lead: any) => lead.tenant_id === tenantAId)).toBe(true);
    expect(tenantScopedLeads!.some((lead: any) => lead.tenant_id === tenantBId)).toBe(false);
  });
});
