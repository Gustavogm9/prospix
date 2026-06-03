'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FunnelChart, BarChart, toast } from '@prospix/ui';
import { Calendar, MessageSquare, Phone, Search, Info, ChevronLeft, ChevronRight, Star, MapPin } from 'lucide-react';
import { dashboardQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { useRouter } from 'next/navigation';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';

interface HotLead {
  id: string;
  name: string;
  profession: string | null;
  city: string;
  fitScore: number;
  status: string;
  googleRating: number | null;
  googleReviewsCount: number | null;
  registrationNumber: string | null;
  createdAt: string;
}

interface DashboardStats {
  todayMeetings: number;
  pendingConversations: number;
  pendingManualConversations: number;
  needsAttention: number;
  newLeadsToday: number;
  nextMeetingTime: string | null;
  funnelData: Array<{ stage: string; value: number; color: string }>;
  weeklyPerformance: Array<{ label: string; sublabel?: string; value: number }>;
  weeklyPeriodLabel: string;
  hotLeads: HotLead[];
}

const AVATAR_COLORS = ['#1B3A6B','#5A2A82','#B8740E','#075E54','#9E2A2B','#1F4E5F','#374151'];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  CAPTURED: { label: 'Capturado', cls: 'bg-[rgba(27,58,107,0.08)] text-[#1B3A6B]' },
  ENRICHED: { label: 'Enriquecido', cls: 'bg-[rgba(27,58,107,0.08)] text-[#1B3A6B]' },
  CONTACTED: { label: 'Contatado', cls: 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' },
  CONVERSING: { label: 'Conversando', cls: 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' },
  QUALIFIED: { label: 'Qualificado', cls: 'bg-[#ECFDF3] text-[#027A48]' },
  MEETING_SCHEDULED: { label: '✓ Agendada', cls: 'bg-[#ECFDF3] text-[#027A48]' },
  CLOSED_WON: { label: '🏆 Fechado', cls: 'bg-[#ECFDF3] text-[#027A48]' },
  NO_RESPONSE: { label: 'Sem resposta', cls: 'bg-[#F1F3F6] text-[#64748B]' },
};

const PROFESSION_LABELS: Record<string, string> = {
  DENTIST: 'Dentista',
  DOCTOR: 'Médico(a)',
  LAWYER: 'Advogado(a)',
  ACCOUNTANT: 'Contador(a)',
  PHYSIOTHERAPIST: 'Fisioterapeuta',
  PSYCHOLOGIST: 'Psicólogo(a)',
  VETERINARIAN: 'Veterinário(a)',
  ARCHITECT: 'Arquiteto(a)',
  ENGINEER: 'Engenheiro(a)',
  NUTRITIONIST: 'Nutricionista',
  PHARMACIST: 'Farmacêutico(a)',
  REALTOR: 'Corretor(a) de Imóveis',
  BUSINESS_OWNER: 'Empresário(a)',
  OTHER: 'Outro',
};

export default function HomePage() {
  const router = useRouter();
  const tenantId = useAuthStore(state => state.tenantId);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [isLoadingWeekly, setIsLoadingWeekly] = useState(false);

  const onboardingSignals = useMemo(() => {
    if (!stats) return undefined;
    const hasConversations = (stats.pendingConversations || 0) + (stats.pendingManualConversations || 0) > 0;
    const hasLeads = (stats.newLeadsToday || 0) > 0 || (stats.hotLeads?.length || 0) > 0;
    return {
      whatsapp: hasConversations,
      firstLead: hasLeads,
    };
  }, [stats]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    const fetchDashboardData = async () => {
      const emptyStats: DashboardStats = {
        todayMeetings: 0, pendingConversations: 0, pendingManualConversations: 0,
        needsAttention: 0, newLeadsToday: 0, nextMeetingTime: null,
        funnelData: [], weeklyPerformance: [], weeklyPeriodLabel: '', hotLeads: [],
      };

      try {
        const [todayRes, funnelRes, weeklyRes, hotLeadsRes] = await Promise.allSettled([
          dashboardQueries.today(tenantId),
          dashboardQueries.funnel(tenantId),
          dashboardQueries.weeklyCaptures(tenantId),
          dashboardQueries.hotLeads(tenantId),
        ]);

        if (cancelled) return;

        const todayData = todayRes.status === 'fulfilled' && !todayRes.value.error ? todayRes.value.data : null;
        const funnelRaw = funnelRes.status === 'fulfilled' && !funnelRes.value.error ? funnelRes.value.data : null;
        const weeklyRaw = weeklyRes.status === 'fulfilled' && !weeklyRes.value.error ? weeklyRes.value.data : [];
        const hotLeadsRaw = hotLeadsRes.status === 'fulfilled' && !hotLeadsRes.value.error ? hotLeadsRes.value.data : [];

        const capturedTotal = (funnelRaw?.stages?.CAPTURED || 0) + (funnelRaw?.stages?.ENRICHED || 0) + (funnelRaw?.stages?.NEW || 0);
        const contactedTotal = (funnelRaw?.stages?.CONTACTED || 0) + (funnelRaw?.stages?.CONVERSING || 0) + (funnelRaw?.stages?.NO_RESPONSE || 0);
        const qualifiedTotal = (funnelRaw?.stages?.QUALIFIED || 0) + (funnelRaw?.stages?.MEETING_SCHEDULED || 0);
        const closedTotal = funnelRaw?.stages?.CLOSED_WON || 0;

        const funnelData: DashboardStats['funnelData'] = funnelRaw?.stages ? [
          { stage: 'Capturados', value: capturedTotal, color: '#1B3A6B' },
          { stage: 'Contatados', value: contactedTotal, color: '#3b82f6' },
          { stage: 'Qualificados', value: qualifiedTotal, color: '#E8981C' },
          { stage: 'Fechados', value: closedTotal, color: '#039855' },
        ] : [];

        const weeklyResult = weeklyRes.status === 'fulfilled' && !weeklyRes.value.error ? weeklyRes.value : null;
        const weeklyPerformance: DashboardStats['weeklyPerformance'] = Array.isArray(weeklyRaw) 
          ? weeklyRaw.map((d: any) => ({ label: d.label as string, sublabel: d.sublabel as string | undefined, value: d.value as number }))
          : [];
        const weeklyPeriodLabel = (weeklyResult as any)?.periodLabel || '';

        const hotLeads: DashboardStats['hotLeads'] = (Array.isArray(hotLeadsRaw) ? hotLeadsRaw : [])
          .slice(0, 5)
          .map((l: any) => ({
            id: l.id,
            name: l.name || 'Lead',
            profession: l.profession || null,
            city: l.city || '',
            fitScore: l.fitScore ?? 0,
            status: l.status || 'CAPTURED',
            googleRating: l.googleRating || null,
            googleReviewsCount: l.googleReviewsCount || null,
            registrationNumber: l.registrationNumber || null,
            createdAt: l.createdAt || '',
          }));

        setStats({
          todayMeetings: todayData?.meetings_today ?? 0,
          pendingConversations: todayData?.conversations_ready ?? 0,
          pendingManualConversations: todayData?.pending_manual_conversations ?? 0,
          needsAttention: todayData?.need_callback ?? 0,
          newLeadsToday: todayData?.new_leads_today ?? 0,
          nextMeetingTime: todayData?.next_meeting_time ?? null,
          funnelData,
          weeklyPerformance,
          weeklyPeriodLabel,
          hotLeads,
        });
      } catch (err) {
        if (cancelled) return;
        console.error('Error fetching dashboard stats', err);
        setStats(emptyStats);
        toast.error('Erro de Conexão', 'Não foi possível carregar o dashboard.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchDashboardData();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Fetch weekly data with offset
  const fetchWeeklyData = useCallback(async (offset: number) => {
    if (!tenantId) return;
    setIsLoadingWeekly(true);
    try {
      const res = await dashboardQueries.weeklyCaptures(tenantId, offset);
      if (!res.error && res.data) {
        setStats((prev) => prev ? {
          ...prev,
          weeklyPerformance: res.data.map((d: any) => ({ label: d.label, sublabel: d.sublabel, value: d.value })),
          weeklyPeriodLabel: (res as any).periodLabel || '',
        } : prev);
      }
    } catch (err) {
      console.error('Error fetching weekly data', err);
    } finally {
      setIsLoadingWeekly(false);
    }
  }, [tenantId]);

  const handleWeekChange = useCallback((direction: 'prev' | 'next') => {
    const newOffset = direction === 'prev' ? weekOffset + 1 : Math.max(0, weekOffset - 1);
    if (direction === 'next' && weekOffset === 0) return;
    setWeekOffset(newOffset);
    fetchWeeklyData(newOffset);
  }, [weekOffset, fetchWeeklyData]);

  if (isLoading || !stats) {
    return (
      <div className="space-y-5">
        <div className="h-20 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-36 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />)}
        </div>
        <div className="h-40 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />
      </div>
    );
  }

  const actionCount = [
    stats.todayMeetings > 0, stats.pendingConversations > 0,
    stats.needsAttention > 0, stats.newLeadsToday > 0,
  ].filter(Boolean).length || 4;

  const totalCaptured = stats.funnelData?.[0]?.value || 0;

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* ═══ Greeting Banner ═══ */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div>
          <h1 className="text-[21px] font-bold text-[#0F172A] tracking-tight mb-1">
            Hoje você só precisa de você em {actionCount} coisas. 👆
          </h1>
          <p className="text-[13px] text-[#475569] leading-relaxed">
            Sua máquina está rodando. A IA já{' '}
            <strong className="text-[#0F172A]">capturou {stats.newLeadsToday} novos leads</strong>,{' '}
            mandou <strong className="text-[#0F172A]">{stats.pendingConversations + stats.pendingManualConversations} mensagens</strong> e{' '}
            conversa com <strong className="text-[#0F172A]">{stats.pendingConversations} pessoas agora</strong>.{' '}
            Aqui está o que precisa do seu tempo:
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Receita Projetada · 90d</span>
          <span className="text-[23px] font-bold text-[#A56B0A] font-mono leading-none">
            R$ {Math.round((stats.todayMeetings * 30 * 0.35 * 5500) / 1000)}k
          </span>
          <span className="text-[11px] text-[#64748B]">{stats.todayMeetings * 30} reuniões × 35% × R$5,5k</span>
        </div>
      </div>

      {/* Onboarding Checklist */}
      <OnboardingChecklist signals={onboardingSignals} />

      {/* ═══ Action Cards (4 cards) ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Reuniões hoje */}
        <div
          className="bg-white border border-[#E5E7EB] rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-[3px] hover:shadow-md hover:border-[#1B3A6B] shadow-sm"
          onClick={() => router.push('/agenda')}
        >
          <div className="w-10 h-10 rounded-lg bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center justify-center mb-3">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="text-[28px] font-bold text-[#0F172A] font-mono leading-none">{stats.todayMeetings}</div>
          <div className="text-[13.5px] font-semibold text-[#0F172A] mt-1.5">Reuniões hoje</div>
          <div className="text-[12px] text-[#475569] mt-1 leading-relaxed">
            {stats.nextMeetingTime ? `Próxima às ${stats.nextMeetingTime}` : 'Nenhuma agendada'}
          </div>
          <div className="text-[12px] font-semibold text-[#1B3A6B] mt-3 flex items-center gap-1 group-hover:gap-2 transition-all">
            Ver agenda →
          </div>
        </div>

        {/* Conversas prontas - GREEN */}
        <div
          className="bg-white border-2 border-[#039855] rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-[3px] hover:shadow-md shadow-sm bg-gradient-to-b from-[#ECFDF3] to-white"
          onClick={() => router.push('/conversas')}
        >
          <div className="w-10 h-10 rounded-lg bg-[#ECFDF3] text-[#039855] flex items-center justify-center mb-3">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="text-[28px] font-bold text-[#0F172A] font-mono leading-none">{stats.pendingConversations}</div>
          <div className="text-[13.5px] font-semibold text-[#0F172A] mt-1.5">Conversas prontas pra fechar</div>
          <div className="text-[12px] text-[#475569] mt-1 leading-relaxed">Leads que aceitaram a abordagem e aguardam você.</div>
          <div className="text-[12px] font-semibold text-[#1B3A6B] mt-3 flex items-center gap-1">Ver conversas →</div>
        </div>

        {/* Pediu ligação - RED urgent */}
        <div
          className="bg-white border border-[rgba(217,45,32,0.35)] rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-[3px] hover:shadow-md shadow-sm bg-gradient-to-b from-[#FEF3F2] to-white"
          onClick={() => router.push('/conversas')}
        >
          <div className="w-10 h-10 rounded-lg bg-[#FEF3F2] text-[#D92D20] flex items-center justify-center mb-3">
            <Phone className="w-5 h-5" />
          </div>
          <div className="text-[28px] font-bold text-[#0F172A] font-mono leading-none">{stats.needsAttention}</div>
          <div className="text-[13.5px] font-semibold text-[#0F172A] mt-1.5">Pediu ligação direta</div>
          <div className="text-[12px] text-[#475569] mt-1 leading-relaxed">Leads que querem falar com você hoje.</div>
          <div className="text-[12px] font-semibold text-[#1B3A6B] mt-3 flex items-center gap-1">Ver detalhes →</div>
        </div>

        {/* Novos leads */}
        <div
          className="bg-white border border-[#E5E7EB] rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-[3px] hover:shadow-md hover:border-[#1B3A6B] shadow-sm"
          onClick={() => router.push('/leads')}
        >
          <div className="w-10 h-10 rounded-lg bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center justify-center mb-3">
            <Search className="w-5 h-5" />
          </div>
          <div className="text-[28px] font-bold text-[#0F172A] font-mono leading-none">+{stats.newLeadsToday}</div>
          <div className="text-[13.5px] font-semibold text-[#0F172A] mt-1.5">Novos leads capturados</div>
          <div className="text-[12px] text-[#475569] mt-1 leading-relaxed">Profissionais que a IA encontrou hoje.</div>
          <div className="text-[12px] font-semibold text-[#1B3A6B] mt-3 flex items-center gap-1">Ver leads →</div>
        </div>
      </div>

      {/* ═══ Pipeline Visualization ═══ */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-[#0F172A] flex items-center gap-2">
              Como sua máquina trabalha
              <span className="w-4 h-4 rounded-full bg-[#F1F3F6] text-[#64748B] flex items-center justify-center text-[10px] font-bold cursor-help">?</span>
            </div>
            <div className="text-[11px] text-[#64748B] mt-0.5">
              Atualizado há 14s · {totalCaptured} contatos viraram {stats.todayMeetings} reuniões neste mês
            </div>
          </div>
          <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(232,152,28,0.14)] text-[#A56B0A] flex items-center gap-1.5">
            <span className="w-[5px] h-[5px] rounded-full bg-[#E8981C] animate-pulse" />
            Rodando agora
          </span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { num: '✓', name: 'Captura', desc: 'Busca no Google Maps', count: totalCaptured, style: 'done' },
              { num: '✓', name: 'Qualificação', desc: 'Valida WhatsApp e perfil', count: stats.funnelData?.[1]?.value || 0, style: 'done' },
              { num: '●', name: 'Conversa IA', desc: 'WhatsApp com sua linguagem', count: stats.pendingConversations, style: 'active' },
              { num: '4', name: 'Reunião marcada', desc: 'Cai na sua agenda', count: stats.todayMeetings, style: 'pending' },
            ].map((stage, i) => (
              <div key={i} className="relative bg-[#F1F3F6] border border-[#EEF0F3] rounded-lg p-3 text-center cursor-pointer transition-all hover:border-[#1B3A6B] hover:-translate-y-0.5">
                <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border-2 border-white text-white ${
                  stage.style === 'done' ? 'bg-[#039855]' : stage.style === 'active' ? 'bg-[#E8981C]' : 'bg-[#1B3A6B]'
                }`}>{stage.num}</div>
                <div className="text-[12.5px] font-semibold text-[#0F172A] mt-1">{stage.name}</div>
                <div className="text-[11px] text-[#475569] mt-0.5">{stage.desc}</div>
                <div className={`text-[17px] font-bold font-mono mt-1.5 ${
                  stage.style === 'done' ? 'text-[#039855]' : stage.style === 'active' ? 'text-[#A56B0A]' : 'text-[#1B3A6B]'
                }`}>{stage.count.toLocaleString('pt-BR')}</div>
              </div>
            ))}
          </div>
          <div className="mt-3.5 px-3.5 py-2.5 bg-[rgba(27,58,107,0.04)] rounded-lg text-[12px] text-[#475569] flex items-center gap-2">
            <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
            <div><strong className="text-[#0F172A]">Antes:</strong> você ligava 100 para falar com 10. <strong className="text-[#0F172A]">Agora:</strong> a IA fala com {totalCaptured} e te entrega {stats.todayMeetings} prontas.</div>
          </div>
        </div>
      </div>

      {/* ═══ Hot Leads + Funnel (two-column) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* Hot Leads panel */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[#0F172A]">Leads mais promissores</div>
              <div className="text-[11px] text-[#64748B] mt-0.5">Top {stats.hotLeads.length} por fit score · clique para ver detalhes</div>
            </div>
            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center gap-1.5">
              🎯 {stats.hotLeads.length} leads
            </span>
          </div>

          {stats.hotLeads.length > 0 ? (
            stats.hotLeads.map((lead, i) => {
              const statusInfo = STATUS_LABELS[lead.status] || STATUS_LABELS.CAPTURED;
              const profLabel = lead.profession ? PROFESSION_LABELS[lead.profession] || lead.profession : null;
              return (
                <div
                  key={lead.id}
                  className="px-5 py-3 border-b border-[#EEF0F3] flex items-center gap-3 cursor-pointer transition-all hover:bg-[rgba(27,58,107,0.04)] border-l-[3px] border-l-transparent hover:border-l-[#1B3A6B]"
                  onClick={() => router.push('/leads')}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                    style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                  >{getInitials(lead.name)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#0F172A] flex items-center gap-2 flex-wrap">
                      {lead.name}
                      <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${statusInfo?.cls ?? ''}`}>{statusInfo?.label ?? lead.status}</span>
                    </div>
                    <div className="text-[11.5px] text-[#475569] flex items-center gap-2 flex-wrap">
                      {profLabel && <span>{profLabel}</span>}
                      {profLabel && lead.city && <span className="text-[#CBD5E1]">·</span>}
                      {lead.city && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />
                          {lead.city}
                        </span>
                      )}
                      {lead.googleRating && (
                        <>
                          <span className="text-[#CBD5E1]">·</span>
                          <span className="flex items-center gap-0.5 text-[#E8981C]">
                            <Star className="w-3 h-3 fill-[#E8981C]" />
                            {lead.googleRating}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 min-w-[60px]">
                    <div className={`text-[13px] font-bold font-mono ${
                      lead.fitScore >= 7 ? 'text-[#039855]' : lead.fitScore >= 5 ? 'text-[#A56B0A]' : 'text-[#64748B]'
                    }`}>Fit {lead.fitScore}</div>
                    <div className="text-[10px] text-[#64748B] mt-0.5">
                      {new Date(lead.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                    </div>
                  </div>
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#F1F3F6] text-[#64748B] shrink-0 hover:bg-[#1B3A6B] hover:text-white transition-all">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-8 text-center text-[12.5px] text-[#64748B]">
              Nenhum lead encontrado. Crie uma campanha para começar a capturar.
            </div>
          )}

          <div className="px-5 py-3 text-center bg-[#F1F3F6] border-t border-[#EEF0F3]">
            <button onClick={() => router.push('/leads')} className="text-[12.5px] font-semibold text-[#1B3A6B]">
              Ver todos os {totalCaptured} leads →
            </button>
          </div>
        </div>

        {/* Funnel panel */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
            <div className="text-[14px] font-semibold text-[#0F172A]">Funil do mês</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">
              A cada {totalCaptured && stats.todayMeetings ? Math.round(totalCaptured / Math.max(stats.todayMeetings, 1)) : '—'} contatos → 1 reunião
            </div>
          </div>
          <div className="p-5 flex items-center justify-center min-h-[240px]">
            <div className="w-full max-w-[300px]">
              <FunnelChart
                stages={stats.funnelData.map((item, _idx, arr) => ({
                  label: item.stage,
                  count: item.value,
                  percentage: arr[0]?.value ? Math.round((item.value / arr[0].value) * 100) : 0
                }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Weekly Performance ═══ */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-[#0F172A]">Novas Leads na Semana</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">Distribuição diária de captação pelo Google Maps.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleWeekChange('prev')}
              className="w-7 h-7 rounded-lg bg-[#F1F3F6] text-[#64748B] flex items-center justify-center hover:bg-[#1B3A6B] hover:text-white transition-all"
              title="Semana anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-semibold text-[#475569] font-mono min-w-[100px] text-center">
              {stats.weeklyPeriodLabel || ''}
            </span>
            <button
              onClick={() => handleWeekChange('next')}
              disabled={weekOffset === 0}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                weekOffset === 0
                  ? 'bg-[#F1F3F6] text-[#CBD5E1] cursor-not-allowed'
                  : 'bg-[#F1F3F6] text-[#64748B] hover:bg-[#1B3A6B] hover:text-white'
              }`}
              title="Próxima semana"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className={`py-6 flex items-end justify-center min-h-[200px] transition-opacity duration-200 ${isLoadingWeekly ? 'opacity-40' : ''}`}>
          <div className="w-full max-w-[500px] px-5">
            <BarChart items={stats.weeklyPerformance} />
          </div>
        </div>
      </div>
    </div>
  );
}
