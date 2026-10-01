import { describe, expect, it } from 'vitest';

import {
  parseProviderCostInput,
  providerCostImportSchema,
  summarizeProviderCostRows,
} from './provider-cost-import';

const row = {
  tenant_id: '6de57a0c-f8f5-4990-b9c3-87a83d95e75d',
  campaign_id: 'e11fce13-79a9-41f9-afc0-e341a5ad7759',
  lead_id: null,
  prospecting_run_id: null,
  provider: 'GOOGLE_MAPS',
  service: 'Places API',
  period_month: '2026-09-01',
  cost_cents: 123,
  external_row_id: 'invoice-row-1',
  allocation_method: 'DIRECT',
};
const previewChecksum = 'a'.repeat(64);

describe('provider billing import', () => {
  it('validates attributable provider rows and summarizes cents', () => {
    const parsed = providerCostImportSchema.parse({ mode: 'PREVIEW', source: 'CSV_IMPORT', rows: [row] });
    expect(summarizeProviderCostRows(parsed.rows)).toMatchObject({
      row_count: 1,
      total_cost_cents: 123,
      attributed_rows: 1,
      campaign_rows: 1,
      currency: 'BRL',
    });
  });

  it('parses quoted standardized CSV', () => {
    const input = 'provider,service,period_month,cost_cents,external_row_id,allocation_method\nGOOGLE_MAPS,"Places, API",2026-09-01,50,row-1,UNALLOCATED';
    expect(parseProviderCostInput(input, 'billing.csv')).toEqual([{
      provider: 'GOOGLE_MAPS', service: 'Places, API', period_month: '2026-09-01',
      cost_cents: 50, external_row_id: 'row-1', allocation_method: 'UNALLOCATED',
    }]);
  });

  it('rejects campaign attribution without a tenant', () => {
    const parsed = providerCostImportSchema.safeParse({
      mode: 'COMMIT', source: 'MANUAL', preview_checksum: previewChecksum,
      rows: [{ ...row, tenant_id: null }],
    });
    expect(parsed.success).toBe(false);
  });

  it('does not coerce the CSV string false to true', () => {
    const parsed = providerCostImportSchema.parse({
      mode: 'PREVIEW', source: 'CSV_IMPORT', rows: [{ ...row, estimated: 'false' }],
    });
    expect(parsed.rows[0]!.estimated).toBe(false);
  });

  it('rejects estimated billing and mixed currencies', () => {
    expect(providerCostImportSchema.safeParse({
      mode: 'COMMIT', source: 'MANUAL', preview_checksum: previewChecksum,
      rows: [{ ...row, estimated: true }],
    }).success).toBe(false);
    expect(providerCostImportSchema.safeParse({
      mode: 'COMMIT', source: 'MANUAL', preview_checksum: previewChecksum,
      rows: [row, { ...row, external_row_id: 'row-2', currency: 'USD' }],
    }).success).toBe(false);
  });

  it('requires the exact preview checksum before commit', () => {
    expect(providerCostImportSchema.safeParse({
      mode: 'COMMIT', source: 'CSV_IMPORT', rows: [row],
    }).success).toBe(false);
    expect(providerCostImportSchema.safeParse({
      mode: 'COMMIT', source: 'CSV_IMPORT', rows: [row], preview_checksum: previewChecksum,
    }).success).toBe(true);
  });

  it('rejects a repeated provider row within the same file', () => {
    expect(providerCostImportSchema.safeParse({
      mode: 'PREVIEW', source: 'CSV_IMPORT', rows: [row, { ...row }],
    }).success).toBe(false);
  });
});
