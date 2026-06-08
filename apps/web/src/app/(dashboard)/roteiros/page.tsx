'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Badge } from '@prospix/ui';
import { MessageSquare, ShieldAlert, BookOpen, CheckCircle, Plus, Wand2, ArrowRight } from 'lucide-react';
import { scriptsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';

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

  useEffect(() => {
    if (!tenantId) return;
    const fetchScripts = async () => {
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
    };
    fetchScripts();
  }, [tenantId]);

  const filteredScripts = scripts.filter(s => {
    if (activeTab === 'ALL') return true;
    return s.category === activeTab;
  });

  const handleCreateNew = async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await scriptsQueries.create(tenantId, {
        name: 'Novo Roteiro',
        category: 'APPROACH',
        baseMessage: '',
      });
      if (!error && data?.id) {
        router.push(`/roteiros/${data.id}`);
      }
    } catch (err) {
      console.error(err);
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
            onClick={() => {}} // Will hook this up to AI modal later
            className="bg-[#F8F9FB] hover:bg-[#EEF0F3] text-[#0F172A] border border-[#E5E7EB] h-10 px-4 rounded-xl font-semibold shadow-sm flex items-center gap-2 transition-all"
          >
            <Wand2 className="w-4 h-4 text-[#1B3A6B]" />
            Gerar com IA
          </Button>
          <Button
            onClick={handleCreateNew}
            className="bg-[#1B3A6B] hover:bg-[#142C52] text-white h-10 px-4 rounded-xl font-semibold shadow-md shadow-[#1B3A6B]/20 flex items-center gap-2 transition-all"
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
          <Button onClick={handleCreateNew} className="bg-[#1B3A6B] text-white h-10 px-6 rounded-xl font-semibold shadow-md">
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
    </div>
  );
}
