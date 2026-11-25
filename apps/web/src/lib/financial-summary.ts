type TenantRevenue = { id: string; mrr_cents: number | null };
type Usage = {
  tenant_id: string; period_month: string;
  llm_cost_cents?: number | null; whatsapp_cost_cents?: number | null;
  google_maps_cost_cents?: number | null; tavily_cost_cents?: number | null;
  firecrawl_cost_cents?: number | null;
};

/** Contract values and operational estimates, never received revenue or net profit. */
export function financialSummary(tenants: TenantRevenue[], usage: Usage[], month: string) {
  const tenantIds = new Set(tenants.map(tenant => tenant.id));
  const rows = usage.filter(row => tenantIds.has(row.tenant_id) && row.period_month.slice(0, 10) === month);
  const mrrCents = tenants.reduce((sum, tenant) => sum + (tenant.mrr_cents ?? 0), 0);
  const buckets = {
    llm: rows.reduce((sum, row) => sum + (row.llm_cost_cents ?? 0), 0),
    whatsapp: rows.reduce((sum, row) => sum + (row.whatsapp_cost_cents ?? 0), 0),
    maps: rows.reduce((sum, row) => sum + (row.google_maps_cost_cents ?? 0), 0),
    tavily: rows.reduce((sum, row) => sum + (row.tavily_cost_cents ?? 0), 0),
    firecrawl: rows.reduce((sum, row) => sum + (row.firecrawl_cost_cents ?? 0), 0),
  };
  const estimatedCostCents = rows.length ? Object.values(buckets).reduce((sum, cost) => sum + cost, 0) : null;
  return {
    mrrCents, buckets, estimatedCostCents,
    balanceCents: estimatedCostCents === null ? null : mrrCents - estimatedCostCents,
    coverage: { measuredTenants: new Set(rows.map(row => row.tenant_id)).size, totalTenants: tenants.length },
  };
}
