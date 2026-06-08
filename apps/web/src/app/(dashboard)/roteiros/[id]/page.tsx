'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button, Input, Textarea, toast, Badge } from '@prospix/ui';
import { 
  Sparkles, MessageSquare, Plus, Save, Trash2, Wand2, X, 
  ChevronDown, CheckCircle2, Bot, Send, ShieldAlert, GitBranch
} from 'lucide-react';
import { scriptsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { apiFetch } from '@/lib/api-fetch';

type ActiveTab = 'ACTIVE' | 'VARIANTS' | 'SIMULATION';

interface ScriptVariation {
  id: string;
  name: string;
  weight: number;
  content: string;
}

const VARIATION_COLORS = ['bg-[#1B3A6B]', 'bg-[#5A2A82]', 'bg-[#B8740E]', 'bg-[#039855]'];

export default function ScriptDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const scriptId = params.id as string;
  const tenantId = useAuthStore(state => state.tenantId);
  
  const [activeTab, setActiveTab] = useState<ActiveTab>('ACTIVE');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Script State
  const [allScripts, setAllScripts] = useState<any[]>([]);
  const [name, setName] = useState('Novo Roteiro');
  const [category, setCategory] = useState('APPROACH');
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [baseMessage, setBaseMessage] = useState('');
  const [variations, setVariations] = useState<ScriptVariation[]>([]);
  const [aiTools, setAiTools] = useState<string[]>([]);

  // AI Gen State
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState('DOCTOR');
  const [selectedProduct, setSelectedProduct] = useState('DIT');
  
  // Simulation State
  const [simMessages, setSimMessages] = useState<{role: 'user'|'bot', text: string}[]>([
    { role: 'bot', text: 'Olá! Sou o assistente. Teste o roteiro enviando uma mensagem aqui.' }
  ]);
  const [simInput, setSimInput] = useState('');

  // Dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!tenantId || !scriptId) return;
    
    const fetchScript = async () => {
      try {
        const { data, error } = await scriptsQueries.list(tenantId);
        if (!error && data) {
          setAllScripts(data);
          
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
            setAiTools(script.ai_tools || []);

            const vars = script.variations || [];
            if (vars.length > 0) {
              setVariations(vars.map((v: any, i: number) => ({
                id: v.id || Date.now().toString() + i,
                name: v.name || `Variação ${String.fromCharCode(65 + i)}`,
                weight: v.weight || 0,
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
    
    // Validation
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

  const handleDelete = async () => {
    if (!tenantId || scriptId === 'new') return;
    if (confirm('Tem certeza que deseja deletar este roteiro? Ele será removido de todas as campanhas.')) {
      try {
        const { error } = await scriptsQueries.delete(tenantId, scriptId);
        if (error) throw error;
        toast.success('Roteiro deletado.');
        router.push('/roteiros');
      } catch {
        toast.error('Erro ao deletar roteiro.');
      }
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
        if (activeTab !== 'VARIANTS') setActiveTab('VARIANTS');
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

  const getPreviewText = () => {
    let text = baseMessage;
    if (!text) return 'Escreva uma mensagem base para ver a prévia aqui...';
    text = text.replace(/\[Nome\]/g, 'Dr. Ricardo');
    text = text.replace(/\[Empresa\]/g, 'Clínica OrthoLife');
    text = text.replace(/\[Cidade\]/g, 'Campinas');
    return text;
  };

  const handleSendSim = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simInput.trim()) return;
    setSimMessages(prev => [...prev, { role: 'user', text: simInput }]);
    const input = simInput;
    setSimInput('');
    
    // Mock response
    setTimeout(() => {
      setSimMessages(prev => [...prev, { 
        role: 'bot', 
        text: `(Simulação IA) Baseado no roteiro "${name}": Entendi sua resposta "${input}". Gostaria de saber mais?` 
      }]);
    }, 1000);
  };

  if (isLoading) {
    return <div className="p-8 text-center text-[#64748B]">Carregando roteiro...</div>;
  }
  
  return (
    <div className="flex flex-col h-full bg-[#F8F9FB] -m-6 p-6 overflow-y-auto">
      <div className="max-w-[1100px] mx-auto w-full">
        
        {/* Banner Header */}
        <div className="bg-[#F0F4F8] border border-[#D5E1F2] rounded-xl p-4 mb-6 flex items-start gap-3 shadow-sm">
          <MessageSquare className="w-5 h-5 text-[#1B3A6B] mt-0.5 shrink-0" />
          <div>
            <h3 className="text-[14px] font-bold text-[#0F172A] mb-1">Roteiros definem a personalidade da IA.</h3>
            <p className="text-[13px] text-[#475569]">
              Crie variantes para testar qual abordagem converte mais. A IA faz testes A/B automaticamente e mostra resultados em Performance.
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#E5E7EB] shadow-sm">
            <button 
              onClick={() => setActiveTab('ACTIVE')}
              className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all ${activeTab === 'ACTIVE' ? 'bg-[#1B3A6B] text-white shadow' : 'text-[#64748B] hover:bg-[#F8F9FB]'}`}
            >
              Roteiro ativo
            </button>
            <button 
              onClick={() => setActiveTab('VARIANTS')}
              className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all ${activeTab === 'VARIANTS' ? 'bg-[#1B3A6B] text-white shadow' : 'text-[#64748B] hover:bg-[#F8F9FB]'}`}
            >
              Variantes
            </button>
            <button 
              onClick={() => setActiveTab('SIMULATION')}
              className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all ${activeTab === 'SIMULATION' ? 'bg-[#1B3A6B] text-white shadow' : 'text-[#64748B] hover:bg-[#F8F9FB]'}`}
            >
              Simulação
            </button>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="h-10 px-4 bg-white border border-[#E5E7EB] rounded-xl flex items-center gap-2 text-[13px] font-bold text-[#0F172A] hover:bg-[#F8F9FB] shadow-sm max-w-[250px]"
              >
                <span className="truncate">{name}</span>
                <ChevronDown className="w-4 h-4 text-[#64748B] shrink-0" />
              </button>
              
              {isDropdownOpen && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-[#E5E7EB] rounded-xl shadow-lg z-20 py-2">
                  <div className="px-3 pb-2 mb-2 border-b border-[#F1F3F6] text-[11px] font-bold text-[#94A3B8] uppercase">Seus Roteiros</div>
                  {allScripts.map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setIsDropdownOpen(false); router.push(`/roteiros/${s.id}`); }}
                      className={`w-full text-left px-4 py-2 text-[13px] font-medium hover:bg-[#F8F9FB] flex items-center gap-2 ${s.id === scriptId ? 'text-[#1B3A6B] bg-[#F0F4F8]' : 'text-[#475569]'}`}
                    >
                      {s.id === scriptId && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                      <span className="truncate">{s.name}</span>
                    </button>
                  ))}
                  <div className="border-t border-[#F1F3F6] mt-2 pt-2">
                    <button
                      onClick={() => { setIsDropdownOpen(false); router.push('/roteiros/new'); }}
                      className="w-full text-left px-4 py-2 text-[13px] font-bold text-[#1B3A6B] hover:bg-[#F8F9FB] flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Novo Roteiro
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button 
              onClick={handleDelete}
              className="w-10 h-10 bg-white border border-[#E5E7EB] rounded-xl flex items-center justify-center hover:bg-[#FEF3F2] hover:text-[#D92D20] hover:border-[#FEE4E2] transition-colors text-[#94A3B8] shadow-sm"
              title="Deletar Roteiro"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <Button onClick={() => setIsAiModalOpen(true)} className="bg-white hover:bg-[#F8F9FB] text-[#0F172A] border border-[#E5E7EB] font-bold h-10 px-4 rounded-xl shadow-sm flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[#1B3A6B]" /> Gerar com IA
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-bold h-10 px-5 rounded-xl shadow-md transition-all flex items-center gap-2">
              {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </Button>
          </div>
        </div>

        {/* Content Area */}
        {activeTab === 'ACTIVE' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 animate-fadeIn">
            {/* Left Column */}
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm flex flex-col h-full">
              <h2 className="text-[16px] font-bold text-[#0F172A] mb-1">Mensagem base da IA</h2>
              <p className="text-[13px] text-[#64748B] mb-5">Essa é a mensagem principal que a IA usa como base para abordar cada lead</p>
              
              <div className="relative flex-1 flex flex-col">
                <Textarea 
                  id="base-message-textarea"
                  ref={textareaRef}
                  value={baseMessage}
                  onChange={e => setBaseMessage(e.target.value)}
                  className="flex-1 min-h-[240px] bg-[#F8F9FB] border-[#EEF0F3] text-[14px] leading-relaxed text-[#334155] rounded-xl focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]/20 p-4 resize-none"
                  placeholder="Digite a mensagem..."
                />
                
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-[#F1F3F6]">
                  {['[Nome]', '[Empresa]', '[Cidade]'].map(variable => (
                    <button
                      key={variable}
                      onClick={() => insertVariable(variable)}
                      className="px-3 py-1.5 bg-white border border-[#E5E7EB] hover:border-[#CBD5E1] hover:bg-[#F8F9FB] rounded-lg text-[12px] font-bold text-[#475569] transition-all shadow-sm flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3 text-[#94A3B8]" />
                      {variable}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-6 flex flex-col h-full">
              {/* Preview Box */}
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h2 className="text-[14px] font-bold text-[#0F172A] mb-1 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#B8740E]" /> Prévia da mensagem
                </h2>
                <p className="text-[12px] text-[#64748B] mb-4">Veja como a mensagem chegará para o lead</p>
                
                <div className="bg-[#F8F9FB] border border-[#EEF0F3] rounded-xl p-4 relative">
                  <div className="absolute -left-2 top-4 w-4 h-4 bg-[#F8F9FB] border-l border-b border-[#EEF0F3] transform rotate-45" />
                  <p className="text-[13px] text-[#334155] leading-relaxed whitespace-pre-wrap relative z-10">
                    {getPreviewText()}
                  </p>
                </div>
              </div>

              {/* Resumo */}
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm flex-1">
                <h2 className="text-[14px] font-bold text-[#0F172A] mb-6">Resumo do roteiro</h2>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-4 border-b border-[#F1F3F6]">
                    <span className="text-[13px] text-[#64748B] font-medium">Mensagem base</span>
                    <span className="text-[13px] font-bold text-[#0F172A]">{baseMessage.length} caracteres</span>
                  </div>
                  <div className="flex items-center justify-between pb-4 border-b border-[#F1F3F6]">
                    <span className="text-[13px] text-[#64748B] font-medium">Variantes ativas</span>
                    <span className="text-[13px] font-bold text-[#0F172A]">{variations.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#64748B] font-medium">Status</span>
                    <Badge className={`${status === 'ACTIVE' ? 'bg-[#ECFDF3] text-[#039855]' : 'bg-[#F1F3F6] text-[#475569]'} border-none font-bold shadow-sm`}>
                      {status === 'ACTIVE' ? 'Ativo' : 'Rascunho'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'VARIANTS' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 animate-fadeIn">
            <div className="space-y-5">
              <div className="flex items-center justify-between bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <div>
                  <h3 className="text-[16px] font-bold text-[#0F172A]">Teste de Variações A/B</h3>
                  <p className="text-[12px] text-[#64748B] mt-1">Crie múltiplas abordagens para a IA descobrir qual tem maior conversão.</p>
                </div>
                <Button onClick={handleAddVariation} className="bg-white hover:bg-[#F8F9FB] text-[#475569] border border-[#E5E7EB] font-semibold h-9 px-4 rounded-xl flex items-center gap-1.5 text-[12px] shadow-sm">
                  <Plus className="w-3.5 h-3.5" /> Adicionar Manual
                </Button>
              </div>

              {variations.length === 0 ? (
                <div className="bg-white border border-dashed border-[#CBD5E1] rounded-2xl p-10 text-center">
                  <GitBranch className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
                  <p className="text-[13px] font-bold text-[#0F172A] mb-1">Nenhuma variação ativa</p>
                  <p className="text-[12px] text-[#64748B] max-w-sm mx-auto">Adicione variações manualmente ou deixe nossa IA gerar opções focadas em conversão.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {variations.map((v, i) => {
                    const colorClass = VARIATION_COLORS[i % VARIATION_COLORS.length];
                    return (
                      <div key={v.id} className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm hover:border-[#CBD5E1] transition-colors relative group">
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
                            rows={4}
                            value={v.content}
                            onChange={e => setVariations(variations.map(x => x.id === v.id ? { ...x, content: e.target.value } : x))}
                            className="w-full bg-[#F8F9FB] border-[#EEF0F3] text-[13px] leading-relaxed text-[#334155] rounded-xl focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]/20"
                            placeholder="Digite a mensagem que a IA enviará..."
                          />
                        </div>
                      </div>
                    );
                  })}
                  
                  {variations.reduce((sum, v) => sum + v.weight, 0) !== 100 && (
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[#D92D20] bg-[#FEF3F2] p-3 rounded-xl border border-[#FEE4E2]">
                      <ShieldAlert className="w-4 h-4" />
                      A soma das distribuições precisa ser 100% (Atual: {variations.reduce((sum, v) => sum + v.weight, 0)}%)
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Sidebar - Preview & Insights */}
            <div className="space-y-6">
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[13px] font-bold text-[#0F172A] mb-4">Prévia do Funil</h4>
                {variations.length === 0 ? (
                  <div className="text-[12px] text-[#64748B] italic">Sem variações para distribuir.</div>
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

              <div className="bg-[#FEF9F0] border border-[#FDEBCE] rounded-2xl p-6 shadow-sm text-[12px] leading-relaxed text-[#935D0B]">
                <h4 className="font-bold flex items-center gap-1.5 mb-2"><Sparkles className="w-4 h-4" /> Como funciona o A/B</h4>
                <p>O robô irá alternar as mensagens selecionadas acima de acordo com o peso de distribuição definido. Analise a aba Performance para decidir a vencedora após ~100 envios.</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'SIMULATION' && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm h-[500px] flex flex-col animate-fadeIn overflow-hidden">
            {/* Header */}
            <div className="h-16 border-b border-[#E5E7EB] px-6 flex items-center justify-between bg-[#F8F9FB]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#1B3A6B] rounded-full flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0F172A] text-[14px]">Assistente Virtual</h3>
                  <p className="text-[11px] text-[#039855] font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#039855]" /> Online
                  </p>
                </div>
              </div>
              <Badge className="bg-white text-[#64748B] border-[#E5E7EB] text-[10px] uppercase font-bold">Modo Simulação</Badge>
            </div>
            
            {/* Chat Area */}
            <div className="flex-1 p-6 overflow-y-auto bg-[#F0F4F8] space-y-4">
              {simMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-2xl p-3.5 text-[13px] leading-relaxed shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-[#1B3A6B] text-white rounded-tr-sm' 
                      : 'bg-white border border-[#E5E7EB] text-[#334155] rounded-tl-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Input Area */}
            <form onSubmit={handleSendSim} className="p-4 border-t border-[#E5E7EB] bg-white flex gap-3">
              <Input 
                value={simInput}
                onChange={e => setSimInput(e.target.value)}
                placeholder="Responda como se fosse o lead..."
                className="flex-1 h-11 bg-[#F8F9FB] border-[#E5E7EB] focus:border-[#1B3A6B]"
              />
              <Button type="submit" className="h-11 px-5 bg-[#1B3A6B] hover:bg-[#142C52] text-white rounded-xl shadow-md">
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        )}
      </div>

      {/* AI Generate Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
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
