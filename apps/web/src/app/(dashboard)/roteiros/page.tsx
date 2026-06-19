'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@prospix/ui';
import { MessageSquare, ShieldAlert, BookOpen, CheckCircle, Plus, Wand2, ArrowRight, AlertTriangle } from 'lucide-react';
import { scriptsQueries, icpsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { apiFetch } from '@/lib/api-fetch';

type CategoryFilter = 'ALL' | 'APPROACH' | 'OBJECTION' | 'EDUCATION' | 'CLOSING';

const CATEGORY_MAP: Record<string, { label: string; icon: React.ElementType; colorClass: string; bgClass: string }> = {
  APPROACH: { label: 'Abordagem', icon: MessageSquare, colorClass: 'text-[#039855]', bgClass: 'bg-[#ECFDF3]' },
  OBJECTION: { label: 'Objeções', icon: ShieldAlert, colorClass: 'text-[#D92D20]', bgClass: 'bg-[#FEF3F2]' },
  EDUCATION: { label: 'Educação', icon: BookOpen, colorClass: 'text-[#1B3A6B]', bgClass: 'bg-[rgba(27,58,107,0.08)]' },
  CLOSING: { label: 'Fechamento', icon: CheckCircle, colorClass: 'text-[#B8740E]', bgClass: 'bg-[rgba(232,152,28,0.08)]' },
};

export default function ScriptsListPage() {
  const router = useRouter();
  const tenantId = useAuthStore(state => state.tenantId);
  const [scripts, setScripts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<CategoryFilter>('ALL');

  // Onboarding Guardrail states
  const [hasIcps, setHasIcps] = useState<boolean | null>(null);
  const [showGuardrailModal, setShowGuardrailModal] = useState(false);
  const [guardrailTitle, setGuardrailTitle] = useState('');
  const [guardrailDesc, setGuardrailDesc] = useState('');
  const [guardrailActionText, setGuardrailActionText] = useState('');
  const [guardrailActionUrl, setGuardrailActionUrl] = useState('');

  const fetchScripts = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await scriptsQueries.list(tenantId);
      if (!error && data) {
        setScripts(data);
      }
    } catch (err) {
      console.error('Error fetching scripts', err);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  const fetchIcpsCheck = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data } = await icpsQueries.list(tenantId);
      setHasIcps((data || []).length > 0);
    } catch (err) {
      console.error('Error checking ICPs', err);
      setHasIcps(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchScripts();
    fetchIcpsCheck();
  }, [fetchScripts, fetchIcpsCheck]);

  const filteredScripts = scripts.filter(s => {
    if (activeTab === 'ALL') return true;
    return s.category === activeTab;
  });

  const handleCreateNew = async (generateWithAi = false) => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      let baseMessage = '';
      let variationsPayload: any[] = [];

      if (generateWithAi) {
        try {
          const res = await apiFetch('/api/scripts/generate', {
            method: 'POST',
            body: JSON.stringify({ niche: 'DOCTOR', product: 'DIT', tone: 'CONSULTATIVE' }),
          });
          const json = await res.json();
          if (res.ok && json?.data) {
            baseMessage = json.data.baseMessage || '';
            variationsPayload = (json.data.variations || []).map((v: any, i: number) => ({
              name: `Variação ${String.fromCharCode(65 + i)}`,
              weight: v.weight || Math.floor(100 / (json.data.variations.length || 1)),
              content: v.content || v.message || '',
              active: true,
            }));
          }
        } catch (err) {
          console.error('Erro ao gerar com IA', err);
        }
      }

      const { data, error } = await scriptsQueries.create(tenantId, {
        name: generateWithAi ? 'Roteiro IA (Gerado)' : 'Novo Roteiro',
        category: 'APPROACH',
        baseMessage: baseMessage,
      });

      if (!error && data?.id) {
        if (generateWithAi && variationsPayload.length > 0) {
          await scriptsQueries.update(tenantId, data.id, {
            variations: variationsPayload
          });
        }
        router.push(`/roteiros/${data.id}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuardrailAction = () => {
    setShowGuardrailModal(false);
    if (guardrailActionUrl === 'GENERATE_WITH_AI') {
      handleCreateNew(true);
    } else {
      router.push(guardrailActionUrl);
    }
  };

  return (
    <div className="flex flex-col h-full animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-2xl font-bold font-heading text-[#0F172A] mb-1.5">Roteiros da IA</h1>
          <p className="text-sm text-[#64748B]">Clique em qualquer roteiro pra editar o fluxo completo.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              if (hasIcps === false) {
                setGuardrailTitle('Criação de ICP Requerida');
                setGuardrailDesc('Para criar um Roteiro de IA, você precisa definir antes o seu Perfil de Cliente Ideal (ICP). O ICP orienta as preferências e regras que a IA utilizará na conversa.');
                setGuardrailActionText('Configurar meu primeiro ICP');
                setGuardrailActionUrl('/icps');
                setShowGuardrailModal(true);
              } else {
                handleCreateNew(true);
              }
            }}
            className="bg-[#F8F9FB] hover:bg-[#EEF0F3] text-[#0F172A] border border-[#E5E7EB] h-10 px-4 rounded-xl font-semibold shadow-sm flex items-center gap-2 transition-all"
          >
            <Wand2 className="w-4 h-4 text-[#1B3A6B]" />
            Gerar com IA
          </Button>
          <Button
            onClick={() => {
              if (scripts.length === 0) return;
              if (hasIcps === false) {
                setGuardrailTitle('Criação de ICP Requerida');
                setGuardrailDesc('Para criar um Roteiro de IA, você precisa definir antes o seu Perfil de Cliente Ideal (ICP). O ICP orienta as preferências e regras que a IA utilizará na conversa.');
                setGuardrailActionText('Configurar meu primeiro ICP');
                setGuardrailActionUrl('/icps');
                setShowGuardrailModal(true);
              } else {
                handleCreateNew(false);
              }
            }}
            disabled={scripts.length === 0}
            className="bg-[#1B3A6B] hover:bg-[#142C52] text-white h-10 px-4 rounded-xl font-semibold shadow-md shadow-[#1B3A6B]/20 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Novo Roteiro
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide shrink-0">
        <button
          onClick={() => setActiveTab('ALL')}
          className={`px-4 h-9 rounded-full text-[13px] font-semibold whitespace-nowrap transition-all border ${
            activeTab === 'ALL'
              ? 'bg-[#1B3A6B] text-white border-[#1B3A6B] shadow-sm'
              : 'bg-white text-[#475569] border-[#E5E7EB] hover:bg-[#F8F9FB] hover:border-[#CBD5E1]'
          }`}
        >
          Todos - {scripts.length}
        </button>
        {(['APPROACH', 'OBJECTION', 'EDUCATION', 'CLOSING'] as const).map(cat => {
          const count = scripts.filter(s => s.category === cat).length;
          const conf = CATEGORY_MAP[cat];
          return (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`px-4 h-9 rounded-full text-[13px] font-semibold whitespace-nowrap transition-all border ${
                activeTab === cat
                  ? 'bg-[#1B3A6B] text-white border-[#1B3A6B] shadow-sm'
                  : 'bg-white text-[#475569] border-[#E5E7EB] hover:bg-[#F8F9FB] hover:border-[#CBD5E1]'
              }`}
            >
              {conf?.label || cat}
              {count > 0 && <span className="ml-1.5 opacity-60 font-mono text-[11px]">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-[#E5E7EB] rounded-2xl h-[240px] animate-pulse" />
          ))}
        </div>
      ) : filteredScripts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white border border-dashed border-[#CBD5E1] rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-[#F8F9FB] rounded-2xl flex items-center justify-center mb-4">
            <MessageSquare className="w-8 h-8 text-[#94A3B8]" />
          </div>
          <h3 className="text-lg font-bold text-[#0F172A] mb-2">Nenhum roteiro encontrado</h3>
          <p className="text-sm text-[#64748B] max-w-[400px] mb-6">
            Você ainda não possui roteiros configurados para esta categoria. Crie um novo para treinar sua IA.
          </p>
          <Button
            onClick={() => {
              if (hasIcps === false) {
                setGuardrailTitle('Criação de ICP Requerida');
                setGuardrailDesc('Para criar um Roteiro de IA, você precisa definir antes o seu Perfil de Cliente Ideal (ICP). O ICP orienta as preferências e regras que a IA utilizará na conversa.');
                setGuardrailActionText('Configurar meu primeiro ICP');
                setGuardrailActionUrl('/icps');
                setShowGuardrailModal(true);
              } else {
                handleCreateNew(true);
              }
            }}
            className="bg-[#1B3A6B] text-white h-10 px-6 rounded-xl font-semibold shadow-md"
          >
            Criar Primeiro Roteiro
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 content-start pb-10">
          {filteredScripts.map(script => {
            const catConf = CATEGORY_MAP[script.category] || CATEGORY_MAP.APPROACH;
            const Icon = catConf?.icon || MessageSquare;
            
            // Format metrics
            const responseRate = script.response_rate ? `${Math.round(script.response_rate)}%` : '--';
            const conversionRate = script.conversion_rate ? `${Math.round(script.conversion_rate)}%` : '--';
            const variationsCount = script.variations?.length || 0;

            return (
              <div
                key={script.id}
                onClick={() => router.push(`/roteiros/${script.id}`)}
                className="bg-white border border-[#E5E7EB] rounded-2xl p-5 hover:border-[#1B3A6B]/30 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer group flex flex-col h-full relative overflow-hidden"
              >
                {/* Decorative top accent based on category */}
                <div className={`absolute top-0 left-0 w-full h-1 ${catConf?.bgClass || ''} opacity-50`} />

                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${catConf?.bgClass || ''}`}>
                      <Icon className={`w-5 h-5 ${catConf?.colorClass || ''}`} />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#0F172A] text-sm group-hover:text-[#1B3A6B] transition-colors line-clamp-1">
                        {script.name || 'Sem nome'}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge className="bg-[#F8F9FB] text-[#475569] border-[#E5E7EB] text-[10px] font-semibold px-1.5 py-0">
                          {catConf?.label || ''}
                        </Badge>
                        <Badge className={`text-[10px] font-bold px-1.5 py-0 ${script.status === 'ACTIVE' ? 'bg-[#ECFDF3] text-[#039855] border-[#D1FADF]' : 'bg-[#F1F3F6] text-[#475569] border-[#E5E7EB]'}`}>
                          {script.status === 'ACTIVE' ? 'Ativo' : 'Rascunho'}
                        </Badge>
                        {variationsCount > 0 && (
                          <span className="text-[11px] text-[#64748B] font-medium">
                            • {variationsCount} variaç{variationsCount === 1 ? 'ão' : 'ões'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0">
                    <ArrowRight className="w-4 h-4 text-[#1B3A6B]" />
                  </div>
                </div>

                {/* Message Snippet */}
                <div className="bg-[#F8F9FB] border border-[#EEF0F3] rounded-xl p-3.5 mb-5 flex-1 relative overflow-hidden">
                  <MessageSquare className="w-3.5 h-3.5 text-[#CBD5E1] absolute top-3 right-3" />
                  <p className="text-[12px] text-[#475569] italic leading-relaxed line-clamp-3 w-[90%]">
                    "{script.base_message || 'Nenhuma mensagem base configurada. Clique para editar.'}"
                  </p>
                </div>

                {/* Footer Metrics */}
                <div className="flex items-center justify-between pt-4 border-t border-[#F1F3F6] mt-auto">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">Resposta</div>
                      <div className="text-[13px] font-semibold text-[#0F172A]">{responseRate}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">Reunião</div>
                      <div className="text-[13px] font-semibold text-[#0F172A]">{conversionRate}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-[#64748B] font-medium">Treinada</div>
                    <div className="text-[11px] font-semibold text-[#0F172A]">{script.total_usages || 0} envios</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Onboarding Guardrail Modal */}
      {showGuardrailModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl w-full max-w-[420px] p-6 shadow-2xl border border-[#EEF0F3] animate-scaleIn space-y-4 text-center">
            <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-amber-600 border border-amber-100">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-bold text-[16px] text-[#0F172A]">{guardrailTitle}</h3>
              <p className="text-[12.5px] text-[#64748B] leading-relaxed">{guardrailDesc}</p>
            </div>
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleGuardrailAction}
                className="w-full h-10 rounded-xl text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                {guardrailActionText} <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowGuardrailModal(false)}
                className="w-full h-9 rounded-xl text-[12.5px] font-semibold bg-white border border-[#E5E7EB] hover:bg-[#F8F9FB] text-[#475569] transition-colors"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
