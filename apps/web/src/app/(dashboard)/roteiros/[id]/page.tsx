'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button, Input, Textarea, toast, Badge } from '@prospix/ui';
import { 
  Sparkles, MessageSquare, Plus, Save, Trash2, Wand2, X, 
  Bot, ShieldAlert, GitBranch, ArrowLeft, BarChart2, Settings,
  ToggleRight, ToggleLeft, Copy
} from 'lucide-react';
import { scriptsQueries, objectionsQueries, Objection, icpsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { ScriptFlowBuilder } from './ScriptFlowBuilder';

type ActiveTab = 'FLUXO' | 'MESSAGES' | 'PERFORMANCE' | 'CONFIG' | 'OBJECTIONS';

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
  const [flowData, setFlowData] = useState<{nodes: any[], edges: any[]} | null>(null);
  const [restrictions, setRestrictions] = useState('');
  const [contextDocuments, setContextDocuments] = useState<Array<{ title: string; url: string }>>([]);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocUrl, setNewDocUrl] = useState('');

  // Guardians State
  const [guardiansConfig, setGuardiansConfig] = useState<Record<string, boolean>>({
    objections_enabled: true,
    qualification_enabled: true,
    short_responses_enabled: true,
  });

  // Objections State
  const [objections, setObjections] = useState<Objection[]>([]);
  const [isObjectionsLoading, setIsObjectionsLoading] = useState(false);
  const [newObjTitle, setNewObjTitle] = useState('');
  const [newObjPattern, setNewObjPattern] = useState('');
  const [newObjResponse, setNewObjResponse] = useState('');
  const [isCreatingObjection, setIsCreatingObjection] = useState(false);
  const [editingObjectionId, setEditingObjectionId] = useState<string | null>(null);

  const [performanceStats, setPerformanceStats] = useState<any>(null);
  const [nodePerformanceStats, setNodePerformanceStats] = useState<any[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!tenantId || !scriptId) return;
    
    const fetchScript = async () => {
      try {
        // Trava: Verificar se possui ICPs cadastrados antes de tudo
        const { data: icpsData } = await icpsQueries.list(tenantId);
        if (!icpsData || icpsData.length === 0) {
          toast.error(
            'Criação de ICP Requerida',
            'Para configurar um Roteiro de IA, você precisa definir antes o seu Perfil de Cliente Ideal (ICP).'
          );
          router.push('/icps');
          return;
        }

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
            setFlowData((script.flow as any) || null);
            // in a real scenario ai_instructions would be fetched from DB
            setAiInstructions(script.ai_instructions || 'Você é um consultor MetLife focado em fechar reuniões de 10 min. Seja direto e não mande áudios.');
            setRestrictions(script.restrictions || '');
            setContextDocuments(Array.isArray(script.context_documents) ? (script.context_documents as any) : []);
            setGuardiansConfig(script.guardians_config ? (script.guardians_config as any) : {
              objections_enabled: true,
              qualification_enabled: true,
              short_responses_enabled: true,
            });

            const vars = script.variations || [];
            if (vars.length > 0) {
              setVariations(vars.map((v: any, i: number) => ({
                id: v.id || Date.now().toString() + i,
                name: v.name || `Variação ${String.fromCharCode(65 + i)}`,
                weight: v.weight ? Math.round(v.weight * 100) : 0,
                content: v.content || v.message || '',
              })));
            }
            
            // Fetch performance real
            const perfRes = await scriptsQueries.getPerformance(tenantId, script.id);
            if (!perfRes.error && perfRes.data) {
              setPerformanceStats(perfRes.data);
            }

            // Fetch node performance
            const nodePerfRes = await scriptsQueries.getNodePerformance(tenantId, script.id);
            if (!nodePerfRes.error && nodePerfRes.data) {
              setNodePerformanceStats(nodePerfRes.data);
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
          name, category, baseMessage, aiInstructions, restrictions, contextDocuments, guardiansConfig
        });
        if (data?.id) {
          await scriptsQueries.update(tenantId, data.id, { status, aiTools, variations: mappedVariations, restrictions, contextDocuments, guardiansConfig });
        }
        if (error) throw error;
        toast.success('Roteiro salvo com sucesso');
        router.replace(`/roteiros/${data?.id}`);
      } else {
        const { error } = await scriptsQueries.update(tenantId, scriptId, {
          name, category, baseMessage, variations: mappedVariations, status, aiTools, aiInstructions, restrictions, contextDocuments, guardiansConfig
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

  const handleSaveFlow = async (flow: any) => {
    if (!tenantId || scriptId === 'new') {
      toast.error('Erro', 'Salve o roteiro antes de configurar o fluxo visual.');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await scriptsQueries.update(tenantId, scriptId, { flow });
      if (error) throw error;
      setFlowData(flow);
      toast.success('Fluxo visual salvo com sucesso');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar fluxo', 'Ocorreu um erro ao gravar a estrutura visual.');
    } finally {
      setIsSaving(false);
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

  const handleAddDoc = () => {
    if (!newDocTitle.trim() || !newDocUrl.trim()) {
      toast.error('Preencha o título e o link do documento');
      return;
    }
    if (!newDocUrl.startsWith('http://') && !newDocUrl.startsWith('https://')) {
      toast.error('O link deve começar com http:// ou https://');
      return;
    }
    setContextDocuments(prev => [...prev, { title: newDocTitle.trim(), url: newDocUrl.trim() }]);
    setNewDocTitle('');
    setNewDocUrl('');
    toast.success('Material de apoio adicionado');
  };

  const handleRemoveDoc = (index: number) => {
    setContextDocuments(prev => prev.filter((_, i) => i !== index));
    toast.success('Material de apoio removido');
  };

  useEffect(() => {
    if (!tenantId || !scriptId || scriptId === 'new') return;

    const fetchObjections = async () => {
      setIsObjectionsLoading(true);
      try {
        const { data, error } = await objectionsQueries.list(tenantId, scriptId);
        if (!error && data) {
          setObjections(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsObjectionsLoading(false);
      }
    };

    fetchObjections();
  }, [tenantId, scriptId, activeTab]);

  const handleCreateObjection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !scriptId) return;
    if (!newObjTitle.trim() || !newObjPattern.trim() || !newObjResponse.trim()) {
      toast.error('Preencha todos os campos da objeção');
      return;
    }

    setIsCreatingObjection(true);
    try {
      if (editingObjectionId) {
        const { data, error } = await objectionsQueries.update(tenantId, editingObjectionId, {
          title: newObjTitle.trim(),
          pattern: newObjPattern.trim(),
          response: newObjResponse.trim(),
        });
        if (error) throw error;
        toast.success('Objeção atualizada com sucesso');
        setObjections(prev => prev.map(o => o.id === editingObjectionId ? data! : o));
        setEditingObjectionId(null);
      } else {
        const { data, error } = await objectionsQueries.create(tenantId, {
          scriptId: scriptId === 'new' ? null : scriptId,
          title: newObjTitle.trim(),
          pattern: newObjPattern.trim(),
          response: newObjResponse.trim(),
        });
        if (error) throw error;
        toast.success('Objeção cadastrada com sucesso');
        setObjections(prev => [data!, ...prev]);
      }
      setNewObjTitle('');
      setNewObjPattern('');
      setNewObjResponse('');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar objeção');
    } finally {
      setIsCreatingObjection(false);
    }
  };

  const handleDeleteObjection = async (id: string) => {
    if (!tenantId) return;
    try {
      const { error } = await objectionsQueries.delete(tenantId, id);
      if (error) throw error;
      toast.success('Objeção excluída');
      setObjections(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir objeção');
    }
  };

  const startEditObjection = (obj: Objection) => {
    setEditingObjectionId(obj.id);
    setNewObjTitle(obj.title);
    setNewObjPattern(obj.pattern);
    setNewObjResponse(obj.response);
  };

  const cancelEditObjection = () => {
    setEditingObjectionId(null);
    setNewObjTitle('');
    setNewObjPattern('');
    setNewObjResponse('');
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
          <button 
            onClick={() => setActiveTab('OBJECTIONS')}
            className={`pb-3 text-[13px] font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'OBJECTIONS' ? 'border-[#1B3A6B] text-[#1B3A6B]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
          >
            <ShieldAlert className="w-4 h-4" /> Objeções
          </button>
        </div>
      </div>

      <div className="flex-1 w-full p-6 mx-auto">
        {/* --- TABS CONTENT --- */}
        
        {activeTab === 'FLUXO' && (
          <div className="animate-fadeIn max-w-[1200px] mx-auto w-full">
            <ScriptFlowBuilder 
              initialNodesProp={flowData?.nodes} 
              initialEdgesProp={flowData?.edges}
              onSave={handleSaveFlow}
              isSaving={isSaving}
            />
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
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Envios (Total)</h4>
                <div className="text-3xl font-bold text-[#0F172A] mb-1">{performanceStats?.totalSent || 0}</div>
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Taxa de Resposta</h4>
                <div className="text-3xl font-bold text-[#0F172A] mb-1">{performanceStats?.overallResponseRate || 0} <span className="text-[18px]">%</span></div>
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Reuniões Agendadas</h4>
                <div className="text-3xl font-bold text-[#0F172A] mb-1">{performanceStats?.meetingsCount || 0}</div>
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Status AI</h4>
                <div className="text-lg font-bold text-[#039855] mb-1 flex items-center gap-2"><Bot className="w-5 h-5"/> Ativo</div>
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <div className="mb-6 border-b border-[#F1F3F6] pb-4">
                <h3 className="text-[16px] font-bold text-[#0F172A]">A/B testing entre variações</h3>
                <p className="text-[12px] text-[#64748B] mt-1">Resposta nas últimas 60 conversas</p>
              </div>

              <div className="space-y-6">
                {(performanceStats?.variations || []).length > 0 ? (
                  performanceStats.variations.map((v: any, idx: number) => (
                    <div key={v.id} className="space-y-2">
                      <div className="flex justify-between text-[13px] font-bold text-[#0F172A]">
                        <span className="truncate max-w-[80%]">Variação {v.variant_letter} · "{v.message?.substring(0, 40)}..."</span>
                        <span className={idx === 0 ? "text-[#039855]" : "text-[#1B3A6B]"}>{v.rate}% resposta</span>
                      </div>
                      <div className="w-full h-3 bg-[#EEF0F3] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${idx === 0 ? 'bg-[#039855]' : 'bg-[#1B3A6B]'}`} style={{ width: `${v.rate}%` }} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-gray-500 text-center py-4">Ainda não há dados de envio para este roteiro.</div>
                )}
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <div className="mb-6 border-b border-[#F1F3F6] pb-4">
                <h3 className="text-[16px] font-bold text-[#0F172A]">Performance por Etapa do Fluxo (Funil)</h3>
                <p className="text-[12px] text-[#64748B] mt-1">Métricas de transição e abandono de contatos em cada etapa do roteiro</p>
              </div>

              <div className="space-y-6">
                {nodePerformanceStats && nodePerformanceStats.length > 0 ? (
                  nodePerformanceStats.map((node: any) => (
                    <div key={node.nodeId} className="border border-[#F1F3F6] rounded-xl p-4 hover:border-[#E5E7EB] transition-all">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[13px] text-[#0F172A]">{node.nodeTitle}</span>
                          <span className="text-[10px] bg-[#F8F9FB] border border-[#E5E7EB] text-[#64748B] font-bold px-2 py-0.5 rounded-full">
                            {node.totalReached} contatos
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-[12px]">
                          <span className="text-[#039855] font-bold">{node.conversionRate}% avançaram</span>
                          <span className="text-[#D92D20] font-bold">{node.abandonmentRate}% pararam</span>
                        </div>
                      </div>
                      
                      <div className="w-full h-2.5 bg-[#EEF0F3] rounded-full overflow-hidden flex">
                        <div 
                          className="h-full bg-[#039855] transition-all" 
                          style={{ width: `${node.conversionRate}%` }} 
                        />
                        <div 
                          className="h-full bg-[#D92D20] transition-all" 
                          style={{ width: `${node.abandonmentRate}%` }} 
                        />
                      </div>

                      <div className="flex justify-between text-[11px] text-[#64748B] mt-2">
                        <span>Avançaram: {node.advanced}</span>
                        <span>Pararam aqui: {node.abandoned}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[#64748B] text-center py-6">
                    Ainda não há dados analíticos de fluxo para este roteiro.
                  </div>
                )}
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
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-6">Restrições da IA (Limitações de Comportamento)</h3>
              <p className="text-[12px] text-[#64748B] mb-4">Defina o que a IA está expressamente PROIBIDA de falar ou fazer (ex: não falar de preços, não citar concorrentes, não agendar fds).</p>
              
              <Textarea 
                value={restrictions}
                onChange={e => setRestrictions(e.target.value)}
                className="w-full min-h-[120px] bg-[#F8F9FB] border-[#EEF0F3] text-[13px] leading-relaxed text-[#334155] rounded-xl focus:border-[#1B3A6B] p-4 resize-none"
                placeholder="Ex: Nunca dê descontos maiores que 10%. Nunca mencione que somos parceiros de concorrentes. Não passe preços de planos corporativos por WhatsApp..."
              />
            </div>

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-6">Materiais de Apoio (Documentos e Links)</h3>
              <p className="text-[12px] text-[#64748B] mb-4">Adicione links de materiais, tabelas ou sites oficiais para a IA consultar quando o lead fizer perguntas técnicas.</p>
              
              {contextDocuments.length > 0 ? (
                <div className="space-y-2 mb-6">
                  {contextDocuments.map((doc, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-[#F8F9FB] border border-[#EEF0F3] rounded-xl">
                      <div className="flex flex-col min-w-0 flex-1 mr-4">
                        <span className="text-[13px] font-bold text-[#0F172A] truncate">{doc.title}</span>
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#1B3A6B] underline truncate hover:text-[#142C52]">
                          {doc.url}
                        </a>
                      </div>
                      <button 
                        onClick={() => handleRemoveDoc(idx)}
                        className="text-[#94A3B8] hover:text-[#D92D20] p-1.5 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 border border-dashed border-[#E5E7EB] rounded-xl mb-6 bg-[#F8F9FB]/50">
                  <span className="text-[12px] text-[#94A3B8]">Nenhum material de apoio adicionado.</span>
                </div>
              )}

              <div className="space-y-3 p-4 bg-[#F8F9FB] rounded-xl border border-[#EEF0F3]">
                <span className="text-[12px] font-bold text-[#475569]">Adicionar novo material</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input 
                    placeholder="Título (ex: Tabela de Preços DIT)"
                    value={newDocTitle}
                    onChange={e => setNewDocTitle(e.target.value)}
                    className="h-9 text-[12px] border-[#E5E7EB] rounded-lg bg-white"
                  />
                  <Input 
                    placeholder="URL (ex: https://site.com/tabela.pdf)"
                    value={newDocUrl}
                    onChange={e => setNewDocUrl(e.target.value)}
                    className="h-9 text-[12px] border-[#E5E7EB] rounded-lg bg-white"
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <Button 
                    onClick={handleAddDoc}
                    className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-bold h-8 px-4 rounded-lg text-[12px] flex items-center gap-1 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar
                  </Button>
                </div>
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

            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-6">Guardiões da IA (Filtros de Comportamento)</h3>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-[#F1F3F6] pb-5">
                  <div>
                    <label className="text-[13px] font-bold text-[#0F172A] block">Guardião de Objeções (Framework Jeb Blount L-D-A)</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-0.5">Detecta quando o lead faz uma objeção e força a IA a contorná-la estruturadamente</span>
                  </div>
                  <button onClick={() => setGuardiansConfig(prev => ({ ...prev, objections_enabled: !prev.objections_enabled }))}>
                    {guardiansConfig.objections_enabled ? <ToggleRight className="w-10 h-10 text-[#1B3A6B]" /> : <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />}
                  </button>
                </div>
                
                <div className="flex items-center justify-between border-b border-[#F1F3F6] pb-5">
                  <div>
                    <label className="text-[13px] font-bold text-[#0F172A] block">Guardião de Qualificação & Tom de Voz (SPIN / BANT)</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-0.5">Conduz o lead sutilmente por perguntas de diagnóstico e dor sem parecer um interrogatório</span>
                  </div>
                  <button onClick={() => setGuardiansConfig(prev => ({ ...prev, qualification_enabled: !prev.qualification_enabled }))}>
                    {guardiansConfig.qualification_enabled ? <ToggleRight className="w-10 h-10 text-[#1B3A6B]" /> : <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-[13px] font-bold text-[#0F172A] block">Guardião de Respostas Curtas (Aaron Ross - Spear-phishing)</label>
                    <span className="text-[11px] text-[#94A3B8] block mt-0.5">Garante mensagens concisas de no máximo 2 parágrafos curtos para parecer humano</span>
                  </div>
                  <button onClick={() => setGuardiansConfig(prev => ({ ...prev, short_responses_enabled: !prev.short_responses_enabled }))}>
                    {guardiansConfig.short_responses_enabled ? <ToggleRight className="w-10 h-10 text-[#1B3A6B]" /> : <ToggleLeft className="w-10 h-10 text-[#CBD5E1]" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'OBJECTIONS' && (
          <div className="animate-fadeIn max-w-[1200px] mx-auto w-full grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
            {/* Lista de Objeções */}
            <div className="space-y-4">
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm">
                <h3 className="text-[16px] font-bold text-[#0F172A] mb-2">Base de Objeções do Roteiro</h3>
                <p className="text-[12px] text-[#64748B] mb-6">
                  Cadastre as principais barreiras ou dúvidas dos leads (ex: "está muito caro", "não tenho tempo") e a resposta recomendada de contorno para a IA utilizar de forma contextual.
                </p>

                {isObjectionsLoading ? (
                  <div className="text-center py-12 text-[#64748B] text-[13px]">Carregando base de objeções...</div>
                ) : objections.length > 0 ? (
                  <div className="space-y-4">
                    {objections.map(obj => (
                      <div key={obj.id} className="border border-[#E5E7EB] rounded-xl p-5 hover:border-[#1B3A6B] transition-all bg-[#F8F9FB]/50">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div>
                            <span className="text-[13px] font-bold text-[#0F172A]">{obj.title}</span>
                            {obj.script_id ? (
                              <Badge className="bg-[#E0F2FE] text-[#0369A1] text-[10px] font-bold border-none px-2 py-0.5 ml-2">Específica</Badge>
                            ) : (
                              <Badge className="bg-[#F3F4F6] text-[#4B5563] text-[10px] font-bold border-none px-2 py-0.5 ml-2">Global</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => startEditObjection(obj)}
                              className="text-[#1B3A6B] hover:text-[#142C52] text-[12px] font-bold px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                            >
                              Editar
                            </button>
                            <button 
                              onClick={() => handleDeleteObjection(obj.id)}
                              className="text-[#94A3B8] hover:text-[#D92D20] p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="grid grid-cols-[80px_1fr] text-[12px]">
                            <span className="font-bold text-[#64748B]">Se o lead disser:</span>
                            <span className="text-[#334155] bg-white px-2 py-1 rounded border border-[#E5E7EB] italic font-medium">"{obj.pattern}"</span>
                          </div>
                          <div className="grid grid-cols-[80px_1fr] text-[12px]">
                            <span className="font-bold text-[#64748B]">IA responde:</span>
                            <span className="text-[#0F172A] bg-[#ECFDF3]/40 border border-[#D1FADF] px-3 py-1.5 rounded font-medium leading-relaxed">
                              {obj.response}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 border border-dashed border-[#E5E7EB] rounded-xl bg-[#F8F9FB]/50">
                    <ShieldAlert className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
                    <span className="text-[13px] text-[#94A3B8] block font-medium">Nenhuma objeção cadastrada para este roteiro.</span>
                    <span className="text-[11px] text-[#CBD5E1] block mt-1">Use o formulário ao lado para cadastrar a primeira.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Formulário de Cadastro / Edição */}
            <div className="space-y-4">
              <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm sticky top-6">
                <h3 className="text-[15px] font-bold text-[#0F172A] mb-1">
                  {editingObjectionId ? 'Editar Objeção' : 'Nova Objeção'}
                </h3>
                <p className="text-[11px] text-[#64748B] mb-5">
                  {editingObjectionId ? 'Modifique os detalhes do contorno de objeção.' : 'Cadastre uma nova regra de contorno para este roteiro.'}
                </p>

                <form onSubmit={handleCreateObjection} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-[#475569] uppercase">Título amigável</label>
                    <Input 
                      placeholder="Ex: Objeção de Preço / Muito Caro"
                      value={newObjTitle}
                      onChange={e => setNewObjTitle(e.target.value)}
                      className="h-10 text-[13px] border-[#E5E7EB] rounded-xl bg-[#F8F9FB] focus:bg-white transition-colors"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-[#475569] uppercase">Padrão da objeção (O que o lead fala)</label>
                    <Input 
                      placeholder="Ex: está muito caro, não tenho dinheiro agora"
                      value={newObjPattern}
                      onChange={e => setNewObjPattern(e.target.value)}
                      className="h-10 text-[13px] border-[#E5E7EB] rounded-xl bg-[#F8F9FB] focus:bg-white transition-colors"
                      required
                    />
                    <span className="text-[10px] text-[#94A3B8] block">Palavras ou termos comuns que identificam a objeção.</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[12px] font-bold text-[#475569] uppercase">Resposta / Contorno recomendado</label>
                    <Textarea 
                      placeholder="Ex: Entendo perfeitamente, o valor do investimento é proporcional ao retorno. Podemos fazer uma simulação de 5 minutos..."
                      value={newObjResponse}
                      onChange={e => setNewObjResponse(e.target.value)}
                      className="min-h-[140px] text-[13px] leading-relaxed border-[#E5E7EB] rounded-xl bg-[#F8F9FB] focus:bg-white p-3 resize-none transition-colors"
                      required
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    {editingObjectionId && (
                      <Button 
                        type="button" 
                        onClick={cancelEditObjection}
                        className="flex-1 bg-white hover:bg-[#F8F9FB] text-[#0F172A] border border-[#E5E7EB] font-bold h-10 rounded-xl text-[13px] shadow-sm"
                      >
                        Cancelar
                      </Button>
                    )}
                    <Button 
                      type="submit" 
                      disabled={isCreatingObjection}
                      className="flex-1 bg-[#1B3A6B] hover:bg-[#142C52] text-white font-bold h-10 rounded-xl text-[13px] shadow-md transition-all flex items-center justify-center gap-2"
                    >
                      {isCreatingObjection ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : editingObjectionId ? (
                        'Salvar'
                      ) : (
                        'Cadastrar'
                      )}
                    </Button>
                  </div>
                </form>
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
        <Button 
          onClick={() => router.push('/roteiros')} 
          className="bg-white hover:bg-[#F8F9FB] text-[#0F172A] border border-[#E5E7EB] font-bold h-10 px-5 rounded-xl shadow-sm"
        >
          Cancelar
        </Button>
        <Button 
          onClick={handleSave} 
          disabled={isSaving} 
          className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-bold h-10 px-6 rounded-xl shadow-md transition-all flex items-center gap-2"
        >
          {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar e treinar IA
        </Button>
      </div>
    </div>
  );
}
