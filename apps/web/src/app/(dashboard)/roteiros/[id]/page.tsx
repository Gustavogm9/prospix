'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button, Input, Textarea, toast, Badge } from '@prospix/ui';
import { 
  Sparkles, MessageSquare, Plus, Save, Trash2, Wand2, X, 
  Bot, ShieldAlert, GitBranch, ArrowLeft, BarChart2, Settings,
  ToggleRight, ToggleLeft, Copy
} from 'lucide-react';
import { scriptsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { apiFetch } from '@/lib/api-fetch';
import { ScriptFlowBuilder } from './ScriptFlowBuilder';

type ActiveTab = 'FLUXO' | 'MESSAGES' | 'PERFORMANCE' | 'CONFIG';

interface ScriptVariation {
  id: string;
  name: string;
  weight: number;
  content: string;
}

const VARIATION_COLORS = ['bg-[#039855]', 'bg-[#1B3A6B]', 'bg-[#E47320]', 'bg-[#5A2A82]'];

export default function ScriptDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const scriptId = params.id as string;
  const tenantId = useAuthStore(state => state.tenantId);
  
  const [activeTab, setActiveTab] = useState<ActiveTab>('FLUXO');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Script State
  const [name, setName] = useState('Novo Roteiro');
  const [category, setCategory] = useState('APPROACH');
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [baseMessage, setBaseMessage] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [variations, setVariations] = useState<ScriptVariation[]>([]);
  const [aiTools, setAiTools] = useState<string[]>(['calendar', 'forward']);

  // AI Gen State
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState('DOCTOR');
  const [selectedProduct, setSelectedProduct] = useState('DIT');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!tenantId || !scriptId) return;
    
    const fetchScript = async () => {
      try {
        const { data, error } = await scriptsQueries.list(tenantId);
        if (!error && data) {
          
          if (scriptId === 'new') {
            setIsLoading(false);
            return;
          }

          const script = data.find((s: any) => s.id === scriptId);
          if (script) {
            setName(script.name || 'Sem nome');
            setCategory(script.category || 'APPROACH');
            setStatus(script.status || 'ACTIVE');
            setBaseMessage(script.base_message || '');
            setAiTools(script.ai_tools || ['calendar', 'forward']);
            // in a real scenario ai_instructions would be fetched from DB
            setAiInstructions(script.ai_instructions || 'Você é um consultor MetLife focado em fechar reuniões de 10 min. Seja direto e não mande áudios.');

            const vars = script.variations || [];
            if (vars.length > 0) {
              setVariations(vars.map((v: any, i: number) => ({
                id: v.id || Date.now().toString() + i,
                name: v.name || `Variação ${String.fromCharCode(65 + i)}`,
                weight: v.weight ? Math.round(v.weight * 100) : 0,
                content: v.content || v.message || '',
              })));
            }
          } else {
            toast.error('Roteiro não encontrado');
            router.push('/roteiros');
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchScript();
  }, [tenantId, scriptId, router]);

  const handleSave = async () => {
    if (!tenantId) return;
    
    if (variations.length > 0) {
      const totalWeight = variations.reduce((acc, v) => acc + v.weight, 0);
      if (totalWeight !== 100) {
        toast.error('Erro de validação', 'A soma dos pesos das variações deve ser exatamente 100%');
        return;
      }
    }

    setIsSaving(true);
    try {
      const mappedVariations = variations.map(v => ({
        id: v.id.startsWith('temp_') ? undefined : v.id,
        name: v.name,
        weight: v.weight,
        content: v.content,
      }));

      // aiTools and aiInstructions should be passed here in a real scenario
      if (scriptId === 'new') {
        const { data, error } = await scriptsQueries.create(tenantId, {
          name, category, baseMessage
        });
        if (data?.id) {
          await scriptsQueries.update(tenantId, data.id, { status, aiTools, variations: mappedVariations });
        }
        if (error) throw error;
        toast.success('Roteiro salvo com sucesso');
        router.replace(`/roteiros/${data?.id}`);
      } else {
        const { error } = await scriptsQueries.update(tenantId, scriptId, {
          name, category, baseMessage, variations: mappedVariations, status, aiTools
        });
        if (error) throw error;
        toast.success('Roteiro atualizado com sucesso');
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar', 'Ocorreu um erro ao gravar o roteiro.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateAI = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    try {
      const res = await apiFetch('/api/scripts/generate', {
        method: 'POST',
        body: JSON.stringify({ niche: selectedNiche, product: selectedProduct, tone: 'CONSULTATIVE' }),
      });
      const json = await res.json();
      if (json?.data) {
        setBaseMessage(json.data.baseMessage);
        const mapped = (json.data.variations || []).map((v: any, i: number) => ({
          id: `temp_${Date.now()}_${i}`,
          name: `Variação ${String.fromCharCode(65 + i)}`,
          weight: v.weight || Math.floor(100 / (json.data.variations.length || 1)),
          content: v.content || '',
        }));
        setVariations(mapped);
        toast.success('Variantes geradas!');
        setIsAiModalOpen(false);
        if (activeTab !== 'MESSAGES') setActiveTab('MESSAGES');
      }
    } catch {
      toast.error('Erro ao gerar com IA');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddVariation = () => {
    if (variations.length >= 4) {
      toast.error('Limite atingido', 'Máximo de 4 variações simultâneas.');
      return;
    }
    setVariations([
      ...variations, 
      { id: `temp_${Date.now()}`, name: `Variação ${String.fromCharCode(65 + variations.length)}`, weight: 0, content: '' }
    ]);
  };

  const toggleAiTool = (tool: string) => {
    if (aiTools.includes(tool)) {
      setAiTools(aiTools.filter(t => t !== tool));
    } else {
      setAiTools([...aiTools, tool]);
    }
  };

  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newText = baseMessage.substring(0, start) + variable + baseMessage.substring(end);
      setBaseMessage(newText);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + variable.length;
        textarea.focus();
      }, 0);
    } else {
      setBaseMessage(prev => prev + variable);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-[#64748B]">Carregando roteiro...</div>;
  }
  
  return (
    <div className="flex flex-col h-full bg-[#F8F9FB] -m-6 overflow-y-auto">
      {/* Header Container */}
      <div className="bg-white border-b border-[#E5E7EB] pt-4 px-6 flex flex-col gap-4">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/roteiros')} className="w-8 h-8 flex items-center justify-center shrink-0 rounded-lg hover:bg-[#F8F9FB] transition-colors text-[#64748B]">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <Bot className="w-5 h-5 text-[#1B3A6B]" />
            <h1 className="text-[16px] font-bold text-[#0F172A] flex items-center gap-2">
              Roteiro <span className="text-[#94A3B8]">·</span> {name}
            </h1>
            <span className="text-[11px] font-medium text-[#64748B] ml-2">v3 · ativo em 1 campanha · 180 usos</span>
          </div>

          <div className="flex items-center gap-3">
            <Badge className={`${status === 'ACTIVE' ? 'bg-[#ECFDF3] text-[#039855]' : 'bg-[#F1F3F6] text-[#475569]'} border-none font-bold text-[11px] px-2 shadow-sm`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
              {status === 'ACTIVE' ? 'Ativo' : 'Pausado'}
            </Badge>
            <button onClick={() => router.push('/roteiros')} className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#F8F9FB] hover:bg-[#EEF0F3] text-[#64748B] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs Row */}
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setActiveTab('FLUXO')}
            className={`pb-3 text-[13px] font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'FLUXO' ? 'border-[#1B3A6B] text-[#1B3A6B]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
          >
            <GitBranch className="w-4 h-4" /> Fluxo da conversa
          </button>
          <button 
            onClick={() => setActiveTab('MESSAGES')}
            className={`pb-3 text-[13px] font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'MESSAGES' ? 'border-[#1B3A6B] text-[#1B3A6B]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
          >
            <MessageSquare className="w-4 h-4" /> Mensagens & variações
          </button>
          <button 
            onClick={() => setActiveTab('PERFORMANCE')}
            className={`pb-3 text-[13px] font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'PERFORMANCE' ? 'border-[#1B3A6B] text-[#1B3A6B]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
          >
            <BarChart2 className="w-4 h-4" /> Performance
          </button>
          <button 
            onClick={() => setActiveTab('CONFIG')}
            className={`pb-3 text-[13px] font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'CONFIG' ? 'border-[#1B3A6B] text-[#1B3A6B]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
          >
            <Settings className="w-4 h-4" /> Configurações
          </button>
        </div>
      </div>

      <div className="flex-1 w-full p-6 mx-auto">
        {/* --- TABS CONTENT --- */}
        
        {activeTab === 'FLUXO' && (
          <div className="animate-fadeIn max-w-[1200px] mx-auto w-full">
            <ScriptFlowBuilder />
          </div>
        )}

        {activeTab === 'MESSAGES' && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 animate-fadeIn max-w-[1200px] mx-auto w-full">
            {/* Left Column - Variants Editor */}
            <div className="space-y-6">
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h3 className="text-[16px] font-bold text-[#0F172A] mb-1">Teste de Variações A/B</h3>
                <p className="text-[12px] text-[#64748B] mb-5">Adicione diferentes mensagens iniciais para a IA disparar e descobrir qual gera mais respostas.</p>
                
                {variations.length === 0 ? (
                  <div className="border border-dashed border-[#CBD5E1] rounded-2xl p-10 text-center">
                    <GitBranch className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
                    <p className="text-[13px] font-bold text-[#0F172A] mb-1">Nenhuma variação ativa</p>
                    <p className="text-[12px] text-[#64748B] max-w-sm mx-auto mb-4">A mensagem base padrão é usada sempre que não há variantes.</p>
                    <Button onClick={handleAddVariation} className="mx-auto bg-white hover:bg-[#F8F9FB] text-[#475569] border border-[#E5E7EB] font-semibold h-9 px-4 rounded-xl flex items-center gap-1.5 text-[12px] shadow-sm">
                      <Plus className="w-3.5 h-3.5" /> Adicionar Variação Manual
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {variations.map((v, i) => {
                      const colorClass = VARIATION_COLORS[i % VARIATION_COLORS.length];
                      return (
                        <div key={v.id} className="border border-[#E5E7EB] rounded-2xl overflow-hidden hover:border-[#CBD5E1] transition-colors relative group">
                          <div className={`absolute top-0 left-0 w-1.5 h-full ${colorClass}`} />
                          <div className="p-5 pl-7">
                            <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
                              <div className="flex items-center gap-3">
                                <Badge className={`${colorClass} text-white font-bold text-[10px] px-2 py-0.5 border-none shadow-sm`}>
                                  Variação {String.fromCharCode(65 + i)}
                                </Badge>
                                <input 
                                  value={v.name} 
                                  onChange={e => setVariations(variations.map(x => x.id === v.id ? { ...x, name: e.target.value } : x))}
                                  className="text-[14px] font-bold text-[#0F172A] bg-transparent outline-none border-none p-0 w-[180px] focus:ring-0"
                                />
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-semibold text-[#64748B] uppercase">Distribuição</span>
                                  <div className="flex items-center bg-[#F8F9FB] border border-[#E5E7EB] rounded-md overflow-hidden">
                                    <input 
                                      type="number" min="0" max="100" 
                                      value={v.weight}
                                      onChange={e => setVariations(variations.map(x => x.id === v.id ? { ...x, weight: parseInt(e.target.value) || 0 } : x))}
                                      className="w-12 h-7 bg-transparent text-center text-[12px] font-bold text-[#0F172A] outline-none border-none p-0 focus:ring-0"
                                    />
                                    <span className="bg-[#EEF0F3] text-[#64748B] text-[11px] font-bold px-2 h-7 flex items-center border-l border-[#E5E7EB]">%</span>
                                  </div>
                                </div>
                                <button onClick={() => setVariations(variations.filter(x => x.id !== v.id))} className="text-[#94A3B8] hover:text-[#D92D20] transition-colors p-1 opacity-0 group-hover:opacity-100">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <Textarea 
                              rows={3}
                              value={v.content}
                              onChange={e => setVariations(variations.map(x => x.id === v.id ? { ...x, content: e.target.value } : x))}
                              className="w-full bg-[#F8F9FB] border-[#EEF0F3] text-[13px] leading-relaxed text-[#334155] rounded-xl focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]/20"
                              placeholder="Digite a mensagem que a IA enviará..."
                            />
                          </div>
                        </div>
                      );
                    })}
                    
                    <div className="flex justify-between items-center mt-4 pt-4 border-t border-[#F1F3F6]">
                      <Button onClick={handleAddVariation} className="bg-white hover:bg-[#F8F9FB] text-[#475569] border border-[#E5E7EB] font-semibold h-9 px-4 rounded-xl flex items-center gap-1.5 text-[12px] shadow-sm">
                        <Plus className="w-3.5 h-3.5" /> Adicionar Manual
                      </Button>
                      
                      {variations.reduce((sum, v) => sum + v.weight, 0) !== 100 && (
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-[#D92D20] bg-[#FEF3F2] p-2 px-3 rounded-lg border border-[#FEE4E2]">
                          <ShieldAlert className="w-4 h-4" />
                          Total precisa ser 100% (Atual: {variations.reduce((sum, v) => sum + v.weight, 0)}%)
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h3 className="text-[16px] font-bold text-[#0F172A] mb-1">Mensagem Base (Fallback)</h3>
                <p className="text-[12px] text-[#64748B] mb-5">Usada como padrão caso as variações sejam pausadas.</p>
                <div className="relative">
                  <Textarea 
                    id="base-message-textarea"
                    ref={textareaRef}
                    value={baseMessage}
                    onChange={e => setBaseMessage(e.target.value)}
                    className="w-full min-h-[120px] bg-[#F8F9FB] border-[#EEF0F3] text-[13px] leading-relaxed text-[#334155] rounded-xl focus:border-[#1B3A6B] p-4 resize-none"
                    placeholder="Digite a mensagem..."
                  />
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    {['[Nome]', '[Empresa]', '[Cidade]'].map(variable => (
                      <button
                        key={variable}
                        onClick={() => insertVariable(variable)}
                        className="px-3 py-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F8F9FB] rounded-lg text-[12px] font-bold text-[#475569] shadow-sm flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> {variable}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar - Preview & Insights */}
            <div className="space-y-6">
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[13px] font-bold text-[#0F172A] mb-4">Prévia do Teste A/B</h4>
                {variations.length === 0 ? (
                  <div className="text-[12px] text-[#64748B] italic">Sem variações ativas.</div>
                ) : (
                  <div className="space-y-4">
                    {variations.map((v, i) => (
                      <div key={v.id} className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-semibold">
                          <span className="text-[#475569]">Variação {String.fromCharCode(65 + i)}</span>
                          <span className="text-[#0F172A]">{v.weight}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-[#EEF0F3] rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${VARIATION_COLORS[i % VARIATION_COLORS.length]}`} style={{ width: `${v.weight}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#1B3A6B] rounded-2xl p-6 shadow-md text-white">
                <h4 className="font-bold flex items-center gap-1.5 mb-3 text-[14px]">
                  <Sparkles className="w-4 h-4 text-yellow-400" /> Insights da IA
                </h4>
                <div className="space-y-3">
                  <div className="bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/5">
                    <p className="text-[12px] leading-relaxed text-white/90">
                      A <strong>Variação A</strong> tem uma estimativa de <strong>15% maior conversão</strong> por usar gatilhos de prova social na primeira linha.
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/5">
                    <p className="text-[12px] leading-relaxed text-white/90">
                      Sugerimos testar a <strong>Variação B</strong> para validar a recepção de um tom mais informal e direto.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-[#FEF9F0] border border-[#FDEBCE] rounded-2xl p-5 shadow-sm text-[12px] leading-relaxed text-[#935D0B]">
                <h4 className="font-bold flex items-center gap-1.5 mb-2"><Bot className="w-4 h-4" /> Como funciona o A/B</h4>
                <p>O robô irá alternar as mensagens de acordo com o peso de distribuição. Analise a aba de Performance para decidir a vencedora.</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'PERFORMANCE' && (
          <div className="animate-fadeIn max-w-[1200px] mx-auto w-full space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Envios · 30D</h4>
                <div className="text-3xl font-bold text-[#0F172A] mb-1">180</div>
                <div className="text-[12px] font-bold text-[#039855]">+24 esta semana</div>
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Taxa de Resposta</h4>
                <div className="text-3xl font-bold text-[#0F172A] mb-1">32 <span className="text-[18px]">%</span></div>
                <div className="text-[12px] font-bold text-[#039855]">+4pp vs benchmark</div>
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Reuniões Agendadas</h4>
                <div className="text-3xl font-bold text-[#0F172A] mb-1">16</div>
                <div className="text-[12px] font-bold text-[#039855]">9% conversão</div>
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Custo IA</h4>
                <div className="text-3xl font-bold text-[#0F172A] mb-1">R$ 142</div>
                <div className="text-[12px] font-bold text-[#039855]">R$ 8,87/reunião</div>
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <div className="mb-6 border-b border-[#F1F3F6] pb-4">
                <h3 className="text-[16px] font-bold text-[#0F172A]">A/B testing entre variações</h3>
                <p className="text-[12px] text-[#64748B] mt-1">Resposta nas últimas 60 conversas</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-[13px] font-bold text-[#0F172A]">
                    <span>Variação A · "Trabalho com proteção..."</span>
                    <span className="text-[#039855]">35% resposta</span>
                  </div>
                  <div className="w-full h-3 bg-[#EEF0F3] rounded-full overflow-hidden">
                    <div className="h-full bg-[#039855] rounded-full" style={{ width: '85%' }} />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[13px] font-bold text-[#0F172A]">
                    <span>Variação B · "Profissionais como você..."</span>
                    <span className="text-[#1B3A6B]">31% resposta</span>
                  </div>
                  <div className="w-full h-3 bg-[#EEF0F3] rounded-full overflow-hidden">
                    <div className="h-full bg-[#1B3A6B] rounded-full" style={{ width: '75%' }} />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[13px] font-bold text-[#0F172A]">
                    <span>Variação C · "Tenho uma apresentação..."</span>
                    <span className="text-[#E47320]">27% resposta</span>
                  </div>
                  <div className="w-full h-3 bg-[#EEF0F3] rounded-full overflow-hidden">
                    <div className="h-full bg-[#E47320] rounded-full" style={{ width: '65%' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'CONFIG' && (
          <div className="animate-fadeIn max-w-[800px] mx-auto w-full space-y-6">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-6">Configurações gerais</h3>
              
              <div className="space-y-6">
                <div className="grid grid-cols-[160px_1fr] items-center gap-4 border-b border-[#F1F3F6] pb-6">
                  <label className="text-[13px] font-bold text-[#475569]">Nome do roteiro</label>
                  <Input 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    className="max-w-[400px] h-10 border-[#E5E7EB] rounded-xl text-[13px]"
                  />
                </div>
                
                <div className="grid grid-cols-[160px_1fr] items-center gap-4 border-b border-[#F1F3F6] pb-6">
                  <label className="text-[13px] font-bold text-[#475569]">Categoria</label>
                  <div className="flex items-center gap-2">
                    {['Abordagem', 'Objeção', 'Educação', 'Fechamento'].map(cat => (
                      <button 
                        key={cat}
                        className={`px-4 py-1.5 rounded-full text-[12px] font-bold transition-all border ${category.includes(cat.substring(0, 3).toUpperCase()) || (category === 'APPROACH' && cat === 'Abordagem') ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]' : 'bg-[#F8F9FB] text-[#64748B] border-[#E5E7EB] hover:bg-[#EEF0F3]'}`}
                        onClick={() => setCategory(cat === 'Abordagem' ? 'APPROACH' : cat === 'Objeção' ? 'OBJECTION' : cat === 'Educação' ? 'EDUCATION' : 'CLOSING')}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-[160px_1fr] items-center gap-4 border-b border-[#F1F3F6] pb-6">
                  <div>
                    <label className="text-[13px] font-bold text-[#475569] block">Status do roteiro</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-1">Pause aqui se quiser parar de usar sem deletar</span>
                  </div>
                  <button onClick={() => setStatus(status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE')}>
                    {status === 'ACTIVE' ? (
                      <ToggleRight className="w-10 h-10 text-[#039855]" />
                    ) : (
                      <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-[160px_1fr] items-center gap-4">
                  <label className="text-[13px] font-bold text-[#475569]">Campanhas usando</label>
                  <span className="text-[13px] text-[#64748B]">1 ativa · "Médicos - SJRP"</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-6">Instruções da IA (Prompt Personalizado)</h3>
              <p className="text-[12px] text-[#64748B] mb-4">Define a personalidade, regras e limitações da inteligência artificial enquanto ela conversa dentro deste roteiro.</p>
              
              <Textarea 
                value={aiInstructions}
                onChange={e => setAiInstructions(e.target.value)}
                className="w-full min-h-[160px] bg-[#F8F9FB] border-[#EEF0F3] text-[13px] leading-relaxed text-[#334155] rounded-xl focus:border-[#1B3A6B] p-4 resize-none mb-4"
                placeholder="Ex: Aja como um corretor experiente. Nunca prometa valores exatos. Seja curto e evite jargões..."
              />
              
              <div className="flex gap-2">
                <Button className="bg-white hover:bg-[#F8F9FB] text-[#475569] border border-[#E5E7EB] font-semibold h-9 px-4 rounded-xl flex items-center gap-1.5 text-[12px] shadow-sm">
                  <Wand2 className="w-3.5 h-3.5" /> Otimizar Prompt com IA
                </Button>
                <Button className="bg-white hover:bg-[#F8F9FB] text-[#475569] border border-[#E5E7EB] font-semibold h-9 px-4 rounded-xl flex items-center gap-1.5 text-[12px] shadow-sm">
                  <Copy className="w-3.5 h-3.5" /> Usar Padrão do Tenant
                </Button>
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-6">Ferramentas que a IA pode usar neste roteiro</h3>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-[#F1F3F6] pb-5">
                  <div>
                    <label className="text-[13px] font-bold text-[#0F172A] block">Consultar agenda do Giovane</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-0.5">Pra oferecer horários reais</span>
                  </div>
                  <button onClick={() => toggleAiTool('calendar_read')}>
                    {aiTools.includes('calendar_read') || aiTools.includes('calendar') ? <ToggleRight className="w-10 h-10 text-[#1B3A6B]" /> : <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />}
                  </button>
                </div>
                
                <div className="flex items-center justify-between border-b border-[#F1F3F6] pb-5">
                  <div>
                    <label className="text-[13px] font-bold text-[#0F172A] block">Agendar reunião no Calendar</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-0.5">Quando o lead aceitar horário</span>
                  </div>
                  <button onClick={() => toggleAiTool('calendar_write')}>
                    {aiTools.includes('calendar_write') || aiTools.includes('calendar') ? <ToggleRight className="w-10 h-10 text-[#1B3A6B]" /> : <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />}
                  </button>
                </div>

                <div className="flex items-center justify-between border-b border-[#F1F3F6] pb-5">
                  <div>
                    <label className="text-[13px] font-bold text-[#0F172A] block">Enviar PDF institucional MetLife</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-0.5">Quando lead pedir mais informação</span>
                  </div>
                  <button onClick={() => toggleAiTool('pdf')}>
                    {aiTools.includes('pdf') ? <ToggleRight className="w-10 h-10 text-[#1B3A6B]" /> : <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[13px] font-bold text-[#0F172A] block">Encaminhar pra Giovane</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-0.5">Quando lead pedir ligação ou ficar bravo</span>
                  </div>
                  <button onClick={() => toggleAiTool('forward')}>
                    {aiTools.includes('forward') ? <ToggleRight className="w-10 h-10 text-[#1B3A6B]" /> : <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer sticky bar with Save button */}
      <div className="fixed bottom-0 right-0 left-64 bg-white border-t border-[#E5E7EB] p-4 flex items-center justify-end gap-3 z-50">
        <Button className="bg-white hover:bg-[#F8F9FB] text-[#0F172A] border border-[#E5E7EB] font-bold h-10 px-5 rounded-xl shadow-sm flex items-center gap-2">
          <Copy className="w-4 h-4" /> Duplicar
        </Button>
        <Button className="bg-white hover:bg-[#F8F9FB] text-[#0F172A] border border-[#E5E7EB] font-bold h-10 px-5 rounded-xl shadow-sm">
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={isSaving} className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-bold h-10 px-6 rounded-xl shadow-md transition-all flex items-center gap-2">
          {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar e treinar IA
        </Button>
      </div>

      {/* AI Generate Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl w-full max-w-[500px] p-6 shadow-2xl animate-scaleIn">
            <div className="flex justify-between items-center mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#ECFDF3] rounded-xl flex items-center justify-center">
                  <Wand2 className="w-5 h-5 text-[#039855]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0F172A]">Gerar Variações</h3>
                  <p className="text-[11px] text-[#64748B]">IA especializada em alta conversão</p>
                </div>
              </div>
              <button onClick={() => setIsAiModalOpen(false)} className="text-[#94A3B8] hover:text-[#0F172A]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleGenerateAI} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-[#475569] uppercase">Público-alvo</label>
                <select value={selectedNiche} onChange={e => setSelectedNiche(e.target.value)} className="w-full h-10 border border-[#E5E7EB] rounded-xl px-3 text-[13px] outline-none">
                  <option value="DOCTOR">Médicos</option>
                  <option value="LAWYER">Advogados</option>
                  <option value="BUSINESS_OWNER">Empresários</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] font-bold text-[#475569] uppercase">Produto Foco</label>
                <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} className="w-full h-10 border border-[#E5E7EB] rounded-xl px-3 text-[13px] outline-none">
                  <option value="DIT">Seguro DIT</option>
                  <option value="KEYMAN">Homem-Chave / Sucessão</option>
                </select>
              </div>
              <div className="pt-2">
                <Button type="submit" disabled={isGenerating} className="w-full bg-[#1B3A6B] hover:bg-[#142C52] text-white h-11 rounded-xl font-bold flex items-center justify-center gap-2">
                  {isGenerating ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  Gerar 3 Variações
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
