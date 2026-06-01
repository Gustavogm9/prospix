'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Textarea, toast, Badge } from '@prospix/ui';
import { Play, Sparkles, MessageSquare, Plus, Save, Trash2, Wand2, X } from 'lucide-react';
import { scriptsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { apiFetch } from '@/lib/api-fetch';


interface ScriptVariation {
  id: string;
  name: string;
  weight: number; // percentage
  content: string;
}

const VARIATION_BADGE_COLORS = ['bg-[#1B3A6B]', 'bg-[#5A2A82]', 'bg-[#B8740E]'];

const normalizeVariationWeight = (weight: unknown) => {
  const numericWeight = Number(weight);
  if (!Number.isFinite(numericWeight)) return 0;
  return numericWeight <= 1 ? Math.round(numericWeight * 100) : Math.round(numericWeight);
};

const mapScriptVariations = (script: any): ScriptVariation[] => {
  const flowVariations = Array.isArray(script?.flow?.variations) ? script.flow.variations : [];
  if (flowVariations.length > 0) {
    return flowVariations.map((variation: any, index: number) => ({
      id: variation.id || `${script.id}-flow-variation-${index}`,
      name: variation.name || `Variante ${String.fromCharCode(65 + index)}`,
      weight: normalizeVariationWeight(variation.weight),
      content: variation.content || variation.message || '',
    }));
  }

  const storedVariations = Array.isArray(script?.variations) && script.variations.length > 0
    ? script.variations.map((variation: any, index: number) => ({
        id: variation.id || `${script.id}-variation-${index}`,
        name: variation.name || `Variante ${variation.variantLetter || String.fromCharCode(65 + index)}`,
        weight: normalizeVariationWeight(variation.weight),
        content: variation.message || variation.content || '',
      }))
    : [];

  return storedVariations;
};

export default function Scripts() {
  const tenantId = useAuthStore(state => state.tenantId);
  const [activeSection, setActiveSection] = useState<'roteiro' | 'variantes' | 'simulacao'>('roteiro');
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);
  const [allScripts, setAllScripts] = useState<Array<{ id: string; name?: string; status?: string }>>([]); 
  const [baseMessage, setBaseMessage] = useState('');
  const [variations, setVariations] = useState<ScriptVariation[]>([]);
  const [isLoadingScripts, setIsLoadingScripts] = useState(true);
  const [simulationInput, setSimulationInput] = useState('');
  const [simulationResponse, setSimulationResponse] = useState<string | null>(null);
  const [simulatedVariant, setSimulatedVariant] = useState<string | null>(null);
  const [isLoadingSim, setIsLoadingSim] = useState(false);

  // AI Script Generator State
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState<'DOCTOR' | 'LAWYER' | 'BUSINESS_OWNER' | 'OTHER'>('DOCTOR');
  const [customNiche, setCustomNiche] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<'DIT' | 'KEYMAN' | 'PATRIMONY_SUCCESSION' | 'HEALTH_INSURANCE' | 'OTHER'>('DIT');
  const [customProduct, setCustomProduct] = useState('');
  const [selectedTone, setSelectedTone] = useState<'CONSULTATIVE' | 'FORMAL' | 'DIRECT'>('CONSULTATIVE');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);

    try {
      const res = await apiFetch('/api/scripts/generate', {
        method: 'POST',
        body: JSON.stringify({
          niche: selectedNiche,
          customNiche: selectedNiche === 'OTHER' ? customNiche : null,
          product: selectedProduct,
          customProduct: selectedProduct === 'OTHER' ? customProduct : null,
          tone: selectedTone,
        }),
      });
      const json = await res.json();

      const data = json?.data;
      if (data) {
        setBaseMessage(data.baseMessage);
        
        // Map variant weights dynamically
        const mappedVariations = (data.variations || []).map((v: any, index: number) => ({
          id: v.id || Date.now().toString() + index,
          name: v.name || `Variante ${String.fromCharCode(65 + index)}`,
          weight: v.weight || 50,
          content: v.content || '',
        }));

        setVariations(mappedVariations);
        toast.success('Roteiro Gerado com IA', 'As abordagens e variantes foram preenchidas no editor. Clique em "Salvar Roteiro" para confirmar.');
        setIsGenerateModalOpen(false);
      }
    } catch (err: unknown) {
      console.error('Error generating script with AI', err);
      toast.error('Erro de Geração', 'Não foi possível gerar mensagens com a IA.');
    } finally {
      setIsGenerating(false);
    }
  };


  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    const fetchScripts = async () => {
      try {
        const result = await scriptsQueries.list(tenantId);
        if (controller.signal.aborted) return;
        if (result.error) throw new Error(result.error.message);
        const list = result.data || [];
        setAllScripts(list);
        const activeScript = list.find((script: any) => script.status === 'ACTIVE') || list[0];

        if (activeScript) {
          setCurrentScriptId(activeScript.id);
          setBaseMessage((activeScript as any).base_message || (activeScript as any).baseMessage || '');
          setVariations(mapScriptVariations(activeScript));
        } else {
          setCurrentScriptId(null);
          setBaseMessage('');
          setVariations([]);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Error fetching scripts', err);
        setCurrentScriptId(null);
        setBaseMessage('');
        setVariations([]);
        toast.error('Erro de Conexão', 'Não foi possível carregar os roteiros.');
      } finally {
        if (!controller.signal.aborted) setIsLoadingScripts(false);
      }
    };

    fetchScripts();
    return () => controller.abort();
  }, [tenantId]);

  const handleSwitchScript = (scriptId: string) => {
    const script = allScripts.find((s: any) => s.id === scriptId) as any;
    if (script) {
      setCurrentScriptId(script.id);
      setBaseMessage(script.base_message || script.baseMessage || '');
      setVariations(mapScriptVariations(script));
    }
  };

  const handleDeleteScript = async () => {
    if (!currentScriptId || !tenantId) return;
    if (!window.confirm('Tem certeza que deseja excluir este roteiro? Esta ação não pode ser desfeita.')) return;
    try {
      const result = await scriptsQueries.delete(tenantId, currentScriptId);
      if (result.error) throw new Error(result.error.message);
      toast.success('Roteiro excluído');
      setCurrentScriptId(null);
      setBaseMessage('');
      setVariations([]);
      // Re-fetch
      const listResult = await scriptsQueries.list(tenantId);
      const list = listResult.data || [];
      setAllScripts(list);
      const next = list[0] as any;
      if (next) {
        setCurrentScriptId(next.id);
        setBaseMessage(next.base_message || next.baseMessage || '');
        setVariations(mapScriptVariations(next));
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro', 'Não foi possível excluir o roteiro.');
    }
  };

  const handleAddVariation = () => {
    if (variations.length >= 3) {
      toast.error('Limite Atingido', 'Você pode configurar no máximo 3 variantes de teste A/B/C.');
      return;
    }

    const newVar: ScriptVariation = {
      id: Date.now().toString(),
      name: `Variante ${String.fromCharCode(65 + variations.length)}`,
      weight: 0,
      content: '',
    };

    setVariations([...variations, newVar]);
  };

  const handleRemoveVariation = (id: string) => {
    setVariations(variations.filter(v => v.id !== id));
  };

  const handleWeightChange = (id: string, value: number) => {
    setVariations(variations.map(v => v.id === id ? { ...v, weight: value } : v));
  };

  const handleContentChange = (id: string, value: string) => {
    setVariations(variations.map(v => v.id === id ? { ...v, content: value } : v));
  };

  const handleNameChange = (id: string, value: string) => {
    setVariations(variations.map(v => v.id === id ? { ...v, name: value } : v));
  };

  const handleSave = async () => {
    if (!tenantId) return;
    if (!baseMessage.trim()) {
      toast.error('Roteiro vazio', 'Informe a abordagem base antes de salvar.');
      return;
    }

    if (variations.some((variation) => !variation.content.trim())) {
      toast.error('Variante vazia', 'Preencha ou remova variantes sem mensagem antes de salvar.');
      return;
    }

    const totalWeight = variations.reduce((sum, v) => sum + v.weight, 0);
    if (variations.length > 0 && totalWeight !== 100) {
      toast.error('Pesos inválidos', `A soma dos pesos das variantes A/B/C deve ser exatamente 100%. Soma atual: ${totalWeight}%`);
      return;
    }

    const mappedVariations = variations.map((variation) => ({
      id: variation.id,
      name: variation.name,
      weight: variation.weight,
      content: variation.content.trim(),
    }));

    try {
      let result;
      if (currentScriptId) {
        result = await scriptsQueries.update(tenantId, currentScriptId, {
          baseMessage: baseMessage.trim(),
          flow: { variations: mappedVariations },
          variations: mappedVariations,
        });
      } else {
        result = await scriptsQueries.create(tenantId, {
          baseMessage: baseMessage.trim(),
        });
      }
      if (result.error) throw new Error(result.error.message);
      const savedScript = result.data;
      if (savedScript?.id) {
        setCurrentScriptId(savedScript.id);
      }
      toast.success('Roteiro salvo', 'Alterações confirmadas.');
    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message || 'Não foi possível confirmar a gravação do roteiro.'
        : 'Não foi possível confirmar a gravação do roteiro.';
      toast.error('Erro ao salvar', message);
    }
  };

  const handleSimulate = async () => {
    if (!simulationInput.trim()) return;

    setIsLoadingSim(true);
    try {
      const res = await apiFetch('/api/scripts/simulate', {
        method: 'POST',
        body: JSON.stringify({
          input: simulationInput,
          baseMessage,
          variations,
        }),
      });
      const json = await res.json();

      if (json) {
        setSimulationResponse(json.reply);
        setSimulatedVariant(json.variantUsed);
      }
      setIsLoadingSim(false);
    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message || 'A API não gerou uma resposta para a simulação.'
        : 'A API não gerou uma resposta para a simulação.';
      toast.error('Erro na simulação', message);
      setIsLoadingSim(false);
    }
  };

  return (
    <div className="space-y-5 flex flex-col h-full animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shrink-0">
        <MessageSquare className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Roteiros definem a personalidade da IA.</strong> Crie variantes para testar qual abordagem converte mais. A IA faz testes A/B automaticamente e mostra resultados em Performance.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm shrink-0">
        <button
          onClick={() => setActiveSection('roteiro')}
          className={`h-8 px-3 rounded-md text-[12px] font-medium transition-all ${activeSection === 'roteiro' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}
        >
          Roteiro ativo
        </button>
        <button
          onClick={() => setActiveSection('variantes')}
          className={`h-8 px-3 rounded-md text-[12px] font-medium transition-all ${activeSection === 'variantes' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}
        >
          Variantes
        </button>
        <button
          onClick={() => setActiveSection('simulacao')}
          className={`h-8 px-3 rounded-md text-[12px] font-medium transition-all ${activeSection === 'simulacao' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}
        >
          Simulação
        </button>
        <div className="ml-auto flex items-center gap-2">
          {allScripts.length > 1 && (
            <select
              value={currentScriptId || ''}
              onChange={(e) => handleSwitchScript(e.target.value)}
              className="h-8 px-2 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[12px] text-[#0F172A] focus:border-[#1B3A6B] outline-none"
            >
              {allScripts.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name || `Roteiro ${s.id.substring(0,6)}`}</option>
              ))}
            </select>
          )}
          {currentScriptId && (
            <Button
              onClick={handleDeleteScript}
              className="bg-[#FEF3F2] hover:bg-[#FEE4E2] text-[#D92D20] border border-[rgba(217,45,32,0.2)] font-semibold px-2 h-8 rounded-lg flex items-center gap-1 text-[12px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            onClick={() => setIsGenerateModalOpen(true)}
            className="bg-[#F1F3F6] hover:bg-[#E5E7EB] text-[#0F172A] border border-[#E5E7EB] font-semibold px-3 h-8 rounded-lg flex items-center gap-1.5 text-[12px]"
          >
            <Wand2 className="w-3.5 h-3.5 text-[#1B3A6B]" />
            Gerar com IA
          </Button>
          <Button
            onClick={handleSave}
            className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-semibold px-3 h-8 rounded-lg flex items-center gap-1.5 text-[12px]"
            disabled={isLoadingScripts}
          >
            <Save className="w-3.5 h-3.5" />
            Salvar
          </Button>
        </div>
      </div>

      {/* ── Roteiro ativo tab ──────────────────────────────────────────── */}
      {activeSection === 'roteiro' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 items-start">
          {/* Base message editor */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="text-[14px] font-semibold text-[#0F172A]">Mensagem base da IA</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Essa é a mensagem principal que a IA usa como base para abordar cada lead</div>
              </div>
              <div className="p-5 space-y-4">
                <Textarea
                  rows={4}
                  value={baseMessage}
                  onChange={(e) => setBaseMessage(e.target.value)}
                  className="w-full bg-white border border-[#E5E7EB] text-[13px] leading-relaxed focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]/20 rounded-xl"
                />
                <div className="flex flex-wrap gap-2">
                  {['[Nome]', '[Empresa]', '[Cidade]'].map((tag) => (
                    <span
                      key={tag}
                      onClick={() => setBaseMessage(baseMessage + ' ' + tag)}
                      className="text-[10px] font-mono font-bold bg-[#F8F9FB] hover:bg-[#EEF0F3] text-[#64748B] border border-[#E5E7EB] px-2.5 py-1 rounded-lg cursor-pointer transition-all"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right column – preview */}
          <div className="space-y-5">
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#1B3A6B]" />
                  <div className="text-[14px] font-semibold text-[#0F172A]">Prévia da mensagem</div>
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Veja como a mensagem chegará para o lead</div>
              </div>
              <div className="p-5">
                <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-4 text-[12px] leading-relaxed text-[#334155]">
                  {baseMessage
                    ? baseMessage
                        .replace('[Nome]', 'Dr. Ricardo')
                        .replace('[Empresa]', 'Clínica OrthoLife')
                        .replace('[Cidade]', 'sua cidade')
                    : <span className="text-[#64748B] italic">Escreva a mensagem base para visualizar a prévia aqui...</span>
                  }
                </div>
              </div>
            </div>

            {/* Quick stats */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="text-[14px] font-semibold text-[#0F172A]">Resumo do roteiro</div>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#64748B]">Mensagem base</span>
                  <span className="font-semibold text-[#0F172A]">{baseMessage.length} caracteres</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#64748B]">Variantes ativas</span>
                  <span className="font-semibold text-[#0F172A]">{variations.length} / 3</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#64748B]">Status</span>
                  <Badge className="bg-[#ECFDF3] text-[#039855] border border-[#039855]/20 text-[10px] font-bold px-2 py-0">
                    {currentScriptId ? 'Ativo' : 'Rascunho'}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Variantes tab ─────────────────────────────────────────────── */}
      {activeSection === 'variantes' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 items-start">
          <div className="lg:col-span-2 space-y-5">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] font-semibold text-[#0F172A]">Testes A/B/C Comparativos</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Rotacione mensagens alternativas para mensurar qual performa melhor em conversões.</div>
              </div>
              <button
                onClick={handleAddVariation}
                className="h-8 px-3 rounded-lg text-[12px] font-semibold text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1.5 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Variante
              </button>
            </div>

            {/* Variation cards */}
            <div className="space-y-4">
              {variations.length === 0 && (
                <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-8 text-center">
                  <div className="text-[13px] text-[#64748B]">Nenhuma variante criada ainda. Clique em <strong>"+ Variante"</strong> para adicionar.</div>
                </div>
              )}
              {variations.map((v, i) => (
                <div key={v.id} className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-4 space-y-3 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-[12px] font-bold ${VARIATION_BADGE_COLORS[i % VARIATION_BADGE_COLORS.length]}`}>
                        {String.fromCharCode(65 + i)}
                      </div>
                      <input
                        type="text"
                        value={v.name}
                        onChange={(e) => handleNameChange(v.id, e.target.value)}
                        className="text-[13px] font-semibold text-[#0F172A] bg-transparent border-none outline-none focus:ring-0 p-0 w-auto min-w-[120px]"
                      />
                    </div>
                    <button
                      onClick={() => handleRemoveVariation(v.id)}
                      className="p-1.5 rounded-lg hover:bg-[#FEF2F2] text-[#64748B] hover:text-[#D92D20] sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                      aria-label="Remover variação"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <Textarea
                    rows={3}
                    value={v.content}
                    onChange={(e) => handleContentChange(v.id, e.target.value)}
                    placeholder="Escreva a mensagem personalizada utilizando [Nome], [Empresa] ou [Cidade]..."
                    className="w-full bg-[#F8F9FB] border border-[#E5E7EB] text-[12px] leading-relaxed focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]/20 rounded-xl"
                  />

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[#64748B] font-medium">Peso:</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={v.weight}
                      onChange={(e) => handleWeightChange(v.id, parseInt(e.target.value) || 0)}
                      className="flex-1 h-1.5 accent-[#1B3A6B] cursor-pointer"
                    />
                    <span className="text-[12px] font-mono font-semibold text-[#0F172A] min-w-[36px] text-right">{v.weight}%</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Weight summary */}
            {variations.length > 0 && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm px-5 py-3 flex items-center justify-between">
                <span className="text-[12px] text-[#64748B]">Soma dos pesos</span>
                <span className={`text-[13px] font-mono font-bold ${variations.reduce((s, v) => s + v.weight, 0) === 100 ? 'text-[#039855]' : 'text-[#D92D20]'}`}>
                  {variations.reduce((s, v) => s + v.weight, 0)}%
                  {variations.reduce((s, v) => s + v.weight, 0) === 100 ? ' ✓' : ' (deve ser 100%)'}
                </span>
              </div>
            )}
          </div>

          {/* Right column – preview */}
          <div className="space-y-5">
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="text-[14px] font-semibold text-[#0F172A]">Distribuição A/B</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Proporção de envio entre variantes</div>
              </div>
              <div className="p-5 space-y-3">
                {variations.map((v, i) => (
                  <div key={v.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-sm ${VARIATION_BADGE_COLORS[i % VARIATION_BADGE_COLORS.length]}`} />
                        <span className="text-[#334155] font-medium truncate max-w-[140px]">{v.name}</span>
                      </div>
                      <span className="font-mono font-semibold text-[#0F172A]">{v.weight}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-[#F1F3F6] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${VARIATION_BADGE_COLORS[i % VARIATION_BADGE_COLORS.length]}`}
                        style={{ width: `${v.weight}%` }}
                      />
                    </div>
                  </div>
                ))}
                {variations.length === 0 && (
                  <div className="text-[12px] text-[#64748B] text-center py-4">Nenhuma variante</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Simulação tab ─────────────────────────────────────────────── */}
      {activeSection === 'simulacao' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 items-start">
          <div className="lg:col-span-2">
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#1B3A6B]" />
                  <div className="text-[14px] font-semibold text-[#0F172A]">Simulador de Respostas</div>
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Simule a resposta de um lead para testar o comportamento do robô de IA em tempo real.</div>
              </div>
              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">Mensagem da Lead</label>
                  <Textarea
                    rows={3}
                    placeholder="Ex: Gostaria de saber preços e quais operadoras atendem..."
                    value={simulationInput}
                    onChange={(e) => setSimulationInput(e.target.value)}
                    className="w-full bg-[#F8F9FB] border border-[#E5E7EB] text-[13px] leading-relaxed focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]/20 rounded-xl"
                  />
                </div>

                <Button
                  onClick={handleSimulate}
                  className="w-full bg-[#F8F9FB] hover:bg-[#EEF0F3] text-[#0F172A] border border-[#E5E7EB] font-semibold h-10 rounded-xl transition-all flex items-center justify-center gap-2 text-[13px]"
                  disabled={isLoadingSim}
                >
                  {isLoadingSim ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-[#1B3A6B]/30 border-t-[#1B3A6B] rounded-full animate-spin" />
                      <span>Processando LLM...</span>
                    </div>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-[#1B3A6B] fill-current" />
                      <span>Simular Interação</span>
                    </>
                  )}
                </Button>

                {simulationResponse && (
                  <div className="pt-4 border-t border-[#EEF0F3] space-y-3.5 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider block">Resultado</span>
                      <Badge className="bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[10px] font-bold px-2 py-0">
                        {simulatedVariant}
                      </Badge>
                    </div>
                    <div className="bg-[#F8F9FB] p-4 border border-[#E5E7EB] rounded-xl space-y-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#64748B]">
                        <MessageSquare className="w-3.5 h-3.5" />
                        RESPOSTA GERADA PELA IA
                      </div>
                      <p className="text-[12px] text-[#0F172A] leading-relaxed font-medium">
                        {simulationResponse}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column – tips */}
          <div className="space-y-5">
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="text-[14px] font-semibold text-[#0F172A]">Dicas de simulação</div>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-md bg-[rgba(27,58,107,0.08)] flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-[#1B3A6B]">1</span>
                  </div>
                  <p className="text-[12px] text-[#64748B] leading-relaxed">Teste perguntas reais que seus leads costumam fazer</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-md bg-[rgba(27,58,107,0.08)] flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-[#1B3A6B]">2</span>
                  </div>
                  <p className="text-[12px] text-[#64748B] leading-relaxed">Verifique se o tom da resposta está adequado ao nicho</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-md bg-[rgba(27,58,107,0.08)] flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-[#1B3A6B]">3</span>
                  </div>
                  <p className="text-[12px] text-[#64748B] leading-relaxed">Compare respostas entre variantes diferentes</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Script Generator Modal ────────────────────────────────────── */}
      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-border rounded-2xl w-full max-w-[500px] p-6 space-y-5 shadow-2xl animate-scaleIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary-soft text-primary border border-primary/20 rounded-xl">
                  <Wand2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-text">Gerar Roteiro com IA Premium</h3>
                  <p className="text-xs text-text-secondary leading-none mt-0.5">Copywriting consultivo de alta conversão.</p>
                </div>
              </div>
              <button
                onClick={() => setIsGenerateModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-surface-sunken text-text-secondary transition-all"
                aria-label="Fechar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                    Nicho de Atuação (Público-Alvo)
                  </label>
                  <select
                    value={selectedNiche}
                    onChange={(e: any) => setSelectedNiche(e.target.value)}
                    className="w-full bg-white border border-border text-text rounded-xl h-10 px-3 text-xs focus:border-border-strong focus:outline-none"
                    required
                  >
                    <option value="DOCTOR">Médicos, Dentistas e Saúde</option>
                    <option value="LAWYER">Advogados e Jurídicos</option>
                    <option value="BUSINESS_OWNER">Empresários e PMEs</option>
                    <option value="OTHER">Outro nicho personalizado...</option>
                  </select>
                </div>

                {selectedNiche === 'OTHER' && (
                  <div className="animate-fadeIn">
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                      Descreva o Nicho Personalizado
                    </label>
                    <Input
                      placeholder="Ex: Engenheiros civis autônomos"
                      value={customNiche}
                      onChange={(e) => setCustomNiche(e.target.value)}
                      className="bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                    Produto / Cobertura Foco
                  </label>
                  <select
                    value={selectedProduct}
                    onChange={(e: any) => setSelectedProduct(e.target.value)}
                    className="w-full bg-white border border-border text-text rounded-xl h-10 px-3 text-xs focus:border-border-strong focus:outline-none"
                    required
                  >
                    <option value="DIT">Diária de Incapacidade Temporária (DIT)</option>
                    <option value="KEYMAN">Homem-Chave (Keyman) & Societário</option>
                    <option value="PATRIMONY_SUCCESSION">Blindagem & Sucessão (Sem ITCMD)</option>
                    <option value="HEALTH_INSURANCE">Seguro Saúde PME (Economia)</option>
                    <option value="OTHER">Outra cobertura personalizada...</option>
                  </select>
                </div>

                {selectedProduct === 'OTHER' && (
                  <div className="animate-fadeIn">
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                      Descreva o Produto/Cobertura
                    </label>
                    <Input
                      placeholder="Ex: Seguro de Vida Resgatável MetLife"
                      value={customProduct}
                      onChange={(e) => setCustomProduct(e.target.value)}
                      className="bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                    Tom de Voz
                  </label>
                  <select
                    value={selectedTone}
                    onChange={(e: any) => setSelectedTone(e.target.value)}
                    className="w-full bg-white border border-border text-text rounded-xl h-10 px-3 text-xs focus:border-border-strong focus:outline-none"
                    required
                  >
                    <option value="CONSULTATIVE">Consultivo & Amigável (Recomendado)</option>
                    <option value="FORMAL">Corporativo & Formal</option>
                    <option value="DIRECT">Direto ao Ponto & Objetivo</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setIsGenerateModalOpen(false)}
                  variant="outline"
                  className="flex-1 border-border bg-white hover:bg-surface-sunken text-text-secondary h-10 rounded-xl font-bold"
                  disabled={isGenerating}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-primary hover:bg-primary-hover text-white font-bold h-10 rounded-xl transition-all shadow-lg shadow-primary/10 flex items-center justify-center gap-2"
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Gerando com LLM...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3.5 h-3.5" />
                      <span>Criar Abordagem</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
