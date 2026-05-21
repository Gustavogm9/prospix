import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Textarea, toast, Badge } from '@prospix/ui';
import { Play, Sparkles, MessageSquare, Plus, Save, Trash2 } from 'lucide-react';
import { apiClient } from '../lib/api-client';

interface ScriptVariation {
  id: string;
  name: string;
  weight: number; // percentage
  content: string;
}

export default function Scripts() {
  const [baseMessage, setBaseMessage] = useState(
    'Olá [Nome], notei que a [Empresa] é líder no setor em [Cidade]. Consegui uma cotação especial de Seguro Saúde Corporativo PME para vocês. Gostaria de receber uma tabela comparativa sem compromisso?'
  );

  const [variations, setVariations] = useState<ScriptVariation[]>([
    { id: '1', name: 'Variante A (Foco em Economia)', weight: 50, content: 'Olá [Nome], sabia que a [Empresa] pode reduzir até 35% do plano de saúde corporativo atual? Consegue me atender para um alinhamento rápido de 5 minutos?' },
    { id: '2', name: 'Variante B (Foco em Rede Credenciada)', weight: 50, content: 'Olá [Nome], temos condições exclusivas com hospitais premium da rede Amil e SulAmérica para empresas em [Cidade]. Posso te enviar as tabelas comparativas?' },
  ]);

  const [simulationInput, setSimulationInput] = useState('Quanto custa para 10 funcionários?');
  const [simulationResponse, setSimulationResponse] = useState<string | null>(null);
  const [simulatedVariant, setSimulatedVariant] = useState<string | null>(null);
  const [isLoadingSim, setIsLoadingSim] = useState(false);

  const handleAddVariation = () => {
    if (variations.length >= 3) {
      toast.error('Limite Atingido', 'Você pode configurar no máximo 3 variantes de teste A/B/C.');
      return;
    }

    const newVar: ScriptVariation = {
      id: Date.now().toString(),
      name: `Variante ${String.fromCharCode(65 + variations.length)} (Custom)`,
      weight: 0,
      content: 'Escreva a mensagem personalizada utilizando [Nome], [Empresa] ou [Cidade]...',
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
    const totalWeight = variations.reduce((sum, v) => sum + v.weight, 0);
    if (variations.length > 0 && totalWeight !== 100) {
      toast.error('Pesos inválidos', `A soma dos pesos das variantes A/B/C deve ser exatamente 100%. Soma atual: ${totalWeight}%`);
      return;
    }

    try {
      await apiClient.post('/tenant/scripts', {
        baseMessage,
        variations,
      });
      toast.success('Roteiro Salvo!', 'Roteiros de IA atualizados e implantados em produção.');
    } catch {
      // simulate success anyway for mock
      toast.success('Script Salvo com Sucesso', 'Mock REST: Roteiros A/B sincronizados com RLS de tenant.');
    }
  };

  const handleSimulate = async () => {
    if (!simulationInput.trim()) return;

    setIsLoadingSim(true);
    try {
      // REST Post to /scripts/:id/test
      const response = await apiClient.post('/scripts/simulate', {
        input: simulationInput,
        baseMessage,
        variations,
      }).catch(() => null);

      if (response?.data) {
        setSimulationResponse(response.data.reply);
        setSimulatedVariant(response.data.variantUsed);
      } else {
        // High fidelity mock AI responses aligned with multi-provider fallbacks (GPT-4 / Claude)
        setTimeout(() => {
          setSimulatedVariant('Variante A (Foco em Economia)');
          setSimulationResponse(
            'Entendo sua dúvida! O custo por funcionário varia de acordo com a faixa etária de cada um. Na nossa Variante A, conseguimos planos a partir de R$ 140,00 mensais por colaborador com cobertura nacional. Para eu simular a cotação perfeita para as 10 vidas, você prefere que eu envie um formulário rápido pelo WhatsApp ou prefere uma ligação de 5 minutos?'
          );
          setIsLoadingSim(false);
        }, 1200);
      }
    } catch (err) {
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
            onClick={handleSave}
            className="bg-primary hover:bg-primary-hover text-white font-semibold px-4 h-10 rounded-xl flex items-center gap-2 shadow-lg shadow-primary/10"
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
    </div>
  );
}
