'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button, Input, Textarea, toast, Badge } from '@prospix/ui';
import { 
  Play, Sparkles, MessageSquare, Plus, Save, Trash2, Wand2, X, ArrowLeft, 
  BarChart3, Settings, Zap, Clock, GitBranch, ShieldAlert
} from 'lucide-react';
import { scriptsQueries, campaignsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { apiFetch } from '@/lib/api-fetch';

type ActiveTab = 'FLOW' | 'MESSAGES' | 'PERFORMANCE' | 'SETTINGS';

interface ScriptVariation {
  id: string;
  name: string;
  weight: number;
  content: string;
}

const CATEGORY_OPTIONS = [
  { value: 'APPROACH', label: 'Abordagem Inicial' },
  { value: 'OBJECTION', label: 'Contorno de Objeções' },
  { value: 'EDUCATION', label: 'Educação / Nutrição' },
  { value: 'CLOSING', label: 'Fechamento' },
  { value: 'FOLLOW_UP', label: 'Follow Up / Pós-reunião' },
];

const VARIATION_COLORS = ['bg-[#1B3A6B]', 'bg-[#5A2A82]', 'bg-[#B8740E]'];

export default function ScriptDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const scriptId = params.id as string;
  const tenantId = useAuthStore(state => state.tenantId);
  
  const [activeTab, setActiveTab] = useState<ActiveTab>('MESSAGES');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Script State
  const [name, setName] = useState('Novo Roteiro');
  const [category, setCategory] = useState('APPROACH');
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [baseMessage, setBaseMessage] = useState('');
  const [variations, setVariations] = useState<ScriptVariation[]>([]);
  const [aiTools, setAiTools] = useState<string[]>([]);
  const [stats, setStats] = useState({ usages: 0, responseRate: 0, conversionRate: 0 });
  const [activeCampaigns, setActiveCampaigns] = useState<any[]>([]);

  // AI Gen State
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState('DOCTOR');
  const [selectedProduct, setSelectedProduct] = useState('DIT');

  useEffect(() => {
    if (!tenantId || !scriptId) return;
    if (scriptId === 'new') {
      setIsLoading(false);
      return;
    }

    const fetchScript = async () => {
      try {
        const { data, error } = await scriptsQueries.list(tenantId);
        if (!error && data) {
          const script = data.find((s: any) => s.id === scriptId);
          if (script) {
            setName(script.name || 'Sem nome');
            setCategory(script.category || 'APPROACH');
            setStatus(script.status || 'ACTIVE');
            setBaseMessage(script.base_message || '');
            setAiTools(script.ai_tools || []);
            setStats({
              usages: script.total_usages || 0,
              responseRate: script.response_rate || 0,
              conversionRate: script.conversion_rate || 0,
            });

            // Fetch campaigns
            const { data: camps } = await campaignsQueries.getByScript(tenantId, scriptId);
            if (camps) setActiveCampaigns(camps);

            // Parse variations
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
        // We can't save aiTools or status directly on create in current signature, we update right after
        if (data?.id) {
          await scriptsQueries.update(tenantId, data.id, { status, aiTools });
        }
        if (error) throw error;
        toast.success('Roteiro criado com sucesso');
        router.replace(`/roteiros/${data?.id}`);
      } else {
        const { error } = await scriptsQueries.update(tenantId, scriptId, {
          name, category, baseMessage, variations: mappedVariations, status, aiTools
        });
        if (error) throw error;
        toast.success('Alterações salvas com sucesso');
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
          weight: v.weight || 50,
          content: v.content || '',
        }));
        setVariations(mapped);
        toast.success('Variações geradas!');
        setIsAiModalOpen(false);
      }
    } catch (err) {
      toast.error('Erro ao gerar com IA');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddVariation = () => {
    if (variations.length >= 3) {
      toast.error('Limite atingido', 'Máximo de 3 variações simultâneas.');
      return;
    }
    setVariations([
      ...variations, 
      { id: `temp_${Date.now()}`, name: `Variação ${String.fromCharCode(65 + variations.length)}`, weight: 0, content: '' }
    ]);
  };

  if (isLoading) {
    return <div className="p-8 text-center text-[#64748B]">Carregando roteiro...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#F8F9FB] -m-6 p-6 overflow-y-auto">
      {/* Top Navigation */}
      <div className="max-w-5xl mx-auto w-full">
        <button 
          onClick={() => router.push('/roteiros')}
          className="flex items-center gap-2 text-[13px] font-semibold text-[#64748B] hover:text-[#0F172A] transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Galeria
        </button>

        {/* Header Card */}
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm mb-6 flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#1B3A6B] rounded-xl flex items-center justify-center shrink-0 shadow-md shadow-[#1B3A6B]/20">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#0F172A] mb-1">{name}</h1>
              <div className="flex items-center gap-3 text-[12px] font-medium text-[#64748B]">
                <Badge className="bg-[#F1F3F6] text-[#475569] border-none px-2 py-0.5">
                  {CATEGORY_OPTIONS.find(c => c.value === category)?.label || 'Sem Categoria'}
                </Badge>
                <span className="flex items-center gap-1"><Play className="w-3.5 h-3.5 text-[#039855]" /> Ativo</span>
                <span>•</span>
                <span>Treinada em {stats.usages} conversas</span>
              </div>
            </div>
          </div>
          <Button 
            onClick={handleSave}
            disabled={isSaving}
            className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-bold h-10 px-5 rounded-xl shadow-md transition-all flex items-center gap-2"
          >
            {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar Alterações
          </Button>
        </div>

        {/* Main Tabs */}
        <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm overflow-hidden mb-10">
          <div className="flex border-b border-[#E5E7EB] px-2 bg-[#F8F9FB]">
            <button
              onClick={() => setActiveTab('FLOW')}
              className={`px-5 py-3.5 text-[13px] font-semibold transition-all border-b-2 flex items-center gap-2 ${activeTab === 'FLOW' ? 'border-[#1B3A6B] text-[#1B3A6B] bg-white' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
            >
              <GitBranch className="w-4 h-4" /> Fluxo da conversa
            </button>
            <button
              onClick={() => setActiveTab('MESSAGES')}
              className={`px-5 py-3.5 text-[13px] font-semibold transition-all border-b-2 flex items-center gap-2 ${activeTab === 'MESSAGES' ? 'border-[#1B3A6B] text-[#1B3A6B] bg-white' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
            >
              <MessageSquare className="w-4 h-4" /> Mensagens & variações
            </button>
            <button
              onClick={() => setActiveTab('PERFORMANCE')}
              className={`px-5 py-3.5 text-[13px] font-semibold transition-all border-b-2 flex items-center gap-2 ${activeTab === 'PERFORMANCE' ? 'border-[#1B3A6B] text-[#1B3A6B] bg-white' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
            >
              <BarChart3 className="w-4 h-4" /> Performance
            </button>
            <button
              onClick={() => setActiveTab('SETTINGS')}
              className={`px-5 py-3.5 text-[13px] font-semibold transition-all border-b-2 flex items-center gap-2 ml-auto ${activeTab === 'SETTINGS' ? 'border-[#1B3A6B] text-[#1B3A6B] bg-white' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
            >
              <Settings className="w-4 h-4" /> Configurações
            </button>
          </div>

          <div className="p-6 bg-white min-h-[400px]">
            {/* ── SETTINGS TAB ── */}
            {activeTab === 'SETTINGS' && (
              <div className="max-w-3xl space-y-8 animate-fadeIn">
                {/* General Settings Card */}
                <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm space-y-6">
                  <h3 className="text-[16px] font-bold text-[#0F172A] mb-4">Configurações gerais</h3>
                  
                  <div className="grid grid-cols-[200px_1fr] items-center gap-4">
                    <label className="text-[13px] font-bold text-[#475569]">Nome do roteiro</label>
                    <Input 
                      value={name} 
                      onChange={e => setName(e.target.value)} 
                      className="h-10 border-[#E5E7EB] focus:border-[#1B3A6B] bg-[#F8F9FB] text-[13px]"
                    />
                  </div>
                  <hr className="border-[#EEF0F3]" />

                  <div className="grid grid-cols-[200px_1fr] items-center gap-4">
                    <label className="text-[13px] font-bold text-[#475569]">Categoria</label>
                    <div className="flex gap-2">
                      {CATEGORY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setCategory(opt.value)}
                          className={`px-4 py-2 rounded-full text-[12px] font-semibold transition-all ${
                            category === opt.value 
                              ? 'bg-[#1B3A6B] text-white' 
                              : 'bg-[#F8F9FB] text-[#475569] border border-[#EEF0F3] hover:border-[#CBD5E1]'
                          }`}
                        >
                          {opt.label.split(' / ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <hr className="border-[#EEF0F3]" />

                  <div className="grid grid-cols-[200px_1fr] items-center gap-4">
                    <div>
                      <label className="text-[13px] font-bold text-[#475569] block">Status do roteiro</label>
                      <span className="text-[11px] text-[#94A3B8] font-medium leading-tight inline-block mt-0.5">Pause aqui se quiser parar de usar sem deletar</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={status === 'ACTIVE'}
                        onChange={(e) => setStatus(e.target.checked ? 'ACTIVE' : 'DRAFT')}
                      />
                      <div className="w-11 h-6 bg-[#E5E7EB] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#CBD5E1] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1B3A6B]"></div>
                    </label>
                  </div>
                  <hr className="border-[#EEF0F3]" />

                  <div className="grid grid-cols-[200px_1fr] items-center gap-4">
                    <label className="text-[13px] font-bold text-[#475569]">Campanhas usando</label>
                    <div className="text-[13px] text-[#334155]">
                      {activeCampaigns.length === 0 ? 'Nenhuma campanha ativa no momento.' : (
                        <span>
                          {activeCampaigns.length} ativa(s) - {activeCampaigns.map(c => `"${c.name}"`).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* AI Tools Card */}
                <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-sm space-y-6">
                  <h3 className="text-[16px] font-bold text-[#0F172A] mb-4">Ferramentas que a IA pode usar neste roteiro</h3>
                  
                  {[
                    { id: 'CALENDAR_READ', label: 'Consultar agenda do Giovane', desc: 'Pra oferecer horários reais' },
                    { id: 'CALENDAR_WRITE', label: 'Agendar reunião no Calendar', desc: 'Quando o lead aceitar horário' },
                    { id: 'SEND_PDF', label: 'Enviar PDF institucional MetLife', desc: 'Quando lead pedir mais informação' },
                    { id: 'ESCALATE', label: 'Encaminhar pra Giovane', desc: 'Quando lead pedir ligação ou ficar com dúvidas' }
                  ].map((tool, idx) => {
                    const isChecked = aiTools.includes(tool.id);
                    return (
                      <div key={tool.id}>
                        <div className="grid grid-cols-[200px_1fr] items-center gap-4">
                          <div>
                            <label className="text-[13px] font-bold text-[#475569] block">{tool.label}</label>
                            <span className="text-[11px] text-[#94A3B8] font-medium leading-tight inline-block mt-0.5">{tool.desc}</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              className="sr-only peer" 
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) setAiTools([...aiTools, tool.id]);
                                else setAiTools(aiTools.filter(t => t !== tool.id));
                              }}
                            />
                            <div className="w-11 h-6 bg-[#E5E7EB] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#CBD5E1] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1B3A6B]"></div>
                          </label>
                        </div>
                        {idx < 3 && <hr className="border-[#EEF0F3] mt-6" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── FLOW TAB ── */}
            {activeTab === 'FLOW' && (
              <div className="flex justify-center py-6 animate-fadeIn">
                <div className="relative w-full max-w-[400px]">
                  {/* Vertical Line */}
                  <div className="absolute left-[24px] top-[24px] bottom-0 w-0.5 bg-[#E5E7EB] z-0" />
                  
                  {/* Nodes */}
                  <div className="space-y-8 relative z-10">
                    {/* Node 1: Trigger */}
                    <div className="flex gap-4">
                      <div className="w-12 h-12 rounded-full bg-white border-2 border-[#1B3A6B] flex items-center justify-center shrink-0 shadow-sm">
                        <Zap className="w-5 h-5 text-[#1B3A6B]" />
                      </div>
                      <div className="flex-1 bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
                        <Badge className="bg-[#F1F3F6] text-[#475569] border-none text-[9px] font-bold tracking-wider px-1.5 py-0 mb-1.5">GATILHO</Badge>
                        <h4 className="text-[14px] font-bold text-[#0F172A]">Lead capturado</h4>
                        <p className="text-[12px] text-[#64748B] mt-1">Inicia quando um lead entra via Landing Page ou Ads.</p>
                      </div>
                    </div>

                    {/* Node 2: Wait */}
                    <div className="flex gap-4">
                      <div className="w-12 h-12 rounded-full bg-white border-2 border-[#CBD5E1] flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 text-[#94A3B8]" />
                      </div>
                      <div className="flex-1 bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm border-dashed">
                        <Badge className="bg-[#F8F9FB] text-[#64748B] border-none text-[9px] font-bold tracking-wider px-1.5 py-0 mb-1.5">ESPERA</Badge>
                        <h4 className="text-[14px] font-semibold text-[#334155]">Aguardar horário ideal</h4>
                        <p className="text-[12px] text-[#94A3B8] mt-1">Apenas em horário comercial (08h às 18h).</p>
                      </div>
                    </div>

                    {/* Node 3: Message */}
                    <div className="flex gap-4">
                      <div className="w-12 h-12 rounded-full bg-white border-2 border-[#039855] flex items-center justify-center shrink-0 shadow-sm">
                        <MessageSquare className="w-5 h-5 text-[#039855]" />
                      </div>
                      <div className="flex-1 bg-[#ECFDF3]/50 border border-[#039855]/30 rounded-xl p-4 shadow-sm">
                        <Badge className="bg-[#ECFDF3] text-[#039855] border-[#039855]/20 text-[9px] font-bold tracking-wider px-1.5 py-0 mb-1.5">ENVIO (A/B)</Badge>
                        <h4 className="text-[14px] font-bold text-[#0F172A]">Mensagem inicial</h4>
                        <p className="text-[12px] text-[#64748B] mt-1">Utiliza as variações configuradas na aba ao lado.</p>
                      </div>
                    </div>

                    {/* Node 4: Decision */}
                    <div className="flex gap-4">
                      <div className="w-12 h-12 rounded-full bg-white border-2 border-[#B8740E] flex items-center justify-center shrink-0 shadow-sm">
                        <GitBranch className="w-5 h-5 text-[#B8740E]" />
                      </div>
                      <div className="flex-1 bg-[#FEF9F0]/50 border border-[#B8740E]/30 rounded-xl p-4 shadow-sm">
                        <Badge className="bg-[#FEF9F0] text-[#B8740E] border-[#B8740E]/20 text-[9px] font-bold tracking-wider px-1.5 py-0 mb-1.5">DECISÃO (IA)</Badge>
                        <h4 className="text-[14px] font-bold text-[#0F172A]">Classificar intenção</h4>
                        <p className="text-[12px] text-[#64748B] mt-1">A IA analisa a resposta do lead e roteia a conversa.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── PERFORMANCE TAB ── */}
            {activeTab === 'PERFORMANCE' && (
              <div className="animate-fadeIn">
                <div className="grid grid-cols-3 gap-5 mb-8">
                  <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm text-center">
                    <div className="text-[12px] font-bold text-[#64748B] uppercase tracking-wide mb-2">Total de Envios</div>
                    <div className="text-3xl font-bold font-heading text-[#0F172A]">{stats.usages}</div>
                  </div>
                  <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm text-center">
                    <div className="text-[12px] font-bold text-[#64748B] uppercase tracking-wide mb-2">Taxa de Resposta</div>
                    <div className="text-3xl font-bold font-heading text-[#039855]">{Math.round(stats.responseRate)}%</div>
                  </div>
                  <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm text-center">
                    <div className="text-[12px] font-bold text-[#64748B] uppercase tracking-wide mb-2">Agendamentos</div>
                    <div className="text-3xl font-bold font-heading text-[#1B3A6B]">{Math.round(stats.conversionRate)}%</div>
                  </div>
                </div>
                <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-8 flex flex-col items-center justify-center text-center">
                  <BarChart3 className="w-10 h-10 text-[#94A3B8] mb-3" />
                  <h3 className="text-[14px] font-bold text-[#0F172A] mb-1">Gráficos Detalhados</h3>
                  <p className="text-[12px] text-[#64748B] max-w-md">Em breve você poderá visualizar a performance de conversão separada por cada variação (A/B/C) ao longo do tempo.</p>
                </div>
              </div>
            )}

            {/* ── MESSAGES AND VARIATIONS TAB ── */}
            {activeTab === 'MESSAGES' && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 animate-fadeIn">
                <div className="space-y-6">
                  {/* Base Message */}
                  <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm">
                    <div className="mb-3">
                      <h3 className="text-[14px] font-bold text-[#0F172A]">Mensagem Base</h3>
                      <p className="text-[12px] text-[#64748B]">A mensagem principal da IA. Se houver variações A/B, elas serão usadas no lugar desta para testes de performance.</p>
                    </div>
                    <Textarea 
                      rows={4}
                      value={baseMessage}
                      onChange={e => setBaseMessage(e.target.value)}
                      className="w-full bg-[#F8F9FB] border-[#EEF0F3] text-[13px] leading-relaxed text-[#334155] rounded-xl focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]/20"
                      placeholder="Digite a abordagem inicial padrão..."
                    />
                  </div>

                  {/* Toolbar */}
                  <div className="flex items-center justify-between pt-2">
                    <h3 className="text-[16px] font-bold text-[#0F172A]">Teste de Variações A/B</h3>
                    <div className="flex items-center gap-3">
                      <Button onClick={() => setIsAiModalOpen(true)} className="bg-[#F8F9FB] hover:bg-[#EEF0F3] text-[#0F172A] border border-[#E5E7EB] font-semibold h-8 px-3 rounded-lg flex items-center gap-1.5 text-[12px] shadow-sm">
                        <Wand2 className="w-3.5 h-3.5 text-[#1B3A6B]" /> Gerar com IA
                      </Button>
                      <Button onClick={handleAddVariation} className="bg-white hover:bg-[#F8F9FB] text-[#475569] border border-[#E5E7EB] font-semibold h-8 px-3 rounded-lg flex items-center gap-1.5 text-[12px] shadow-sm">
                        <Plus className="w-3.5 h-3.5" /> Adicionar
                      </Button>
                    </div>
                  </div>

                  {variations.length === 0 ? (
                    <div className="bg-white border border-dashed border-[#CBD5E1] rounded-2xl p-10 text-center">
                      <p className="text-[13px] text-[#64748B]">Nenhuma variação configurada. Crie uma nova ou gere com IA.</p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {variations.map((v, i) => {
                        const colorClass = VARIATION_COLORS[i % VARIATION_COLORS.length];
                        return (
                          <div key={v.id} className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm hover:border-[#CBD5E1] transition-colors relative group">
                            {/* Accent line */}
                            <div className={`absolute top-0 left-0 w-1.5 h-full ${colorClass}`} />
                            
                            <div className="p-5 pl-7">
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                  <Badge className={`${colorClass} text-white font-bold text-[10px] px-2 py-0.5 border-none shadow-sm`}>
                                    Variação {String.fromCharCode(65 + i)}
                                  </Badge>
                                  <input 
                                    value={v.name} 
                                    onChange={e => setVariations(variations.map(x => x.id === v.id ? { ...x, name: e.target.value } : x))}
                                    className="text-[14px] font-bold text-[#0F172A] bg-transparent outline-none border-none p-0 w-[180px]"
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
                                        className="w-12 h-7 bg-transparent text-center text-[12px] font-bold text-[#0F172A] outline-none border-none p-0"
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
                      
                      {/* Weight validation */}
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
                <div className="space-y-5">
                  <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-2xl p-5 shadow-sm">
                    <h4 className="text-[13px] font-bold text-[#0F172A] mb-4">Prévia do Funil</h4>
                    {variations.length === 0 ? (
                      <div className="text-[12px] text-[#64748B] italic">Sem variações para distribuir.</div>
                    ) : (
                      <div className="space-y-3">
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

                  <div className="bg-[#FEF9F0] border border-[#FDEBCE] rounded-2xl p-5 shadow-sm text-[12px] leading-relaxed text-[#935D0B]">
                    <h4 className="font-bold flex items-center gap-1.5 mb-2"><Sparkles className="w-4 h-4" /> Como funciona</h4>
                    <p>O robô irá alternar as mensagens selecionadas acima de acordo com o peso de distribuição definido. Analise a aba Performance para decidir a vencedora após ~100 envios.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
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
