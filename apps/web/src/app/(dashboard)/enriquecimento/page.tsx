'use client';

import { useEffect, useState } from 'react';
import { Loader2, Cpu, ArrowRight, AlertCircle, X } from 'lucide-react';
import { leadSourcesQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { toast } from '@prospix/ui';

interface DBLeadSource {
  id: string;
  tenant_id: string;
  source_type: string;
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  config: any;
  addon_id: string | null;
}

interface SourceStats {
  total: number;
  last30Days: number;
  whatsappValid: number;
}

interface StaticSource {
  type: string;
  name: string;
  description: string;
  longDescription: string;
  isPremium: boolean;
  costText: string;
  icon: string;
  color: string;
  badgeColor: string;
  borderColor: string;
}

const STATIC_SOURCES: StaticSource[] = [
  {
    type: 'CNPJ_PREMIUM',
    name: 'Porte & Faturamento (CNPJ Premium)',
    description: 'Enriquece com faturamento e porte estimado.',
    longDescription: 'Integra faturamento anual estimado e porte (ME, EPP, Médias/Grandes) para segmentar e qualificar as melhores empresas no funil.',
    isPremium: true,
    costText: 'R$ 149/mês',
    icon: '📊',
    color: 'from-amber-100/60 to-amber-200/30 text-amber-800',
    badgeColor: 'bg-amber-200/70 text-amber-800 border-amber-300/50',
    borderColor: 'border-amber-200 hover:border-amber-300'
  },
  {
    type: 'SOCIO_CONTACT',
    name: 'Contato Direto do Sócio (QSA Cell Finder)',
    description: 'WhatsApp celular dos sócios administradores.',
    longDescription: 'Identifica o WhatsApp celular direto dos sócios e decisores do CNPJ para contornar telefones fixos de recepções.',
    isPremium: true,
    costText: 'R$ 199/mês',
    icon: '👤',
    color: 'from-blue-100/60 to-blue-200/30 text-blue-800',
    badgeColor: 'bg-blue-200/70 text-blue-800 border-blue-300/50',
    borderColor: 'border-blue-200 hover:border-blue-300'
  },
  {
    type: 'CYBER_RISK',
    name: 'Análise de Vulnerabilidade (Cyber Risk)',
    description: 'Varredura de riscos digitais e LGPD.',
    longDescription: 'Identifica SSL ausente, falta de políticas de privacidade e brechas no site corporativo. O gatilho comercial perfeito para Seguro Cyber.',
    isPremium: true,
    costText: 'R$ 149/mês',
    icon: '🛡️',
    color: 'from-red-100/60 to-red-200/30 text-red-800',
    badgeColor: 'bg-red-200/70 text-red-800 border-red-300/50',
    borderColor: 'border-red-200 hover:border-red-300'
  },
  {
    type: 'ADS_TRACKER',
    name: 'Rastreador de Tráfego Pago (Ads Tracker)',
    description: 'Detecta investimento ativo em anúncios online.',
    longDescription: 'Identifica pixels do Google Ads e Facebook no site do lead para indicar verba de crescimento e qualificar para benefícios PME.',
    isPremium: true,
    costText: 'R$ 79/mês',
    icon: '📈',
    color: 'from-indigo-100/60 to-indigo-200/30 text-indigo-800',
    badgeColor: 'bg-indigo-200/70 text-indigo-800 border-indigo-300/50',
    borderColor: 'border-indigo-200 hover:border-indigo-300'
  },
  {
    type: 'EMAIL_SCRAPER',
    name: 'Extrator de E-mails Corporativos',
    description: 'Localiza e-mails diretos expostos no website.',
    longDescription: 'Vasculha o domínio do lead para capturar e-mails institucionais e de departamentos, permitindo abordagens comerciais multicanais.',
    isPremium: true,
    costText: 'R$ 89/mês',
    icon: '📧',
    color: 'from-emerald-100/60 to-emerald-200/30 text-emerald-800',
    badgeColor: 'bg-emerald-200/70 text-emerald-800 border-emerald-300/50',
    borderColor: 'border-emerald-200 hover:border-emerald-300'
  },
  {
    type: 'FLEET_TRACKER',
    name: 'Rastreador de Frotas & ANTT',
    description: 'Mapeia veículos comerciais e licenças ANTT.',
    longDescription: 'Cruza dados de registros de transporte (ANTT) e frotas ativas no CNPJ para qualificar oportunidades de Seguro de Frota e Carga.',
    isPremium: true,
    costText: 'R$ 199/mês',
    icon: '🚛',
    color: 'from-orange-100/60 to-orange-200/30 text-orange-800',
    badgeColor: 'bg-orange-200/70 text-orange-800 border-orange-300/50',
    borderColor: 'border-orange-200 hover:border-orange-300'
  },
  {
    type: 'JUDICIAL_TRACKER',
    name: 'Histórico de Risco Judicial',
    description: 'Rastreia processos civis, trabalhistas e fiscais.',
    longDescription: 'Identifica processos ativos e passivos nos tribunais vinculados ao CNPJ e sócios. O gatilho comercial perfeito para Seguro D&O.',
    isPremium: true,
    costText: 'R$ 249/mês',
    icon: '⚖️',
    color: 'from-yellow-100/60 to-yellow-200/30 text-yellow-800',
    badgeColor: 'bg-yellow-200/70 text-yellow-800 border-yellow-300/50',
    borderColor: 'border-yellow-200 hover:border-yellow-300'
  },
  {
    type: 'TECHNOGRAPHIC',
    name: 'Detector de Stacks Tecnológicas',
    description: 'Mapeia CRMs, e-commerces e analytics em uso.',
    longDescription: 'Identifica se a empresa utiliza softwares de alto valor (HubSpot, Salesforce, VTEX, Shopify) qualificando maturidade digital.',
    isPremium: true,
    costText: 'R$ 99/mês',
    icon: '⚙️',
    color: 'from-slate-100/60 to-slate-200/30 text-slate-800',
    badgeColor: 'bg-slate-200/70 text-slate-800 border-slate-300/50',
    borderColor: 'border-slate-200 hover:border-slate-300'
  }
];

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

function Switch({ checked, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? 'bg-[#1B3A6B]' : 'bg-[#E5E7EB]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function DataEnrichment() {
  const tenantId = useAuthStore(state => state.tenantId);
  const [dbSources, setDbSources] = useState<DBLeadSource[]>([]);
  const [stats, setStats] = useState<Record<string, SourceStats>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [selectedPremiumSource, setSelectedPremiumSource] = useState<StaticSource | null>(null);
  const [submittingPremium, setSubmittingPremium] = useState(false);
  const [togglingSource, setTogglingSource] = useState<string | null>(null);

  const fetchData = async () => {
    if (!tenantId) return;
    try {
      const [listResult, statsResult] = await Promise.all([
        leadSourcesQueries.list(tenantId),
        leadSourcesQueries.getStats(tenantId)
      ]);

      if (listResult.error) throw new Error(listResult.error.message);
      if (statsResult.error) throw new Error(statsResult.error.message);

      setDbSources(listResult.data || []);
      setStats(statsResult.data || {});
    } catch (err) {
      console.error('Failed to load enrichment addons', err);
      toast.error('Erro ao carregar', 'Não foi possível carregar as inteligências de enriquecimento.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenantId]);

  const getSourceStatus = (type: string, isPremium: boolean): 'ACTIVE' | 'PAUSED' | 'DISABLED' => {
    const dbSrc = dbSources.find(s => s.source_type === type);
    if (dbSrc) return dbSrc.status;
    return isPremium ? 'DISABLED' : 'ACTIVE';
  };

  const handleToggle = async (type: string, currentStatus: 'ACTIVE' | 'PAUSED' | 'DISABLED') => {
    if (!tenantId) return;
    if (currentStatus === 'DISABLED') return;

    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setTogglingSource(type);

    try {
      const result = await leadSourcesQueries.toggle(tenantId, type, newStatus);
      if (result.error) throw new Error(result.error.message);

      toast.success(
        newStatus === 'ACTIVE' ? 'Enriquecedor Ativado' : 'Enriquecedor Pausado',
        `A inteligência ${STATIC_SOURCES.find(s => s.type === type)?.name} foi ${newStatus === 'ACTIVE' ? 'ativada' : 'pausada'} com sucesso.`
      );
      
      setDbSources(prev => {
        const idx = prev.findIndex(s => s.source_type === type);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: newStatus as 'ACTIVE' | 'PAUSED' | 'DISABLED' } as DBLeadSource;
          return updated;
        } else {
          return [...prev, { id: 'temp', tenant_id: tenantId, source_type: type, status: newStatus as 'ACTIVE' | 'PAUSED' | 'DISABLED', config: {}, addon_id: null } as DBLeadSource];
        }
      });
    } catch (err: any) {
      console.error('Failed to toggle enrichment addon', err);
      toast.error('Erro ao atualizar', err.message || 'Ocorreu um erro ao atualizar o status da inteligência.');
    } finally {
      setTogglingSource(null);
    }
  };

  const handleActivatePremium = async () => {
    if (!tenantId || !selectedPremiumSource) return;
    setSubmittingPremium(true);

    try {
      const result = await leadSourcesQueries.activatePremium(tenantId, selectedPremiumSource.type as any);
      if (result.error) throw new Error(result.error.message);

      toast.success(
        'Inteligência Premium Contratada!',
        `O enriquecedor premium ${selectedPremiumSource.name} foi contratado e integrado ao fluxo.`
      );

      await fetchData();
      setShowPremiumModal(false);
      setSelectedPremiumSource(null);
    } catch (err: any) {
      console.error('Failed to activate premium enrichment addon', err);
      toast.error('Erro na contratação', err.message || 'Não foi possível contratar a inteligência premium.');
    } finally {
      setSubmittingPremium(false);
    }
  };

  const mappedSources = STATIC_SOURCES.map(src => {
    const status = getSourceStatus(src.type, src.isPremium);
    const sourceStats = stats[src.type] || { total: 0, last30Days: 0, whatsappValid: 0 };
    return {
      ...src,
      status,
      stats: sourceStats
    };
  });

  const filtered = mappedSources.filter(src => {
    if (filter === 'active') return src.status === 'ACTIVE';
    if (filter === 'paused') return src.status === 'PAUSED' || src.status === 'DISABLED';
    return true;
  });

  const activeCount = mappedSources.filter(s => s.status === 'ACTIVE').length;
  const pausedOrDisabledCount = mappedSources.filter(s => s.status !== 'ACTIVE').length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-3">
        <Loader2 className="w-8 h-8 text-[#1B3A6B] animate-spin" />
        <span className="text-[13px] text-[#64748B] font-medium">Carregando inteligências de enriquecimento...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      {/* Header Info Banner */}
      <div className="flex items-center gap-3.5 px-4.5 py-4 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shadow-sm">
        <Cpu className="w-5 h-5 text-[#1B3A6B] shrink-0" />
        <div>
          <strong className="text-[#1B3A6B]">Inteligência e Enriquecimento de Dados.</strong> Ative add-ons premium para enriquecer automaticamente os leads capturados com informações fiscais, vulnerabilidades cibernéticas, presença social, frotas e risco judicial.
        </div>
      </div>

      {/* Toolbar & Stats Overview */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-3.5 flex items-center justify-between gap-4 flex-wrap shadow-sm">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setFilter('all')} 
            className={`h-8.5 px-4 rounded-lg text-[12px] font-semibold transition-all ${
              filter === 'all' 
                ? 'bg-[#1B3A6B] text-white shadow-sm' 
                : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F8FAFC]'
            }`}
          >
            Todas · {mappedSources.length}
          </button>
          <button 
            onClick={() => setFilter('active')} 
            className={`h-8.5 px-4 rounded-lg text-[12px] font-semibold transition-all ${
              filter === 'active' 
                ? 'bg-[#1B3A6B] text-white shadow-sm' 
                : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F8FAFC]'
            }`}
          >
            Ativas · {activeCount}
          </button>
          <button 
            onClick={() => setFilter('paused')} 
            className={`h-8.5 px-4 rounded-lg text-[12px] font-semibold transition-all ${
              filter === 'paused' 
                ? 'bg-[#1B3A6B] text-white shadow-sm' 
                : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F8FAFC]'
            }`}
          >
            Pausadas/Desativadas · {pausedOrDisabledCount}
          </button>
        </div>
        
        <div className="flex items-center gap-4.5 text-[12px] text-[#475569] font-medium mr-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
            <span>Rotina Periódica Ativa</span>
          </div>
        </div>
      </div>

      {/* Sources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        {filtered.map(src => {
          const isActive = src.status === 'ACTIVE';
          const isDisabled = src.status === 'DISABLED';
          
          // Calculate WhatsApp Validity rate
          const whatsappRate = src.stats.total > 0 
            ? Math.round((src.stats.whatsappValid / src.stats.total) * 100)
            : 0;

          return (
            <div 
              key={src.type} 
              className={`bg-white border rounded-xl p-5 flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${src.borderColor} ${
                isDisabled ? 'opacity-85 border-dashed border-[#CBD5E1]' : ''
              }`}
            >
              <div>
                {/* Card Top: Icon & Toggle/Button */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${src.color} flex items-center justify-center text-[22px] shrink-0 shadow-sm border border-black/[0.03]`}>
                    {src.icon}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {isDisabled ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        Premium
                      </span>
                    ) : isActive ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Ativa
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200/50">
                        Pausada
                      </span>
                    )}
                  </div>
                </div>

                {/* Source Title & Descriptions */}
                <h3 className="text-[14.5px] font-bold text-[#0F172A] mb-1 flex items-center gap-1.5">
                  {src.name}
                </h3>
                <p className="text-[12px] text-[#475569] font-medium leading-tight mb-2.5">{src.description}</p>
                <p className="text-[11px] text-[#64748B] leading-relaxed mb-4 min-h-[50px]">{src.longDescription}</p>
              </div>

              {/* Card Footer: KPIs & Bottom Action */}
              <div className="border-t border-[#F1F3F9] pt-4 mt-2 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#F8FAFC] rounded-lg p-2 border border-[#F1F5F9]">
                    <div className="text-[13px] font-bold text-[#0F172A]">
                      {src.stats.total}
                    </div>
                    <div className="text-[9.5px] text-[#64748B] font-medium tracking-tight">Leads Processados</div>
                  </div>
                  
                  <div className="bg-[#F8FAFC] rounded-lg p-2 border border-[#F1F5F9]">
                    <div className="text-[13px] font-bold text-[#0F172A]">
                      {src.stats.total > 0 ? `${whatsappRate}%` : '—'}
                    </div>
                    <div className="text-[9.5px] text-[#64748B] font-medium tracking-tight">Whats Válido</div>
                  </div>
                  
                  <div className="bg-[#F8FAFC] rounded-lg p-2 border border-[#F1F5F9] flex flex-col justify-center">
                    <div className="text-[10px] font-bold text-[#0F172A] leading-tight">
                      {src.costText}
                    </div>
                    <div className="text-[9.5px] text-[#64748B] font-medium tracking-tight">Custo</div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-[#64748B]">
                    {src.stats.last30Days > 0 ? `+${src.stats.last30Days} nos últimos 30 dias` : 'Sem atividades recentes'}
                  </span>
                  
                  {isDisabled ? (
                    <button 
                      onClick={() => {
                        setSelectedPremiumSource(src);
                        setShowPremiumModal(true);
                      }} 
                      className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#1B3A6B] to-[#2E5894] hover:from-[#142C52] hover:to-[#1B3A6B] text-white text-[11px] font-bold transition-all shadow-sm flex items-center gap-1"
                    >
                      Ativar Inteligência
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] text-[#64748B] font-medium">
                        {isActive ? 'Ativo' : 'Pausado'}
                      </span>
                      <Switch 
                        checked={isActive} 
                        disabled={togglingSource === src.type} 
                        onChange={() => handleToggle(src.type, src.status)} 
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ Add-on Premium Modal ═══ */}
      {showPremiumModal && selectedPremiumSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn" onClick={() => !submittingPremium && setShowPremiumModal(false)}>
          <div 
            className="bg-white rounded-xl shadow-xl border border-[#E2E8F0] w-full max-w-md mx-4 overflow-hidden transform transition-all animate-scaleUp"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F3F9] bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="text-[18px]">🚀</span>
                <h3 className="text-[14.5px] font-bold text-[#0F172A]">Contratar Enriquecedor Premium</h3>
              </div>
              <button 
                onClick={() => !submittingPremium && setShowPremiumModal(false)} 
                disabled={submittingPremium}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#E2E8F0] text-[#64748B] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-4 bg-blue-50/50 p-4 border border-blue-100 rounded-xl">
                <div className="w-12 h-12 rounded-lg bg-blue-100/50 text-[#1B3A6B] flex items-center justify-center text-[24px] shrink-0 border border-blue-200/30">
                  {selectedPremiumSource.icon}
                </div>
                <div>
                  <h4 className="text-[13.5px] font-bold text-[#0F172A]">{selectedPremiumSource.name}</h4>
                  <p className="text-[11px] text-[#475569] leading-relaxed mt-0.5">
                    {selectedPremiumSource.longDescription}
                  </p>
                </div>
              </div>

              {/* Price details */}
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#64748B] font-medium">Assinatura Mensal</span>
                  <span className="font-bold text-[#0F172A]">{selectedPremiumSource.costText}</span>
                </div>
                <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#64748B] font-medium">Integração do Fluxo</span>
                  <span className="text-[#10B981] font-semibold">Inclusa</span>
                </div>
                <div className="h-px bg-[#E2E8F0] my-2" />
                <div className="flex justify-between items-center text-[12.5px]">
                  <span className="text-[#0F172A] font-bold">Total Adicional</span>
                  <span className="text-[#1B3A6B] font-extrabold text-[14px]">{selectedPremiumSource.costText}/mês</span>
                </div>
              </div>

              {/* Alerts and terms */}
              <div className="flex items-start gap-2 text-[10.5px] text-[#64748B] leading-normal bg-amber-50/40 border border-amber-100/60 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  Ao confirmar, o add-on será adicionado à fatura mensal do seu tenant. A ativação é automática e você poderá desativar a qualquer momento nas configurações de plano.
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-5 py-4 border-t border-[#F1F3F9] bg-slate-50/50 flex items-center justify-end gap-3.5">
              <button 
                onClick={() => setShowPremiumModal(false)}
                disabled={submittingPremium}
                className="h-8.5 px-4.5 rounded-lg border border-[#E2E8F0] text-[#475569] text-[12px] font-semibold hover:bg-white transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleActivatePremium}
                disabled={submittingPremium}
                className="h-8.5 px-5 rounded-lg bg-[#1B3A6B] hover:bg-[#142C52] text-white text-[12px] font-bold shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {submittingPremium ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Contratando...
                  </>
                ) : (
                  <>
                    Confirmar Contratação
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
