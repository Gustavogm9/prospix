'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, Loader2, ReceiptText } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, toast } from '@prospix/ui';

import { adminNextApi } from '@/lib/admin-api-fetch';
import {
  parseProviderCostInput,
  providerCostImportSchema,
  type ProviderCostRow,
} from '@/lib/provider-cost-import';

type Summary = {
  currency: string;
  row_count: number;
  total_cost_cents: number;
  attributed_rows: number;
  unallocated_rows: number;
  campaign_rows: number;
  run_rows: number;
  lead_rows: number;
  usage_event_rows: number;
  existing_row_count: number;
  importable_row_count: number;
  importable_cost_cents: number;
};

export default function ProviderCostsPage() {
  const [source, setSource] = useState<'GOOGLE_BILLING_EXPORT' | 'CSV_IMPORT' | 'API_IMPORT' | 'MANUAL'>('CSV_IMPORT');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ProviderCostRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checksum, setChecksum] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);

  const handleFile = async (file: File | null) => {
    setRows([]);
    setSummary(null);
    setChecksum(null);
    setCommitted(false);
    setIssues([]);
    setFileName(file?.name || null);
    if (!file) return;
    try {
      const rawRows = parseProviderCostInput(await file.text(), file.name);
      const parsed = providerCostImportSchema.safeParse({ mode: 'PREVIEW', source, file_name: file.name, rows: rawRows });
      if (!parsed.success) {
        setIssues(parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join('.')}: ${issue.message}`));
        return;
      }
      setRows(parsed.data.rows);
    } catch (error) {
      setIssues([error instanceof Error ? error.message : 'Nao foi possivel ler o arquivo.']);
    }
  };

  const preview = async () => {
    if (!rows.length) return;
    setBusy(true);
    setIssues([]);
    try {
      const { data } = await adminNextApi.post('/api/admin/costs/import', {
        mode: 'PREVIEW', source, file_name: fileName, rows,
      });
      setSummary(data.summary);
      setChecksum(data.checksum);
      setCommitted(false);
    } catch (error) {
      setIssues([error instanceof Error ? error.message : 'Falha na pre-validacao.']);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!summary || !checksum || !rows.length) return;
    if (!confirm(`Importar ${summary.importable_row_count} linha(s) nova(s), totalizando ${(summary.importable_cost_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: summary.currency })}?`)) return;
    setBusy(true);
    try {
      const { data } = await adminNextApi.post('/api/admin/costs/import', {
        mode: 'COMMIT', source, file_name: fileName, preview_checksum: checksum, rows,
      });
      setCommitted(true);
      toast.success('Custos importados', `${data.result?.inserted_count || 0} linhas gravadas no ledger real.`);
    } catch (error) {
      setIssues([error instanceof Error ? error.message : 'Falha ao importar custos.']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
          <ReceiptText className="w-5 h-5 text-primary" aria-hidden /> Custos de provedores
        </h2>
        <p className="text-text-secondary text-xs mt-1">
          Importe custos faturados e atribua cada linha a tenant, campanha, execução e lead. Estimativas operacionais continuam separadas.
        </p>
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Importar faturamento real</CardTitle>
          <CardDescription className="text-xs">
            Aceita JSON ou CSV no formato padronizado do Prospix, até 500 linhas. Exporte o faturamento do provedor e normalize as colunas antes do envio. Valores monetários devem estar em centavos; a prévia não grava dados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <label className="text-xs font-semibold text-text">
              Origem
              <select
                value={source}
                onChange={(event) => { setSource(event.target.value as typeof source); setSummary(null); setChecksum(null); }}
                className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-xs"
              >
                <option value="GOOGLE_BILLING_EXPORT">Google Billing (normalizado)</option>
                <option value="CSV_IMPORT">CSV padronizado</option>
                <option value="API_IMPORT">Exportação de API</option>
                <option value="MANUAL">Evidência manual</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-text">
              Arquivo .csv ou .json
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={(event) => handleFile(event.target.files?.[0] || null)}
                className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-surface-sunken file:px-3 file:py-1 file:text-xs file:font-semibold"
              />
            </label>
          </div>

          <div className="rounded-lg border border-border bg-surface-sunken/50 p-3 text-[11px] text-text-secondary">
            Colunas mínimas: <code>provider, service, period_month, cost_cents, external_row_id, allocation_method</code>.
            Para atribuir campanha, execução ou lead, informe também <code>tenant_id</code> e os respectivos IDs. Se houver, <code>provider_usage_event_id</code> ou <code>external_request_id</code> faz a conciliação com a chamada operacional. Cada arquivo deve ter uma só moeda; linhas sem tenant usam <code>UNALLOCATED</code>.
          </div>

          {issues.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
              <div className="flex items-center gap-2 text-xs font-semibold text-red-700"><AlertCircle className="h-4 w-4" /> Arquivo inválido</div>
              <ul className="mt-2 list-disc pl-5 text-[11px] text-red-700 space-y-1">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            </div>
          )}

          {summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ['Linhas', summary.row_count],
                ['Custo real', (summary.total_cost_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: summary.currency })],
                ['Atribuídas', summary.attributed_rows],
                ['Sem atribuição', summary.unallocated_rows],
                ['Importáveis', summary.importable_row_count],
                ['Já importadas', summary.existing_row_count],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
                  <div className="mt-1 font-mono text-sm font-bold text-text">{value}</div>
                </div>
              ))}
            </div>
          )}

          {committed && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
              <CheckCircle2 className="h-4 w-4" /> Importação registrada; reenvios do mesmo arquivo são idempotentes.
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={preview} disabled={busy || rows.length === 0} className="h-9 text-xs">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />} Validar prévia
            </Button>
            <Button onClick={commit} disabled={busy || !summary || committed} className="h-9 bg-primary text-white text-xs">
              Importar no ledger
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
