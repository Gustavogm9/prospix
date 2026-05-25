import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Textarea, toast, Badge } from '@prospix/ui';
import { Play, Sparkles, MessageSquare, Plus, Save, Trash2, Wand2, X } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { AxiosError } from 'axios';
import { canUseMockFallbacks } from '../lib/demo-mode';

interface ScriptVariation {
  id: string;
  name: string;
  weight: number; // percentage
  content: string;
}

const DEMO_BASE_MESSAGE =
  'Olá [Nome], notei que a [Empresa] é líder no setor em [Cidade]. Consegui uma cotação especial de Seguro Saúde Corporativo PME para vocês. Gostaria de receber uma tabela comparativa sem compromisso?';

const DEMO_VARIATIONS: ScriptVariation[] = [
  { id: '1', name: 'Variante A (Foco em Economia)', weight: 50, content: 'Olá [Nome], sabia que a [Empresa] pode reduzir até 35% do plano de saúde corporativo atual? Consegue me atender para um alinhamento rápido de 5 minutos?' },
  { id: '2', name: 'Variante B (Foco em Rede Credenciada)', weight: 50, content: 'Olá [Nome], temos condições exclusivas com hospitais premium da rede Amil e SulAmérica para empresas em [Cidade]. Posso te enviar as tabelas comparativas?' },
];

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
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);
  const [baseMessage, setBaseMessage] = useState(canUseMockFallbacks ? DEMO_BASE_MESSAGE : '');
  const [variations, setVariations] = useState<ScriptVariation[]>(canUseMockFallbacks ? DEMO_VARIATIONS : []);
  const [isLoadingScripts, setIsLoadingScripts] = useState(true);
  const [simulationInput, setSimulationInput] = useState(canUseMockFallbacks ? 'Quanto custa para 10 funcionários?' : '');
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
      const response = await apiClient.post('/tenant/scripts/generate', {
        niche: selectedNiche,
        customNiche: selectedNiche === 'OTHER' ? customNiche : null,
        product: selectedProduct,
        customProduct: selectedProduct === 'OTHER' ? customProduct : null,
        tone: selectedTone,
      });

      const data = response.data?.data;
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
    const fetchScripts = async () => {
      try {
        const response = await apiClient.get('/tenant/scripts');
        const list = Array.isArray(response.data) ? response.data : response.data?.data;
        const activeScript = (list || []).find((script: any) => script.status === 'ACTIVE') || list?.[0];

        if (activeScript) {
          setCurrentScriptId(activeScript.id);
          setBaseMessage(activeScript.baseMessage || '');
          setVariations(mapScriptVariations(activeScript));
        } else if (!canUseMockFallbacks) {
          setCurrentScriptId(null);
          setBaseMessage('');
          setVariations([]);
        }
      } catch (err) {
        console.error('Error fetching scripts', err);
        if (!canUseMockFallbacks) {
          setCurrentScriptId(null);
          setBaseMessage('');
          setVariations([]);
          toast.error('Erro de Conexão', 'Não foi possível carregar roteiros reais da API.');
        }
      } finally {
        setIsLoadingScripts(false);
      }
    };

    fetchScripts();
  }, []);

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

  const handleSave = async () => {
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

    const payload = {
      baseMessage: baseMessage.trim(),
      variations: variations.map((variation) => ({
        id: variation.id,
        name: variation.name,
        weight: variation.weight,
        content: variation.content.trim(),
      })),
    };

    try {
      const response = currentScriptId
        ? await apiClient.patch(`/tenant/scripts/${currentScriptId}`, {
            baseMessage: payload.baseMessage,
            flow: { variations: payload.variations },
          })
        : await apiClient.post('/tenant/scripts', payload);

      const savedScript = response?.data?.data ?? response?.data;
      if (savedScript?.id) {
        setCurrentScriptId(savedScript.id);
      }
      toast.success('Roteiro salvo', 'Alterações confirmadas pela API.');
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Não foi possível confirmar a gravação do roteiro na API.'
        : 'Não foi possível confirmar a gravação do roteiro na API.';
      toast.error('Erro ao salvar', message);
    }
  };

  const handleSimulate = async () => {
    if (!simulationInput.trim()) return;

    setIsLoadingSim(true);
    try {
      const response = await apiClient.post('/tenant/scripts/simulate', {
        input: simulationInput,
        baseMessage,
        variations,
      });

      if (response?.data) {
        setSimulationResponse(response.data.reply);
        setSimulatedVariant(response.data.variantUsed);
      }
      setIsLoadingSim(false);
    } catch (err: unknown) {
      if (canUseMockFallbacks) {
        setTimeout(() => {
          setSimulatedVariant('Variante A (Foco em Economia)');
          setSimulationResponse(
            'Entendo sua dúvida! O custo por funcionário varia de acordo com a faixa etária de cada um. Na nossa Variante A, conseguimos planos a partir de R$ 140,00 mensais por colaborador com cobertura nacional. Para eu simular a cotação perfeita para as 10 vidas, você prefere que eu envie um formulário rápido pelo WhatsApp ou prefere uma ligação de 5 minutos?'
          );
          setIsLoadingSim(false);
        }, 1200);
        return;
      }
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'A API não gerou uma resposta para a simulação.'
        : 'A API não gerou uma resposta para a simulação.';
      toast.error('Erro na simulação', message);
      setIsLoadingSim(false);
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full animate-fadeIn">
      {/* Header Scripts */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Roteiros e Fluxos de IA</h2>
          <p className="text-text-secondary text-sm mt-1">
            Configure as abordagens de atração ativa e personalize as variantes de testes comparativos A/B.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setIsGenerateModalOpen(true)}
            className="bg-surface-sunken hover:bg-border text-text border border-border/80 font-semibold px-4 h-10 rounded-xl flex items-center gap-2 shadow-sm"
          >
            <Wand2 className="w-4 h-4 text-primary" />
            <span>Gerar com IA</span>
          </Button>
          <Button
            onClick={handleSave}
            className="bg-primary hover:bg-primary-hover text-white font-semibold px-4 h-10 rounded-xl flex items-center gap-2 shadow-lg shadow-primary/10"
            disabled={isLoadingScripts}
          >
            <Save className="w-4 h-4" />
            <span>Salvar Roteiro</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 items-start">
        {/* Editor Box */}
        <div className="lg:col-span-2 space-y-6">
          {/* Base Message Box */}
          <Card className="bg-white border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold font-heading text-text">Abordagem Base (Frio)</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Esta é a mensagem inicial de captação ativa enviada aos leads do Google Maps.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                rows={4}
                value={baseMessage}
                onChange={(e) => setBaseMessage(e.target.value)}
                className="w-full bg-white border-border text-xs leading-relaxed focus:border-border-strong rounded-xl"
              />
              <div className="flex flex-wrap gap-2">
                {['[Nome]', '[Empresa]', '[Cidade]'].map((tag) => (
                  <span
                    key={tag}
                    onClick={() => setBaseMessage(baseMessage + ' ' + tag)}
                    className="text-[10px] font-mono font-bold bg-surface-sunken hover:bg-border text-text-secondary border border-border/85 px-2.5 py-1 rounded-lg cursor-pointer transition-all"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* A/B Testing Variations */}
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold font-heading text-text">Testes A/B/C Comparativos</CardTitle>
                <CardDescription className="text-text-secondary text-xs">
                  Rotacione mensagens alternativas para mensurar qual performa melhor em conversões.
                </CardDescription>
              </div>
              <Button
                onClick={handleAddVariation}
                variant="outline"
                className="border-border text-text-secondary hover:text-text text-xs font-semibold px-3 h-8 hover:bg-surface-sunken flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Variante</span>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {variations.map((v) => (
                <div key={v.id} className="p-4 rounded-xl bg-surface-sunken border border-border space-y-3 relative group">
                  <button
                    onClick={() => handleRemoveVariation(v.id)}
                    className="absolute top-4 right-4 p-1 rounded-lg hover:bg-red-50 text-text-secondary hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    aria-label="Remover variação"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h4 className="text-xs font-bold text-text">{v.name}</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-secondary font-semibold uppercase tracking-wider">Peso:</span>
                      <div className="relative w-20">
                        <Input
                          type="number"
                          value={v.weight}
                          onChange={(e) => handleWeightChange(v.id, parseInt(e.target.value) || 0)}
                          className="bg-white border-border h-7 text-text text-xs font-mono pl-2 pr-5 focus:border-border-strong"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-text-secondary font-mono">%</span>
                      </div>
                    </div>
                  </div>

                  <Textarea
                    rows={3}
                    value={v.content}
                    onChange={(e) => handleContentChange(v.id, e.target.value)}
                    placeholder="Escreva a mensagem personalizada utilizando [Nome], [Empresa] ou [Cidade]..."
                    className="w-full bg-white border-border text-xs leading-relaxed focus:border-border-strong rounded-xl"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* AI Simulator Box */}
        <Card className="bg-white border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>Simulador de Respostas</span>
            </CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Simule a resposta de um lead para testar o comportamento do robô de IA em tempo real.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Mensagem da Lead</label>
              <Textarea
                rows={3}
                placeholder="Ex: Gostaria de saber preços e quais operadoras atendem..."
                value={simulationInput}
                onChange={(e) => setSimulationInput(e.target.value)}
                className="w-full bg-white border-border text-xs leading-relaxed focus:border-border-strong rounded-xl"
              />
            </div>

            <Button
              onClick={handleSimulate}
              className="w-full bg-surface-sunken hover:bg-border text-text border border-border/80 font-semibold h-10 rounded-xl transition-all flex items-center justify-center gap-2"
              disabled={isLoadingSim}
            >
              {isLoadingSim ? (
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <span>Processando LLM...</span>
                </div>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-primary fill-current" />
                  <span>Simular Interação</span>
                </>
              )}
            </Button>

            {simulationResponse && (
              <div className="pt-4 border-t border-border space-y-3.5 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider block">Resultado</span>
                  <Badge className="bg-primary-soft text-primary border border-primary/20 text-[9px] font-bold px-2 py-0">
                    {simulatedVariant}
                  </Badge>
                </div>
                <div className="bg-surface-sunken p-4 border border-border rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-[9px] font-semibold text-text-secondary">
                    <MessageSquare className="w-3.5 h-3.5" />
                    RESPOSTA GERADA PELA IA
                  </div>
                  <p className="text-xs text-text leading-relaxed font-medium">
                    {simulationResponse}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
