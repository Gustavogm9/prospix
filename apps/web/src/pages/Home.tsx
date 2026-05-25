import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, FunnelChart, BarChart, Badge, Button, Tooltip, toast } from '@prospix/ui';
import { Calendar, MessageSquare, AlertCircle, UserPlus, ArrowUpRight, Flame, Info } from 'lucide-react';

const FIT_SCORE_EXPLAINER = (
  <div className="text-left space-y-1">
    <div className="font-semibold">Como calculamos o Fit Score (0–10)</div>
    <ul className="list-disc pl-4 space-y-0.5">
      <li>Aderência ao ICP (segmento + porte)</li>
      <li>Sinais comerciais (Maps reviews, faturamento estimado)</li>
      <li>Engajamento na conversa (respostas, tempo, intent)</li>
      <li>Recência da captura</li>
    </ul>
    <div className="opacity-80">≥ 8.5 = lead quente · ≥ 7.0 = morno</div>
  </div>
);
import { apiClient } from '../lib/api-client';
import { canUseMockFallbacks } from '../lib/demo-mode';
import { useNavigate } from 'react-router-dom';

interface DashboardStats {
  todayMeetings: number;
  pendingConversations: number;
  pendingManualConversations: number;
  needsAttention: number;
  newLeadsToday: number;
  nextMeetingTime: string | null;
  funnelData: Array<{ stage: string; value: number; color: string }>;
  weeklyPerformance: Array<{ label: string; value: number }>;
  hotLeads: Array<{
    id: string;
    name: string;
    city: string;
    fitScore: number;
    phone: string;
    status: string;
  }>;
}

export default function Home() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      const fallbackStats: DashboardStats = {
        todayMeetings: 3,
        pendingConversations: 8,
        pendingManualConversations: 4,
        needsAttention: 5,
        newLeadsToday: 14,
        nextMeetingTime: '14:30',
        funnelData: [
          { stage: 'Capturado', value: 120, color: '#1B3A6B' },
          { stage: 'Contatado', value: 85, color: '#3b82f6' },
          { stage: 'Qualificado', value: 50, color: '#6366f1' },
          { stage: 'Agendado', value: 28, color: '#06b6d4' },
          { stage: 'Negociação', value: 12, color: '#10b981' },
          { stage: 'Fechado', value: 6, color: '#10b981' },
        ],
        weeklyPerformance: [
          { label: 'Seg', value: 4 },
          { label: 'Ter', value: 12 },
          { label: 'Qua', value: 8 },
          { label: 'Qui', value: 14 },
          { label: 'Sex', value: 10 },
        ],
        hotLeads: [
          { id: '1', name: 'Marcos de Oliveira', city: 'São Paulo - SP', fitScore: 9.4, phone: '+55 11 98888-7777', status: 'Qualificado' },
          { id: '2', name: 'Ana Beatriz Reis', city: 'Rio de Janeiro - RJ', fitScore: 8.8, phone: '+55 21 97777-6666', status: 'Contatado' },
          { id: '3', name: 'Indústrias Metalúrgicas Alfa', city: 'Campinas - SP', fitScore: 8.5, phone: '+55 19 96666-5555', status: 'Capturado' },
        ],
      };
      const emptyStats: DashboardStats = {
        todayMeetings: 0,
        pendingConversations: 0,
        pendingManualConversations: 0,
        needsAttention: 0,
        newLeadsToday: 0,
        nextMeetingTime: null,
        funnelData: [],
        weeklyPerformance: [],
        hotLeads: [],
      };
      const defaultStats = canUseMockFallbacks ? fallbackStats : emptyStats;

      try {
        const response = await apiClient.get('/tenant/dashboard/today');
        
        if (response?.data) {
          const data = response.data.data ?? response.data;
          setStats({
            ...defaultStats,
            todayMeetings: data.meetings_today ?? defaultStats.todayMeetings,
            pendingConversations: data.conversations_ready ?? defaultStats.pendingConversations,
            pendingManualConversations: data.pending_manual_conversations ?? data.manual_conversations ?? defaultStats.pendingManualConversations,
            needsAttention: data.need_callback ?? defaultStats.needsAttention,
            newLeadsToday: data.new_leads_today ?? defaultStats.newLeadsToday,
            nextMeetingTime: data.next_meeting_time ?? defaultStats.nextMeetingTime,
            funnelData: data.funnel_data ?? defaultStats.funnelData,
            weeklyPerformance: data.weekly_performance ?? defaultStats.weeklyPerformance,
            hotLeads: data.hot_leads ?? defaultStats.hotLeads,
          });
        } else {
          setStats(defaultStats);
        }
      } catch (err) {
        console.error('Error fetching dashboard stats', err);
        setStats(defaultStats);
        if (!canUseMockFallbacks) {
          toast.error('Erro de Conexão', 'Não foi possível carregar o dashboard real da API.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (isLoading || !stats) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-[250px] bg-surface-sunken animate-pulse rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-white animate-pulse rounded-2xl border border-border shadow-sm" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-96 bg-white animate-pulse rounded-2xl border border-border shadow-sm lg:col-span-2" />
          <div className="h-96 bg-white animate-pulse rounded-2xl border border-border shadow-sm" />
        </div>
      </div>
    );
  }

  const nextMeetingText = stats.nextMeetingTime
    ? `Próxima reunião às ${stats.nextMeetingTime}`
    : stats.todayMeetings > 0
      ? 'Agenda carregada sem próximo horário disponível'
      : 'Nenhuma reunião agendada para hoje';
  const pendingManualSuffix = stats.pendingManualConversations === 1
    ? 'chat aguarda sua resposta manual'
    : 'chats aguardam sua resposta manual';

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Welcome banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Painel Operacional</h2>
          <p className="text-text-secondary text-sm mt-1">Visão integrada das suas prospecções e metas do dia de hoje.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => navigate('/funil')}
            className="bg-primary hover:bg-primary-hover text-white font-medium px-4 py-2 rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-primary/10"
          >
            <span>Ver Pipeline</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* KPI Dashboard Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="bg-white border-border hover:border-border-strong hover:shadow-md transition-all shadow-sm">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">Reuniões Hoje</span>
                <span className="text-3xl font-bold font-heading tracking-tight text-text font-mono">{stats.todayMeetings}</span>
              </div>
              <div className="p-3 bg-primary-soft border border-primary/10 text-primary rounded-xl">
                <Calendar className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-text-secondary font-medium mt-4 flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${stats.nextMeetingTime ? 'bg-success animate-pulse' : 'bg-border'}`} />
              {nextMeetingText}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-border hover:border-border-strong hover:shadow-md transition-all shadow-sm">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">Chats Pendentes</span>
                <span className="text-3xl font-bold font-heading tracking-tight text-text font-mono">{stats.pendingConversations}</span>
              </div>
              <div className="p-3 bg-purple-50 border border-purple-100 text-purple-600 rounded-xl">
                <MessageSquare className="w-5 h-5" />
              </div>
            </div>
            {stats.pendingManualConversations > 0 ? (
              <p className="text-[10px] text-text-secondary font-medium mt-4">
                <span className="text-purple-600 font-semibold font-mono">{stats.pendingManualConversations}</span>{' '}
                {pendingManualSuffix}
              </p>
            ) : (
              <p className="text-[10px] text-text-secondary font-medium mt-4">
                Nenhum chat aguardando resposta manual
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white border-border hover:border-border-strong hover:shadow-md transition-all shadow-sm">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">Atenção Necessária</span>
                <span className="text-3xl font-bold font-heading tracking-tight text-text font-mono">{stats.needsAttention}</span>
              </div>
              <div className="p-3 bg-error-soft border border-error/10 text-error-text rounded-xl">
                <AlertCircle className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-error-text font-medium mt-4">
              Leads parados há mais de 48h sem interação
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white border-border hover:border-border-strong hover:shadow-md transition-all shadow-sm">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">Novos Leads Hoje</span>
                <span className="text-3xl font-bold font-heading tracking-tight text-text font-mono">{stats.newLeadsToday}</span>
              </div>
              <div className="p-3 bg-success-soft border border-success/10 text-success-text rounded-xl">
                <UserPlus className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[10px] text-text-secondary font-medium mt-4">
              Enriquecimento e Fit Score processados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts & Table Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funnel Graph Box */}
        <Card className="lg:col-span-2 bg-white border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold font-heading text-text">Funil de Vendas de Seguros</CardTitle>
            <CardDescription className="text-text-secondary text-xs">Conversão volumétrica agregada das leads ativas por estágio.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-6 min-h-[300px]">
            <div className="w-full max-w-[560px]">
              <FunnelChart 
                stages={stats.funnelData.map((item, _idx, arr) => ({
                  label: item.stage,
                  count: item.value,
                  percentage: arr[0]?.value ? Math.round((item.value / arr[0].value) * 100) : 100
                }))} 
              />
            </div>
          </CardContent>
        </Card>

        {/* Weekly Performance Bar Chart */}
        <Card className="bg-white border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold font-heading text-text">Novas Leads na Semana</CardTitle>
            <CardDescription className="text-text-secondary text-xs">Distribuição diária de captação pelo Google Maps.</CardDescription>
          </CardHeader>
          <CardContent className="py-6 flex items-end justify-center min-h-[300px]">
            <div className="w-full max-w-[280px]">
              <BarChart items={stats.weeklyPerformance} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hot Leads (Fit Score >= 8.0) */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500 fill-orange-500" />
              <span>Leads Quentes do Dia (Fit Score &ge; 8.0)</span>
            </CardTitle>
            <CardDescription className="text-text-secondary text-xs">Leads qualificadas de alto valor prontas para fechamento.</CardDescription>
          </div>
          <Button 
            onClick={() => navigate('/leads')}
            variant="outline" 
            className="border-border text-text-secondary hover:text-text text-xs font-semibold px-3 py-1.5 h-8 hover:bg-surface-sunken"
          >
            Ver Todas
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] text-text-secondary font-semibold uppercase tracking-wider">
                  <th className="text-left py-3 px-6">Lead</th>
                  <th className="text-left py-3 px-6">Localidade</th>
                  <th className="text-left py-3 px-6">Contato</th>
                  <th className="text-left py-3 px-6">Estágio</th>
                  <th className="text-center py-3 px-6">
                    <Tooltip content={FIT_SCORE_EXPLAINER}>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        Fit Score
                        <Info className="w-3 h-3 opacity-70" aria-label="Como calculamos" />
                      </span>
                    </Tooltip>
                  </th>
                  <th className="text-right py-3 px-6">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stats.hotLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-surface-sunken transition-all group">
                    <td className="py-3.5 px-6 font-medium text-text">{lead.name}</td>
                    <td className="py-3.5 px-6 text-text-secondary text-xs">{lead.city}</td>
                    <td className="py-3.5 px-6 text-text-secondary text-xs font-mono">{lead.phone}</td>
                    <td className="py-3.5 px-6">
                      <Badge className="bg-surface-sunken border-border text-text-secondary text-[10px]">
                        {lead.status}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <span className="text-success-text font-mono font-bold text-xs bg-success-soft px-2.5 py-1 border border-success/20 rounded-full">
                        {lead.fitScore}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <Button
                        onClick={() => navigate('/conversas')}
                        className="bg-surface-sunken hover:bg-border text-text border border-border/80 text-[10px] px-2.5 py-1 h-7 rounded-lg font-semibold flex items-center gap-1.5 ml-auto"
                      >
                        <MessageSquare className="w-3 h-3 text-primary" />
                        <span>Abrir Chat</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
