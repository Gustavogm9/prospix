'use client';

import { Info, ArrowUp, Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dashboardQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { toast } from '@prospix/ui';

interface PerformanceData {
  total_policy_cents: number;
  total_commission_cents: number;
  sales_count: number;
}

interface FunnelData {
  stages: Record<string, number>;
  total_leads: number;
  metrics: {
    win_rate_percent: number;
    qualified_rate_percent: number;
  };
}

export default function Performance() {
  const [period, setPeriod] = useState<'week' | 'month' | '90d'>('month');
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [funnelData, setFunnelData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);

  const tenantId = useAuthStore(state => state.tenantId);

  useEffect(() => {
    const fetchAll = async () => {
      if (!tenantId) return;
      setLoading(true);
      try {
        const [perfRes, funnelRes] = await Promise.all([
          dashboardQueries.performance(tenantId),
          dashboardQueries.funnel(tenantId),
        ]);
        setPerfData(perfRes.data ?? null);
        setFunnelData(funnelRes.data ?? null);
      } catch (err) {
        console.error('Failed to fetch performance data', err);
        toast.error('Erro ao carregar', 'Não foi possível carregar métricas de performance.');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [period, tenantId]);

  const fmt = (cents: number) => {
    const val = cents / 100;
    if (val >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
    return `R$ ${val.toFixed(0)}`;
  };

  const cards = [
    { 
      label: 'Receita em apólices', 
      value: fmt(perfData?.total_policy_cents ?? 0), 
      unit: '', 
      delta: perfData?.sales_count ? `${perfData.sales_count} apólices fechadas` : 'Nenhuma ainda', 
      up: true 
    },
    { 
      label: 'Comissão acumulada', 
      value: fmt(perfData?.total_commission_cents ?? 0), 
      unit: '', 
      delta: perfData?.total_policy_cents ? `${((perfData.total_commission_cents / perfData.total_policy_cents) * 100).toFixed(0)}% do volume` : '-', 
      up: true 
    },
    { 
      label: 'Taxa de fechamento', 
      value: `${funnelData?.metrics?.win_rate_percent?.toFixed(0) ?? 0}`, 
      unit: '%', 
      delta: `${funnelData?.metrics?.qualified_rate_percent?.toFixed(0) ?? 0}% qualificados`, 
      up: true 
    },
    { 
      label: 'Total de leads', 
      value: `${funnelData?.total_leads ?? 0}`, 
      unit: '', 
      delta: `${funnelData?.stages?.CLOSED_WON ?? 0} fechados`, 
      up: true 
    },
  ];

  const funnelStages = funnelData?.stages ? [
    { name: 'Novos', value: funnelData.stages.NEW || 0, color: '#1B3A6B' },
    { name: 'Contatados', value: funnelData.stages.CONTACTED || 0, color: '#3b82f6' },
    { name: 'Qualificados', value: funnelData.stages.QUALIFIED || 0, color: '#6366f1' },
    { name: 'Negociação', value: funnelData.stages.NEGOTIATING || 0, color: '#06b6d4' },
    { name: 'Fechados ✓', value: funnelData.stages.CLOSED_WON || 0, color: '#039855' },
    { name: 'Perdidos', value: funnelData.stages.CLOSED_LOST || 0, color: '#D92D20' },
  ] : [];

  const maxFunnelValue = Math.max(...funnelStages.map(s => s.value), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-60">
        <Loader2 className="w-6 h-6 text-[#1B3A6B] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Sua performance geral.</strong> Dados reais do CRM — apólices, comissões, funil e taxas de conversão.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm">
        <button onClick={() => setPeriod('week')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${period === 'week' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Esta semana</button>
        <button onClick={() => setPeriod('month')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${period === 'month' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Este mês</button>
        <button onClick={() => setPeriod('90d')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${period === '90d' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Últimos 90 dias</button>
        <div className="w-px h-6 bg-[#E5E7EB] mx-1" />
        <button onClick={() => {
          if (!perfData && !funnelData) { toast.error('Sem dados', 'Carregue os dados antes de exportar.'); return; }
          const fStages = funnelData?.stages || {};
          const lines = [
            ['Métrica', 'Valor'],
            ['Receita em apólices (R$)', String((perfData?.total_policy_cents ?? 0) / 100)],
            ['Comissão acumulada (R$)', String((perfData?.total_commission_cents ?? 0) / 100)],
            ['Vendas fechadas', String(perfData?.sales_count ?? 0)],
            ['Taxa de conversão (%)', String(funnelData?.metrics?.win_rate_percent ?? 0)],
            ['---', '---'],
            ['Etapa do Funil', 'Leads'],
            ...Object.entries(fStages).map(([k, v]) => [k, String(v)]),
          ];
          const csv = lines.map(r => r.join(';')).join('\n');
          const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `relatorio-performance-${period}.csv`; a.click();
          URL.revokeObjectURL(url);
          toast.success('Relatório exportado', 'O CSV foi baixado com sucesso.');
        }} className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] ml-auto flex items-center gap-1.5">
          <Download className="w-3 h-3" />
          Exportar relatório
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
            <div className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-1.5">{card.label}</div>
            <div className="text-[26px] font-bold text-[#0F172A] font-mono tracking-tight leading-none">
              {card.value}
              {card.unit && <span className="text-[14px] text-[#64748B] font-sans font-medium">{card.unit}</span>}
            </div>
            <div className="text-[11.5px] font-semibold mt-2 flex items-center gap-1 text-[#027A48]">
              <ArrowUp className="w-3 h-3" />
              {card.delta}
            </div>
          </div>
        ))}
      </div>

      {/* Funnel visualization */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
          <div className="text-[14px] font-semibold text-[#0F172A]">Funil de conversão</div>
          <div className="text-[11px] text-[#64748B] mt-0.5">Distribuição real de leads por estágio</div>
        </div>
        <div className="p-5 space-y-3">
          {funnelStages.map((s, i) => (
            <div key={i}>
              <div className="flex justify-between text-[12.5px] mb-1.5">
                <span className="font-semibold text-[#0F172A]">{s.name}</span>
                <span className="font-bold font-mono" style={{ color: s.color }}>{s.value}</span>
              </div>
              <div className="h-2 bg-[#F1F3F6] rounded-full overflow-hidden" title={`${s.name}: ${s.value} leads`}>
                <div className="h-full rounded-full transition-all" style={{ width: `${(s.value / maxFunnelValue) * 100}%`, background: s.color }} />
              </div>
            </div>
          ))}
          {funnelStages.length === 0 && (
            <div className="text-center text-[12px] text-[#64748B] py-6">Nenhum dado de funil disponível</div>
          )}
        </div>
      </div>
    </div>
  );
}
