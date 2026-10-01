import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  canonicalizeProviderCostImport,
  providerCostImportSchema,
  summarizeProviderCostRows,
} from '@/lib/provider-cost-import';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

export const dynamic = 'force-dynamic';

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, message: 'JSON invalido.' }, 400);
  }

  const parsed = providerCostImportSchema.safeParse(body);
  if (!parsed.success) {
    return response({
      ok: false,
      message: 'Arquivo de custos invalido.',
      issues: parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }, 400);
  }

  const canonical = canonicalizeProviderCostImport(parsed.data);
  const checksum = createHash('sha256').update(canonical).digest('hex');
  const baseSummary = summarizeProviderCostRows(parsed.data.rows);
  const { data: existingRows, error: existingRowsError } = await supabaseAdmin
    .from('provider_cost_ledger')
    .select('external_row_id')
    .eq('source', parsed.data.source)
    .in('external_row_id', parsed.data.rows.map((row) => row.external_row_id));
  if (existingRowsError) {
    console.error('[provider-cost-import] duplicate check failed', { code: existingRowsError.code });
    return response({ ok: false, message: 'Nao foi possivel conferir linhas ja importadas.' }, 500);
  }
  const existingIds = new Set((existingRows || []).map((row) => row.external_row_id));
  const importableRows = parsed.data.rows.filter((row) => !existingIds.has(row.external_row_id));
  const summary = {
    ...baseSummary,
    existing_row_count: parsed.data.rows.length - importableRows.length,
    importable_row_count: importableRows.length,
    importable_cost_cents: importableRows.reduce((sum, row) => sum + row.cost_cents, 0),
  };
  if (parsed.data.mode === 'PREVIEW') {
    return response({ ok: true, preview: true, checksum, summary });
  }
  if (parsed.data.preview_checksum !== checksum) {
    return response({
      ok: false,
      message: 'O arquivo mudou depois da pre-validacao. Gere uma nova previa antes de importar.',
    }, 409);
  }

  const { data, error } = await supabaseAdmin.rpc('import_provider_cost_rows', {
    p_admin_user_id: auth.adminId,
    p_checksum: checksum,
    p_source: parsed.data.source,
    p_file_name: parsed.data.file_name,
    p_rows: parsed.data.rows,
  });
  if (error) {
    console.error('[provider-cost-import] commit failed', { code: error.code });
    return response({ ok: false, message: 'A importacao nao foi gravada. Revise as atribuicoes.' }, 409);
  }

  return response({ ok: true, preview: false, checksum, summary, result: data });
}
