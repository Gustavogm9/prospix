'use client';

import { AlertTriangle, Cpu, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dashboardQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { toast } from '@prospix/ui';

interface AIUsageData {
  llm_cost_cents: number;
  whatsapp_cost_cents: number;
  maps_cost_cents: number;
  total_costs_cents: number;
  limit: {
    max_limit_cents: number;
    used_percent: number;
    remaining_cents: number;
  };
}

export default function AIConsumption() {
  const tenantId = useAuthStore(state => state.tenantId);
  const [data, setData] = useState<AIUsageData | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    dashboardQueries.aiUsage(tenantId)
      .then(result => {
        if (result.error) throw new Error(result.error.message);
        setData(result.data);
      })
      .catch(() => {
        toast.error('Erro ao carregar', 'Não foi possível carregar dados de consumo.');
        setData({
          llm_cost_cents: 0, whatsapp_cost_cents: 0, maps_cost_cents: 0,
          total_costs_cents: 0,
          limit: { max_limit_cents: 0, used_percent: 0, remaining_cents: 0 }
        });
      });
  }, [tenantId]);

  const fmt = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`;

  const costs = [
    { label: 'IA (LLM)', value: data?.llm_cost_cents ?? 0, color: '#1B3A6B' },
    { label: 'WhatsApp', value: data?.whatsapp_cost_cents ?? 0, color: '#25D366' },
    { label: 'Google Maps', value: data?.maps_cost_cents ?? 0, color: '#4285F4' },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Cpu className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Consumo de IA</strong> mostra quanto sua máquina está gastando com LLM, WhatsApp e Google Maps neste mês.</div>
      </div>

      {/* Usage meter */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
          <div className="text-[14px] font-semibold text-[#0F172A]">Consumo do mês</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">
              {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · plano inclui {fmt(data?.limit?.max_limit_cents ?? 0)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[22px] font-bold text-[#0F172A] font-mono">{fmt(data?.total_costs_cents ?? 0)}</div>
            <div className="text-[11px] text-[#64748B]">de {fmt(data?.limit?.max_limit_cents ?? 0)}</div>
          </div>
        </div>
        <div className="h-3 bg-[#F1F3F6] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#1B3A6B] to-[#E8981C] rounded-full transition-all"
            style={{ width: `${Math.min(data?.limit?.used_percent ?? 0, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[10.5px] text-[#64748B] font-mono">
          <span>{(data?.limit?.used_percent ?? 0).toFixed(1)}% usado</span>
          <span>Restante: {fmt(data?.limit?.remaining_cents ?? 0)}</span>
        </div>
        {(data?.limit?.used_percent ?? 0) > 80 && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-[#FEF3F2] border border-[rgba(217,45,32,0.2)] rounded-lg text-[11.5px] text-[#D92D20]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Atenção: você já usou mais de 80% do seu limite mensal.
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {costs.map((c, i) => (
          <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ background: c.color }} />
              <span className="text-[12px] font-semibold text-[#0F172A]">{c.label}</span>
            </div>
            <div className="text-[22px] font-bold text-[#0F172A] font-mono">{fmt(c.value)}</div>
            <div className="text-[11px] text-[#64748B] mt-1">
              {data?.total_costs_cents ? ((c.value / data.total_costs_cents) * 100).toFixed(0) : 0}% do total
            </div>
          </div>
        ))}
      </div>

      {/* Distribution chart */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
          <div className="text-[14px] font-semibold text-[#0F172A]">Distribuição de custos</div>
          <div className="text-[11px] text-[#64748B] mt-0.5">Proporção de gastos por categoria neste mês</div>
        </div>
        <div className="p-5">
          <div className="space-y-3">
            {costs.map((c, i) => {
              const total = data?.total_costs_cents || 1;
              const pct = (c.value / total) * 100;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                      <span className="text-[12px] font-medium text-[#0F172A]">{c.label}</span>
                    </div>
                    <span className="text-[12px] font-mono font-semibold text-[#0F172A]">{fmt(c.value)}</span>
                  </div>
                  <div className="h-2 bg-[#F1F3F6] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 1)}%`, background: c.color }} />
                  </div>
                  <div className="text-[10px] text-[#64748B] mt-0.5 text-right font-mono">{pct.toFixed(1)}%</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(27,58,107,0.04)] rounded-lg text-[12px] text-[#475569]">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div>Os custos são atualizados em tempo real conforme a IA trabalha. Ultrapassar o limite pausa a máquina até o próximo ciclo.</div>
      </div>
    </div>
  );
}
