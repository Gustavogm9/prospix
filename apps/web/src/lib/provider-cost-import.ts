import { z } from 'zod';

const optionalUuid = z.union([z.string().uuid(), z.literal(''), z.null()]).optional()
  .transform((value) => value || null);

const booleanFromInput = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'sim', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'nao', 'não', 'no', ''].includes(normalized)) return false;
  return value;
}, z.boolean()).default(false);

export const providerCostRowSchema = z.object({
  tenant_id: optionalUuid,
  campaign_id: optionalUuid,
  lead_id: optionalUuid,
  prospecting_run_id: optionalUuid,
  provider_usage_event_id: optionalUuid,
  provider: z.enum([
    'GOOGLE_CLOUD', 'GOOGLE_MAPS', 'OPENAI', 'WHATSAPP', 'EVOLUTION', 'WAHA',
    'TAVILY', 'FIRECRAWL', 'CNPJA', 'APIFY', 'INFOSIMPLES', 'ESCAVADOR', 'INFRA', 'OTHER',
  ]),
  service: z.string().trim().min(1).max(160),
  sku_id: z.string().trim().max(160).nullable().optional().transform((value) => value || null),
  sku_description: z.string().trim().max(500).nullable().optional().transform((value) => value || null),
  period_month: z.string().regex(/^\d{4}-\d{2}-01$/),
  usage_start_at: z.string().datetime({ offset: true }).nullable().optional().transform((value) => value || null),
  usage_end_at: z.string().datetime({ offset: true }).nullable().optional().transform((value) => value || null),
  cost_cents: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('BRL'),
  quantity: z.union([z.coerce.number().nonnegative(), z.literal(''), z.null()]).optional()
    .transform((value) => value === '' || value == null ? null : value),
  unit: z.string().trim().max(80).nullable().optional().transform((value) => value || null),
  external_project_id: z.string().trim().max(200).nullable().optional().transform((value) => value || null),
  external_billing_account_id: z.string().trim().max(200).nullable().optional().transform((value) => value || null),
  external_invoice_id: z.string().trim().max(200).nullable().optional().transform((value) => value || null),
  external_row_id: z.string().trim().min(1).max(300),
  external_request_id: z.string().trim().max(300).nullable().optional().transform((value) => value || null),
  evidence: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().trim().max(1000).nullable().optional().transform((value) => value || null),
  allocation_method: z.enum(['DIRECT', 'REQUEST_ID', 'PROPORTIONAL', 'UNALLOCATED']).default('DIRECT'),
  estimated: booleanFromInput,
}).strict().superRefine((row, ctx) => {
  if ((row.campaign_id || row.lead_id || row.prospecting_run_id) && !row.tenant_id) {
    ctx.addIssue({ code: 'custom', message: 'tenant_id is required for campaign, lead or run attribution' });
  }
  if (
    !row.tenant_id &&
    !row.provider_usage_event_id &&
    !row.external_request_id &&
    row.allocation_method !== 'UNALLOCATED'
  ) {
    ctx.addIssue({ code: 'custom', message: 'rows without a tenant must use UNALLOCATED' });
  }
  if (row.estimated) {
    ctx.addIssue({ code: 'custom', message: 'estimated rows belong in provider usage, not the real billing ledger' });
  }
});

export const providerCostImportSchema = z.object({
  mode: z.enum(['PREVIEW', 'COMMIT']),
  source: z.enum(['GOOGLE_BILLING_EXPORT', 'CSV_IMPORT', 'API_IMPORT', 'MANUAL']),
  file_name: z.string().trim().max(255).nullable().optional().transform((value) => value || null),
  preview_checksum: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional().transform((value) => value || null),
  rows: z.array(providerCostRowSchema).min(1).max(500),
}).strict().superRefine((input, ctx) => {
  const currencies = new Set(input.rows.map((row) => row.currency));
  if (currencies.size !== 1) {
    ctx.addIssue({ code: 'custom', path: ['rows'], message: 'each import must contain a single currency' });
  }
  const externalRowIds = input.rows.map((row) => row.external_row_id);
  if (new Set(externalRowIds).size !== externalRowIds.length) {
    ctx.addIssue({ code: 'custom', path: ['rows'], message: 'external_row_id must be unique within an import' });
  }
  if (input.mode === 'COMMIT' && !input.preview_checksum) {
    ctx.addIssue({ code: 'custom', path: ['preview_checksum'], message: 'a validated preview checksum is required' });
  }
});

export type ProviderCostRow = z.infer<typeof providerCostRowSchema>;

function parseCsvMatrix(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error('CSV possui aspas nao fechadas.');
  return rows;
}

function csvValue(key: string, value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (key === 'cost_cents' || key === 'quantity') return Number(trimmed.replace(',', '.'));
  if (key === 'estimated') return ['1', 'true', 'sim', 'yes'].includes(trimmed.toLowerCase());
  if (key === 'evidence') {
    try { return JSON.parse(trimmed); } catch { throw new Error('A coluna evidence deve conter JSON valido.'); }
  }
  return trimmed;
}

export function parseProviderCostInput(input: string, fileName = ''): unknown[] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Arquivo vazio.');
  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('O JSON deve ser uma lista de linhas.');
    return parsed;
  }
  const matrix = parseCsvMatrix(trimmed);
  if (matrix.length < 2) throw new Error('CSV sem linhas de dados.');
  const headers = matrix[0]!.map((header) => header.trim());
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error('Cabecalho CSV invalido ou duplicado.');
  }
  return matrix.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, csvValue(header, values[index] || '')]),
  ));
}

export function summarizeProviderCostRows(rows: ProviderCostRow[]) {
  return {
    currency: rows[0]?.currency || 'BRL',
    row_count: rows.length,
    total_cost_cents: rows.reduce((sum, row) => sum + row.cost_cents, 0),
    attributed_rows: rows.filter((row) => row.tenant_id).length,
    unallocated_rows: rows.filter((row) => !row.tenant_id).length,
    campaign_rows: rows.filter((row) => row.campaign_id).length,
    run_rows: rows.filter((row) => row.prospecting_run_id).length,
    lead_rows: rows.filter((row) => row.lead_id).length,
    usage_event_rows: rows.filter((row) => row.provider_usage_event_id || row.external_request_id).length,
  };
}

export function canonicalizeProviderCostImport(input: {
  source: string;
  file_name?: string | null;
  rows: ProviderCostRow[];
}): string {
  return JSON.stringify({
    source: input.source,
    file_name: input.file_name || null,
    rows: [...input.rows].sort((a, b) => a.external_row_id.localeCompare(b.external_row_id)),
  });
}
