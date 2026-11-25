import { describe, expect, it } from 'vitest';
import { financialSummary } from './financial-summary';

describe('consolidado financeiro com origem e período definidos', () => {
  const tenants = [{ id: 'cliente', mrr_cents: 89000 }];
  it('usa apenas consumo do mês e dos contratos exibidos', () => {
    const result = financialSummary(tenants, [
      { tenant_id: 'cliente', period_month: '2026-10-01', llm_cost_cents: 770 },
      { tenant_id: 'cliente', period_month: '2026-11-01', llm_cost_cents: 200, tavily_cost_cents: 100 },
      { tenant_id: 'outro', period_month: '2026-11-01', llm_cost_cents: 90000 },
    ], '2026-11-01');
    expect(result).toMatchObject({ mrrCents: 89000, estimatedCostCents: 300, balanceCents: 88700 });
  });
  it('distingue falta de registro de consumo explicitamente zero', () => {
    expect(financialSummary(tenants, [], '2026-11-01')).toMatchObject({ estimatedCostCents: null, balanceCents: null });
    expect(financialSummary(tenants, [{ tenant_id: 'cliente', period_month: '2026-11-01' }], '2026-11-01'))
      .toMatchObject({ estimatedCostCents: 0, balanceCents: 89000 });
  });
  it('mantém centavos e inclui todas as famílias de consumo', () => {
    expect(financialSummary([{ id: 'cliente', mrr_cents: 10001 }], [{
      tenant_id: 'cliente', period_month: '2026-11-01', llm_cost_cents: 101,
      whatsapp_cost_cents: 202, google_maps_cost_cents: 303, tavily_cost_cents: 404, firecrawl_cost_cents: 505,
    }], '2026-11-01')).toMatchObject({ estimatedCostCents: 1515, balanceCents: 8486 });
  });
});
