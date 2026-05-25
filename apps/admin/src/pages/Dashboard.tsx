import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, BarChart, toast } from '@prospix/ui';
import { DollarSign, Percent, TrendingUp, Cpu, Server, Map } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';

interface FinancialMetric {
  mrrTotal: string;
  costLLM: string;
  costWhatsApp: string;
  costMaps: string;
  netProfit: string;
  marginPercent: number;
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<FinancialMetric | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [costBreakdown, setCostBreakdown] = useState<{ label: string; value: number }[]>([]);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await adminApiClient.get('/admin/usage/consolidated');
        const report = response.data.data || [];

        let mrrTotalCents = 0;
        let costLLMCents = 0;
        let costWhatsAppCents = 0;
        let costMapsCents = 0;
        let totalCostsCents = 0;

        report.forEach((rec: any) => {
          mrrTotalCents += rec.mrr_cents || 0;
          costLLMCents += rec.llm_cost_cents || 0;
          costWhatsAppCents += rec.whatsapp_cost_cents || 0;
          costMapsCents += rec.maps_cost_cents || 0;
          totalCostsCents += rec.total_costs_cents || 0;
        });

        const netProfitCents = mrrTotalCents - totalCostsCents;
        const marginPercent = mrrTotalCents > 0 ? Number(((netProfitCents / mrrTotalCents) * 100).toFixed(1)) : 0;

        const formatBRL = (cents: number) => {
          return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
        };

        setMetrics({
          mrrTotal: formatBRL(mrrTotalCents),
          costLLM: formatBRL(costLLMCents),
          costWhatsApp: formatBRL(costWhatsAppCents),
          costMaps: formatBRL(costMapsCents),
          netProfit: formatBRL(netProfitCents),
          marginPercent,
        });

        setCostBreakdown([
          { label: 'LLM OpenAI', value: Number((costLLMCents / 100).toFixed(2)) },
          { label: 'WhatsApp', value: Number((costWhatsAppCents / 100).toFixed(2)) },
          { label: 'Google Maps', value: Number((costMapsCents / 100).toFixed(2)) },
        ]);
      } catch (err: unknown) {
        console.error('Error fetching consolidated usage metrics:', err);
        toast.error('Erro de Conexão', 'Não foi possível carregar as métricas financeiras consolidadas.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  if (isLoading || !metrics) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-[280px] bg-zinc-200 animate-pulse rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-zinc-100/60 animate-pulse rounded-2xl border border-border" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Custos & Margens Financeiras</h2>
        <p className="text-text-secondary text-sm mt-1">Consolidação em tempo real dos custos de IA/infraestrutura vs faturamento de MRR.</p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="bg-surface border-border">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">MRR Total Consolidado</span>
                <span className="text-3xl font-bold font-heading tracking-tight text-text font-mono">{metrics.mrrTotal}</span>
              </div>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-600 rounded-xl">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-text-muted font-medium mt-4">
              Total faturado via gateway Asaas recorrente
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">Lucro Líquido Real</span>
                <span className="text-3xl font-bold font-heading tracking-tight text-text font-mono">{metrics.netProfit}</span>
              </div>
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-xl">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-text-muted font-medium mt-4">
              MRR descontado custos de APIs ativas
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">Margem Operacional</span>
                <span className="text-3xl font-bold font-heading tracking-tight text-text font-mono">{metrics.marginPercent}%</span>
              </div>
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-xl">
                <Percent className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-text-muted font-medium mt-4">
              Alta rentabilidade de SaaS B2B
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Marginal Cost Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-surface border-border">
          <CardHeader>
            <CardTitle className="text-base font-bold font-heading text-text">Detalhamento Financeiro de Custos Operacionais</CardTitle>
            <CardDescription className="text-text-secondary text-xs">Divisão de faturamento consumido por APIs externas.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4">
            <div className="p-4 rounded-xl bg-surface-sunken/40 border border-border space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-text">
                <Cpu className="w-4 h-4 text-purple-600" />
                <span>OpenAI / Anthropic</span>
              </div>
              <div>
                <p className="text-sm font-bold font-mono text-text">{metrics.costLLM}</p>
                <p className="text-[10px] text-text-muted">Custo acumulado de tokens</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-sunken/40 border border-border space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-text">
                <Server className="w-4 h-4 text-blue-600" />
                <span>Evolution API</span>
              </div>
              <div>
                <p className="text-sm font-bold font-mono text-text">{metrics.costWhatsApp}</p>
                <p className="text-[10px] text-text-muted">Custos mensais de instâncias</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-sunken/40 border border-border space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-text">
                <Map className="w-4 h-4 text-emerald-600" />
                <span>Google Maps API</span>
              </div>
              <div>
                <p className="text-sm font-bold font-mono text-text">{metrics.costMaps}</p>
                <p className="text-[10px] text-text-muted">Enriquecimento e fit score</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cost Distribution Chart */}
        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle className="text-base font-bold font-heading text-text">Consumo em Reais</CardTitle>
            <CardDescription className="text-text-secondary text-xs">Comparativo de despesas.</CardDescription>
          </CardHeader>
          <CardContent className="py-4 flex items-end justify-center">
            <div className="w-full max-w-[280px]">
              <BarChart items={costBreakdown} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
