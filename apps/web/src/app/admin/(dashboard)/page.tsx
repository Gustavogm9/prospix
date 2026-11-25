'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, BarChart } from '@prospix/ui';
import { supabaseAdmin } from '@/lib/supabase';
import { financialSummary } from '@/lib/financial-summary';
import { saoPauloMonth } from '@/lib/sao-paulo-time';

type Summary = ReturnType<typeof financialSummary>;
const money = (cents: number | null) => cents === null ? 'Não apurado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(saoPauloMonth());

  const load = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const period = saoPauloMonth();
      const tenants: { id: string; mrr_cents: number | null }[] = [];
      const usage: Parameters<typeof financialSummary>[1] = [];
      // Paginate both sources so a large customer base is never silently truncated.
      for (let offset = 0; ; offset += 1000) {
        const result = await supabaseAdmin.from('tenants').select('id, mrr_cents')
          .is('deleted_at', null).in('status', ['ACTIVE', 'ONBOARDING']).order('id').range(offset, offset + 999);
        if (result.error) throw result.error;
        tenants.push(...(result.data ?? []));
        if ((result.data?.length ?? 0) < 1000) break;
      }
      for (let offset = 0; ; offset += 1000) {
        const result = await supabaseAdmin.from('tenant_usage')
          .select('tenant_id, period_month, llm_cost_cents, whatsapp_cost_cents, google_maps_cost_cents, tavily_cost_cents, firecrawl_cost_cents')
          .eq('period_month', period).order('tenant_id').range(offset, offset + 999);
        if (result.error) throw result.error;
        usage.push(...(result.data ?? []));
        if ((result.data?.length ?? 0) < 1000) break;
      }
      setSummary(financialSummary(tenants, usage, period)); setMonth(period);
    } catch {
      setError('Não foi possível consultar os contratos e o consumo. Tente novamente.');
    } finally { setIsLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (isLoading) return <div role="status" className="p-6 text-text-secondary">Consultando contratos e consumo…</div>;
  if (error || !summary) return <div role="alert" className="p-6 space-y-4"><p>{error}</p><button onClick={() => void load()} className="px-4 py-3 border rounded-lg">Tentar novamente</button></div>;
  const buckets = [
    { label: 'IA', value: summary.buckets.llm / 100 },
    { label: 'WhatsApp', value: summary.buckets.whatsapp / 100 },
    { label: 'Google Maps', value: summary.buckets.maps / 100 },
    { label: 'Tavily', value: summary.buckets.tavily / 100 },
    { label: 'Firecrawl', value: summary.buckets.firecrawl / 100 },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-text">Contratos e consumo do mês</h2>
        <p className="text-sm text-text-secondary mt-2">Período: {month.slice(5, 7)}/{month.slice(0, 4)} · horário de Brasília.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: 'Mensalidades contratadas', value: summary.mrrCents, detail: 'Soma dos contratos ativos e em implantação. Não representa pagamentos recebidos.' },
          { title: 'Consumo registrado · estimativa', value: summary.estimatedCostCents, detail: 'Uso de serviços registrado neste mês. Conferência com faturas disponível em Custos de provedores.' },
          { title: 'Saldo após consumo estimado', value: summary.balanceCents, detail: 'Mensalidades menos o consumo registrado. Não inclui todas as despesas e não representa lucro líquido.' },
        ].map(card => <Card key={card.title}><CardHeader><CardTitle className="text-sm">{card.title}</CardTitle></CardHeader><CardContent>
          <p className="text-2xl font-bold font-mono">{money(card.value)}</p><p className="mt-3 text-xs text-text-secondary">{card.detail}</p>
        </CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle className="text-base">Origem dos valores</CardTitle></CardHeader><CardContent className="text-sm text-text-secondary space-y-2">
        <p>Consumo registrado para {summary.coverage.measuredTenants} de {summary.coverage.totalTenants} operações. Ausência de registro não significa custo zero.</p>
        <p>Para conferir despesas cobradas, importe as faturas em <a className="underline" href="/admin/custos">Custos de provedores</a>.</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Consumo por serviço</CardTitle><CardDescription>Estimativas registradas no período em reais.</CardDescription></CardHeader><CardContent>
        {summary.estimatedCostCents === null ? <p className="text-sm text-text-secondary">Nenhum consumo registrado neste mês.</p> : <BarChart items={buckets} />}
      </CardContent></Card>
    </div>
  );
}
