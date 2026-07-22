'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { FunnelChart, BarChart, toast, Button, Input } from '@prospix/ui';
import { Calendar, MessageSquare, Phone, Search, Info, ChevronLeft, ChevronRight, Star, MapPin, X, Clock, Bot, User, Award, Send } from 'lucide-react';
import { dashboardQueries, conversationsQueries, meetingsQueries, leadsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { useRouter } from 'next/navigation';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { useOperationalStatusContext } from '@/hooks/useOperationalStatus';

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

interface Message {
  id: string;
  sender: 'lead' | 'ai' | 'agent';
  content: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  leadId: string;
  leadName: string;
  aiHandling: boolean;
  unread: boolean;
  fitScore: number;
  lastMessage: string;
  timestamp: string;
  meetingId?: string;
  initials?: string;
  avatarColor?: string;
  profession?: string;
  tagType?: 'success' | 'live' | 'warning' | 'info';
  tagLabel?: string;
  whenLabel?: string;
  whenUrgent?: boolean;
  details: {
    phone: string;
    city: string;
    googleRating: number | null;
    googleReviewsCount: number | null;
    susep: string;
    company: string;
    health: string;
    priority: 'high' | 'medium' | 'low';
    tags: string[];
    logs: Array<{ action: string; time: string }>;
    healthProfile: {
      smoker: boolean | null;
      physicalActivity: string | null;
      weightKg: number | null;
      heightCm: number | null;
      bmiCalculated: number | null;
      preExistingDiseases: string | null;
      continuousMedication: string | null;
      weight_kg?: number | null;
      recentSurgery: boolean | null;
      familyHistory: any | null;
      riskCategory: string | null;
      estimatedPremiumMinCents: number | null;
      estimatedPremiumMaxCents: number | null;
      suggestedCoverage?: string;
    } | null;
    cnpjInfo?: {
      cnpj: string;
      razaoSocial: string;
      nomeFantasia?: string;
      situacaoCadastral: string;
      dataInicioAtividade?: string;
      cnaeFiscal?: string;
      uf?: string;
      municipio?: string;
      bairro?: string;
      qsa?: Array<{ nome: string; qual?: string }>;
    } | null;
  };
}

const AVATAR_COLORS = ['#1B3A6B','#5A2A82','#B8740E','#075E54','#9E2A2B','#1F4E5F','#374151'];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).filter(Boolean).join('').substring(0, 2).toUpperCase();
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

const getAvatarColor = (index: number): string => {
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? '#1B3A6B';
};

const mapBackendConversation = (conv: any, index?: number): Conversation => {
  const lead = conv.leads || conv.lead || {};
  const metadata = (lead.metadata || {}) as Record<string, any>;
  const name = lead.name || 'Sem nome';
  const idx = index ?? 0;

  const company = metadata.cnpj_info?.nomeFantasia
    || metadata.cnpj_info?.razaoSocial
    || (lead.source_raw_data as any)?.name
    || '';

  const professionLabel = lead.profession ? (PROFESSION_LABELS[lead.profession] || lead.profession) : '';

  const hpArr = lead.health_profiles;
  const hp = Array.isArray(hpArr) && hpArr.length > 0 ? hpArr[0] : null;

  return {
    id: conv.id,
    leadId: lead.id || conv.lead_id || '',
    leadName: name,
    aiHandling: conv.ai_handling,
    lastMessage: conv.last_message || 'Nenhuma mensagem recebida.',
    timestamp: conv.last_message_at 
      ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
      : new Date(conv.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    fitScore: Number(lead.fit_score) || 0,
    unread: conv.status === 'ACTIVE' && !conv.last_outbound_at,
    meetingId: undefined,
    initials: getInitials(name),
    avatarColor: getAvatarColor(idx),
    profession: professionLabel,
    tagType: conv.ai_handling ? 'live' : undefined,
    tagLabel: conv.ai_handling ? 'IA respondendo' : undefined,
    whenLabel: conv.last_message_at 
      ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
      : new Date(conv.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    details: {
      phone: lead.whatsapp || '',
      city: (lead.address as any)?.city || '',
      googleRating: lead.google_rating ? Number(lead.google_rating) : null,
      googleReviewsCount: lead.google_reviews_count ?? null,
      susep: lead.registration_number || '',
      company,
      health: lead.first_response_at ? 'Ativo' : lead.contacted_at ? 'Aguardando' : 'Novo',
      priority: Number(lead.fit_score) >= 8.5 ? 'high' : Number(lead.fit_score) >= 6.0 ? 'medium' : 'low',
      tags: lead.tags || [],
      logs: [
        { action: 'Lead capturado', time: new Date(lead.created_at).toLocaleString('pt-BR') },
        { action: 'Campanha iniciada', time: new Date(conv.started_at).toLocaleString('pt-BR') }
      ],
      healthProfile: hp ? {
        smoker: hp.smoker,
        physicalActivity: hp.physical_activity,
        weightKg: hp.weight_kg,
        heightCm: hp.height_cm,
        bmiCalculated: hp.bmi_calculated ? Number(hp.bmi_calculated) : null,
        preExistingDiseases: hp.pre_existing_diseases,
        continuousMedication: hp.continuous_medication,
        recentSurgery: hp.recent_surgery,
        familyHistory: hp.family_history,
        riskCategory: hp.risk_category,
        estimatedPremiumMinCents: hp.estimated_premium_min_cents,
        estimatedPremiumMaxCents: hp.estimated_premium_max_cents,
        suggestedCoverage: 'R$ 800k vida + R$ 300k DIH',
      } : null,
      cnpjInfo: metadata.cnpj_info ? {
        cnpj: metadata.cnpj_info.cnpj || '',
        razaoSocial: metadata.cnpj_info.razaoSocial || metadata.cnpj_info.razao_social || '',
        nomeFantasia: metadata.cnpj_info.nomeFantasia || metadata.cnpj_info.nome_fantasia || undefined,
        situacaoCadastral: metadata.cnpj_info.situacaoCadastral || (metadata.cnpj_info.situacao_cadastral === 2 ? 'ATIVA' : metadata.cnpj_info.situacao_cadastral) || 'ATIVA',
        dataInicioAtividade: metadata.cnpj_info.dataInicioAtividade || metadata.cnpj_info.data_inicio_atividade || undefined,
        cnaeFiscal: metadata.cnpj_info.cnaeFiscal || metadata.cnpj_info.cnae_fiscal || undefined,
        uf: metadata.cnpj_info.uf || undefined,
        municipio: metadata.cnpj_info.municipio || undefined,
        bairro: metadata.cnpj_info.bairro || undefined,
        qsa: (metadata.cnpj_info.qsa || []).map((partner: any) => ({
          nome: partner.nome_socio || partner.nome || '',
          qual: partner.qualificacao_socio_descricao || partner.qual || '',
        })),
      } : null,
    }
  };
};

const mapBackendMessage = (msg: any): Message => {
  let sender: 'lead' | 'ai' | 'agent' = 'lead';
  if (msg.sender === 'AI') sender = 'ai';
  else if (msg.sender === 'USER') sender = 'agent';
  
  return {
    id: msg.id,
    sender,
    content: msg.content,
    timestamp: new Date(msg.created_at || msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  };
};

export default function HomePage() {
  const router = useRouter();
  const tenantId = useAuthStore(state => state.tenantId);
  const operationalStatus = useOperationalStatusContext();
  const operationalView = operationalStatus?.view;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [isLoadingWeekly, setIsLoadingWeekly] = useState(false);

  // Drawer state and handlers (matching conversas/page.tsx + custom notes)
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
  const [outcomeValue, setOutcomeValue] = useState('');
  const [outcomeCommission, setOutcomeCommission] = useState('');
  const [drawerTab, setDrawerTab] = useState<'chat' | 'info' | 'health' | 'history'>('chat');
  const [leadEvents, setLeadEvents] = useState<any[]>([]);
  const [isLoadingDrawer, setIsLoadingDrawer] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState('');
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  // Fetch Messages for selected conversation
  useEffect(() => {
    if (!selectedConv || !tenantId) return;

    const fetchMessages = async () => {
      try {
        const result = await conversationsQueries.getMessages(selectedConv.id, tenantId);
        if (result.error) throw new Error(result.error.message);
        setMessages((result.data || []).map(mapBackendMessage));
      } catch (error) {
        console.error('Error fetching messages:', error);
        toast.error('Erro de sincronização', 'Não foi possível carregar as novas mensagens.');
      }
    };

    fetchMessages();
  }, [selectedConv?.id, tenantId]);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch real lead events when history tab is opened
  useEffect(() => {
    if (!selectedConv || drawerTab !== 'history') return;
    if (!selectedConv.leadId || !tenantId) return;

    const fetchEvents = async () => {
      try {
        const result = await leadsQueries.getEvents(tenantId, selectedConv.leadId);
        if (result.error) throw new Error(result.error.message);
        setLeadEvents(result.data || []);
      } catch (err) {
        console.error('Error fetching lead events:', err);
        setLeadEvents([]);
      }
    };

    fetchEvents();
  }, [selectedConv?.leadId, drawerTab, tenantId]);

  // Fetch notes when Ficha is opened
  useEffect(() => {
    if (!selectedConv || !tenantId || drawerTab !== 'info') return;

    const fetchNotes = async () => {
      setIsLoadingNotes(true);
      try {
        const result = await leadsQueries.getNotes(tenantId, selectedConv.leadId);
        if (result.error) throw new Error(result.error.message);
        setNotes(result.data || []);
      } catch (err) {
        console.error('Error fetching lead notes:', err);
      } finally {
        setIsLoadingNotes(false);
      }
    };

    fetchNotes();
  }, [selectedConv?.leadId, tenantId, drawerTab]);

  const handleSaveNote = async () => {
    if (!newNote.trim() || !selectedConv || !tenantId) return;
    try {
      const result = await leadsQueries.addNote(tenantId, selectedConv.leadId, newNote.trim());
      if (result.error) throw new Error(result.error.message);
      setNotes(prev => [result.data, ...prev]);
      setNewNote('');
      toast.success('Nota Salva!', 'Sua anotação foi inserida com sucesso.');
    } catch {
      toast.error('Erro ao salvar', 'Não foi possível salvar a anotação.');
    }
  };

  const handleTakeover = async () => {
    if (!selectedConv || !tenantId) return;
    
    const updated = { ...selectedConv, aiHandling: false };
    setSelectedConv(updated);

    try {
      const result = await conversationsQueries.update(tenantId, selectedConv.id, false);
      if (result.error) throw new Error(result.error.message);
      toast.success('Controle Manual Ativo', 'A IA foi desativada temporariamente. Você está no controle da conversa.');
    } catch {
      toast.error('Erro de Conexão', 'Não foi possível alterar o status do bot.');
      const rolled = { ...selectedConv, aiHandling: true };
      setSelectedConv(rolled);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConv || !tenantId) return;

    const userMsgContent = newMessage;
    setNewMessage('');

    const tempId = Date.now().toString();
    const newMsg: Message = {
      id: tempId,
      sender: 'agent',
      content: userMsgContent,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, newMsg]);

    try {
      const result = await conversationsQueries.sendMessage(tenantId, selectedConv.id, userMsgContent);
      if (result.error) throw new Error(result.error.message);
      setMessages(prev => prev.map(m => m.id === tempId ? mapBackendMessage(result.data) : m));
    } catch (err: any) {
      toast.error('Erro ao enviar', err.message || 'Não foi possível enviar a mensagem.');
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };

  const handleOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv) return;

    try {
      let meetingId = selectedConv.meetingId;
      if (!meetingId && tenantId) {
        const meetingsRes = await meetingsQueries.list(tenantId);
        const meetings = meetingsRes.data || [];
        meetingId = meetings.find((meeting: any) => meeting.lead_id === selectedConv.leadId)?.id;
      }

      if (!meetingId || !tenantId) {
        throw new Error('Meeting not found for selected conversation');
      }

      const result = await meetingsQueries.update(tenantId, meetingId, {
        outcome: 'CLOSED' as any,
        policy_value_cents: Math.floor((parseFloat(outcomeValue) || 0) * 100),
        commission_cents: Math.floor((parseFloat(outcomeCommission) || 0) * 100),
      });
      if (result.error) throw new Error(result.error.message);

      toast.success('Venda Registrada!', 'Parabéns pela apólice fechada! Faturamento cadastrado com sucesso.');
      setIsOutcomeModalOpen(false);
      setOutcomeValue('');
      setOutcomeCommission('');
    } catch {
      toast.error('Erro ao registrar', 'Tente novamente ou verifique se o lead possui reunião cadastrada.');
    }
  };

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

        const rawStages = funnelRaw?.stages || {};
        const totalLeads = Object.values(rawStages).reduce((a: number, b: any) => a + Number(b), 0);
        const whatsappValid = funnelRaw?.whatsapp_valid_count || 0;
        
        // Mensagem enviada: status is anything other than CAPTURED, ENRICHED, NEW, ARCHIVED
        const uncontacted = (rawStages.CAPTURED || 0) + (rawStages.ENRICHED || 0) + (rawStages.NEW || 0) + (rawStages.ARCHIVED || 0);
        const contactedTotal = Math.max(0, totalLeads - uncontacted);
        
        // Respondeu: Conversing, qualified, meeting_scheduled, closed_won, escalated_human, and not_interested
        const respondedTotal = (rawStages.CONVERSING || 0) + 
                             (rawStages.QUALIFIED || 0) + 
                             (rawStages.MEETING_SCHEDULED || 0) + 
                             (rawStages.CLOSED_WON || 0) + 
                             (rawStages.ESCALATED_HUMAN || 0) + 
                             (rawStages.NOT_INTERESTED || 0);

        // Conversa qualificada: qualified, meeting_scheduled, closed_won
        const qualifiedTotal = (rawStages.QUALIFIED || 0) + 
                             (rawStages.MEETING_SCHEDULED || 0) + 
                             (rawStages.CLOSED_WON || 0);
                             
        // Reunião agendada: meeting_scheduled, closed_won
        const scheduledTotal = (rawStages.MEETING_SCHEDULED || 0) + 
                             (rawStages.CLOSED_WON || 0);

        const funnelData: DashboardStats['funnelData'] = funnelRaw?.stages ? [
          { stage: 'Capturados', value: totalLeads, color: '#1B3A6B' },
          { stage: 'WhatsApp válido', value: whatsappValid, color: '#2C5282' },
          { stage: 'Mensagem enviada', value: contactedTotal, color: '#64748B' },
          { stage: 'Respondeu', value: respondedTotal, color: '#E8981C' },
          { stage: 'Conversa qualificada', value: qualifiedTotal, color: '#F59E0B' },
          { stage: 'Reunião agendada', value: scheduledTotal, color: '#039855' },
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
        {totalCaptured === 0 ? (
          <div>
            <h1 className="text-[21px] font-bold text-[#0F172A] tracking-tight mb-1">
              Bem-vindo ao Prospix! 🚀
            </h1>
            <p className="text-[13px] text-[#475569] leading-relaxed">
              Sua máquina de prospecção autônoma está pronta para rodar. Siga o <strong className="text-[#0F172A]">checklist de primeiros passos</strong> abaixo para configurar tudo e começar a capturar leads.
            </p>
          </div>
        ) : (
          <>
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
          </>
        )}
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

        {/* Sem resposta - ORANGE warning */}
        <div
          className="bg-white border border-[rgba(232,152,28,0.35)] rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-[3px] hover:shadow-md shadow-sm bg-gradient-to-b from-[rgba(232,152,28,0.06)] to-white"
          onClick={() => router.push('/conversas?filter=waiting')}
        >
          <div className="w-10 h-10 rounded-lg bg-[rgba(232,152,28,0.12)] text-[#B8740E] flex items-center justify-center mb-3">
            <Clock className="w-5 h-5" />
          </div>
          <div className="text-[28px] font-bold text-[#0F172A] font-mono leading-none">{stats.needsAttention}</div>
          <div className="text-[13.5px] font-semibold text-[#0F172A] mt-1.5">Sem resposta ainda</div>
          <div className="text-[12px] text-[#475569] mt-1 leading-relaxed">Leads contactados que ainda não responderam.</div>
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
              { num: '✓', name: 'Captura', desc: 'Google Maps, Scraping e Referrals', count: totalCaptured, style: 'done' },
              { num: '✓', name: 'Super Enriquecimento', desc: '10+ bases (CNPJ, Custo) e Fit Score', count: stats.funnelData?.[1]?.value || 0, style: 'done' },
              { num: '●', name: 'Conversão IA', desc: 'Contorna objeções no WhatsApp', count: stats.pendingConversations, style: 'active' },
              { num: '4', name: 'Loop de Indicações', desc: 'Agenda reunião e aciona motor 24h', count: stats.todayMeetings, style: 'pending' },
            ].map((stage, i) => (
              <div key={i} className="relative bg-[#F1F3F6] border border-[#EEF0F3] rounded-lg p-3 text-center cursor-pointer transition-all hover:border-[#1B3A6B] hover:-translate-y-0.5">
                <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border-2 border-white text-white ${
                  stage.style === 'done' ? 'bg-[#039855]' : stage.style === 'active' ? 'bg-[#E8981C]' : 'bg-[#1B3A6B]'
                }`}>{stage.num}</div>
                <div className="text-[12.5px] font-semibold text-[#0F172A] mt-1">{stage.name}</div>
                <div className="text-[11px] text-[#475569] mt-0.5 leading-tight">{stage.desc}</div>
                <div className={`text-[17px] font-bold font-mono mt-1.5 ${
                  stage.style === 'done' ? 'text-[#039855]' : stage.style === 'active' ? 'text-[#A56B0A]' : 'text-[#1B3A6B]'
                }`}>{stage.count.toLocaleString('pt-BR')}</div>
              </div>
            ))}
          </div>
          <div className="mt-3.5 px-3.5 py-2.5 bg-[rgba(27,58,107,0.04)] rounded-lg text-[12px] text-[#475569] flex items-center gap-2">
            <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
            <div className="leading-relaxed">A engrenagem perfeita: Pescamos de diversas fontes, <strong className="text-[#0F172A]">enriquecemos tudo</strong>, a IA aborda quem tem <strong className="text-[#0F172A]">Fit Score alto</strong>, e 24h após fechar a reunião, <strong className="text-[#0F172A]">roda o motor automático</strong> de indicações no Whatsapp.</div>
          </div>
        </div>
      </div>

      {/* ═══ Hot Leads panel (Full Width) ═══ */}
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
                onClick={async () => {
                  if (!tenantId) return;
                  setMessages([]);
                  setLeadEvents([]);
                  setNotes([]);
                  setIsLoadingDrawer(true);
                  try {
                    const res = await conversationsQueries.create(tenantId, lead.id);
                    if (res.error) throw new Error(res.error.message);
                    if (res.data) {
                      const mapped = mapBackendConversation(res.data, i);
                      setSelectedConv(mapped);
                      setDrawerTab('chat');
                    }
                  } catch (err: any) {
                    console.error('Error opening lead detail drawer:', err);
                    toast.error('Erro', 'Não foi possível abrir os detalhes do lead.');
                  } finally {
                    setIsLoadingDrawer(false);
                  }
                }}
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

      {/* ═══ Funil do Mês & Weekly Performance (split grid) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Funnel panel */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden flex flex-col justify-between">
          <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
            <div className="text-[14px] font-semibold text-[#0F172A]">Funil do mês</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">
              A cada {totalCaptured && stats.funnelData?.[5]?.value ? Math.round(totalCaptured / Math.max(stats.funnelData[5].value, 1)) : '—'} contatos → 1 reunião
            </div>
          </div>
          <div className="p-5 flex-1 flex items-center justify-center min-h-[220px]">
            <div className="w-full">
              <FunnelChart
                stages={stats.funnelData.map((item, _idx, arr) => ({
                  label: item.stage,
                  count: item.value,
                  percentage: arr[0]?.value ? Math.round((item.value / arr[0].value) * 100) : 0,
                  color: item.color
                }))}
              />
            </div>
          </div>
        </div>

        {/* Weekly Performance */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden flex flex-col justify-between">
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
          <div className={`px-5 py-4 flex-1 flex items-center justify-center transition-opacity duration-200 ${isLoadingWeekly ? 'opacity-40' : ''}`}>
            <div className="w-full h-[200px]">
              <BarChart items={stats.weeklyPerformance} />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Drawer and Modal ═══ */}
      {selectedConv && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-[rgba(15,23,42,0.5)] z-[88] transition-opacity duration-300"
            onClick={() => setSelectedConv(null)}
          />
          {/* Drawer */}
          <div className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[580px] sm:max-w-[90vw] bg-white shadow-xl z-[89] flex flex-col overflow-hidden animate-slideIn">
            {/* Drawer header */}
            <div className="px-5 py-4 border-b border-[#E5E7EB] shrink-0">
              <div className="flex items-center gap-[13px]">
                <div
                  className="w-[46px] h-[46px] rounded-full text-white flex items-center justify-center text-[15px] font-bold shrink-0"
                  style={{ backgroundColor: selectedConv.avatarColor }}
                >
                  {selectedConv.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-bold text-[#0F172A] flex items-center gap-2 flex-wrap">
                    {selectedConv.leadName}
                    {selectedConv.tagType && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        selectedConv.tagType === 'success' ? 'bg-[#ECFDF3] text-[#027A48]' :
                        selectedConv.tagType === 'live'
                          ? operationalView?.conversationTone === 'red'
                            ? 'bg-[#FEF3F2] text-[#B42318]'
                            : operationalView?.conversationTone === 'amber'
                              ? 'bg-[#FFFAEB] text-[#B54708]'
                              : operationalView?.conversationTone === 'blue'
                                ? 'bg-[#EFF8FF] text-[#175CD3]'
                                : operationalView?.conversationTone === 'neutral'
                                  ? 'bg-[#F1F5F9] text-[#475569]'
                                  : 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' :
                        selectedConv.tagType === 'warning' ? 'bg-[#FFFAEB] text-[#B54708]' :
                        'bg-[rgba(27,58,107,0.08)] text-[#1B3A6B]'
                      }`}>
                        {selectedConv.aiHandling ? (operationalView?.conversationBadgeLabel || selectedConv.tagLabel) : selectedConv.tagLabel}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[#475569] mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {selectedConv.profession && <span>{selectedConv.profession}</span>}
                    {selectedConv.details.city && selectedConv.profession && <span className="text-[#CBD5E1]">·</span>}
                    {selectedConv.details.city && <span>{selectedConv.details.city}</span>}
                    {selectedConv.details.susep && (
                      <>
                        <span className="text-[#CBD5E1]">·</span>
                        <span className="font-mono text-[11px]">{selectedConv.details.susep}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className={`text-[15px] font-bold font-mono ${
                    selectedConv.fitScore >= 8 ? 'text-[#039855]' : selectedConv.fitScore >= 5 ? 'text-[#A56B0A]' : 'text-[#64748B]'
                  }`}>Fit {selectedConv.fitScore}</div>
                  <button
                    onClick={() => setSelectedConv(null)}
                    className="w-7 h-7 rounded-lg bg-[#F1F3F6] text-[#475569] flex items-center justify-center hover:bg-[#FEF3F2] hover:text-[#D92D20] transition-all"
                  >
                    <X className="w-[14px] h-[14px]" />
                  </button>
                </div>
              </div>
            </div>

            {/* Drawer tabs */}
            <div className="flex px-4 bg-white border-b border-[#E5E7EB] shrink-0 gap-[2px]">
              {[
                { key: 'chat', icon: '💬', label: 'Conversa' },
                { key: 'info', icon: '📋', label: 'Ficha' },
                { key: 'health', icon: '❤️', label: 'Saúde' },
                { key: 'history', icon: '📊', label: 'Histórico' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setDrawerTab(tab.key as any)}
                  className={`px-[11px] py-[10px] text-[12px] font-medium border-b-2 whitespace-nowrap transition-all ${
                    drawerTab === tab.key
                      ? 'text-[#1B3A6B] border-[#1B3A6B] font-semibold'
                      : 'text-[#475569] border-transparent hover:text-[#0F172A]'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Drawer panes */}
            {drawerTab === 'chat' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Chat messages */}
                <div className="flex-1 p-[14px] overflow-y-auto flex flex-col gap-[9px]" style={{ background: '#ECE5DD' }}>
                  <div className="self-center text-[10.5px] text-[#64748B] bg-white/85 px-[9px] py-[3px] rounded-[10px]">
                    Hoje
                  </div>
                  {messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                      <MessageSquare className="w-12 h-12 text-[#64748B]/30 mb-3" />
                      <p className="text-[13px] text-[#475569] font-medium">Nenhuma mensagem ainda</p>
                      <p className="text-[11px] text-[#64748B] mt-1">A conversa começará quando a IA enviar a primeira mensagem.</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isOutbound = msg.sender === 'agent' || msg.sender === 'ai';
                      return (
                        <div
                          key={msg.id}
                          className={`max-w-[82%] px-3 py-[9px] text-[12.5px] leading-[1.5] text-[#0F172A] rounded-[9px] shadow-sm ${
                            isOutbound
                              ? 'bg-[#DCF8C6] self-end rounded-tr-[2px]'
                              : 'bg-white self-start rounded-tl-[2px]'
                          } ${msg.sender === 'ai' ? 'border-l-[3px] border-l-[#E8981C]' : ''}`}
                        >
                          {msg.sender === 'ai' && (
                            <div className="text-[9px] uppercase tracking-wider text-[#A56B0A] font-bold mb-[3px]">
                              IA Prospix
                            </div>
                          )}
                          {msg.content}
                          <div className="text-[9.5px] text-[#64748B] text-right mt-[3px] font-mono">
                            {msg.timestamp}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* AI control or message input */}
                {selectedConv.aiHandling ? (
                  <div className="p-3 bg-[rgba(27,58,107,0.04)] border-t border-[rgba(27,58,107,0.12)] flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] rounded-lg">
                        <Bot className={`w-4 h-4 ${operationalView?.canSend ? 'animate-pulse' : ''}`} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-[#0F172A]">{operationalView?.conversationTitle || 'IA conduzindo conversa'}</p>
                        <p className="text-[10px] text-[#475569]">{operationalView?.conversationBody || 'Status operacional em verificacao.'}</p>
                      </div>
                    </div>
                    <Button
                      onClick={handleTakeover}
                      className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-semibold text-xs h-[38px] px-4 rounded-lg shadow-md"
                    >
                      Assumir conversa
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSendMessage} className="p-3 border-t border-[#E5E7EB] bg-white shrink-0 flex gap-2">
                    <Input
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Escreva sua mensagem..."
                      className="flex-1 bg-white border-[#E5E7EB] text-xs focus:border-[#1B3A6B] h-[38px] text-[#0F172A] placeholder-[#64748B]"
                    />
                    <Button
                      type="submit"
                      className="bg-[#1B3A6B] hover:bg-[#142C52] text-white p-2.5 rounded-lg shadow-md w-11 h-11 flex items-center justify-center shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                )}
              </div>
            ) : drawerTab === 'info' ? (
              /* Ficha pane */
              <div className="flex-1 overflow-y-auto p-5" style={{ background: '#F7F8FA' }}>
                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-2">
                  Dados do Lead
                </h4>
                <div className="bg-white p-[12px_14px] rounded-lg border border-[#E5E7EB] grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-x-3 gap-y-[5px] text-[12.5px] mb-4">
                  <dt className="text-[#64748B]">Nome</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.leadName}</dd>
                  <dt className="text-[#64748B]">Telefone</dt>
                  <dd className="text-[#0F172A] font-medium font-mono">{selectedConv.details.phone || '—'}</dd>
                  <dt className="text-[#64748B]">Cidade</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.details.city || '—'}</dd>
                  <dt className="text-[#64748B]">Profissão</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.profession || '—'}</dd>
                  <dt className="text-[#64748B]">Empresa</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.details.company || '—'}</dd>
                  <dt className="text-[#64748B]">Registro</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.details.susep || '—'}</dd>
                  <dt className="text-[#64748B]">Fit Score</dt>
                  <dd className={`font-bold font-mono ${
                    selectedConv.fitScore >= 8 ? 'text-[#039855]' : selectedConv.fitScore >= 5 ? 'text-[#A56B0A]' : 'text-[#64748B]'
                  }`}>{selectedConv.fitScore}</dd>
                  <dt className="text-[#64748B]">Avaliação Google</dt>
                  <dd className="text-[#0F172A] font-medium">
                    {selectedConv.details.googleRating 
                      ? `⭐ ${selectedConv.details.googleRating.toFixed(1)} (${selectedConv.details.googleReviewsCount || 0} avaliações)` 
                      : '—'}
                  </dd>
                </div>

                {selectedConv.details.cnpjInfo && (
                  <>
                    <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-2 mt-4">
                      Dados de Enriquecimento (CNPJ)
                    </h4>
                    <div className="bg-white p-[12px_14px] rounded-lg border border-[#E5E7EB] grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-x-3 gap-y-[5px] text-[12.5px] mb-4">
                      <dt className="text-[#64748B]">CNPJ</dt>
                      <dd className="text-[#0F172A] font-semibold font-mono">{selectedConv.details.cnpjInfo.cnpj}</dd>
                      <dt className="text-[#64748B]">Razão Social</dt>
                      <dd className="text-[#0F172A] font-medium">{selectedConv.details.cnpjInfo.razaoSocial}</dd>
                      {selectedConv.details.cnpjInfo.nomeFantasia && (
                        <>
                          <dt className="text-[#64748B]">Nome Fantasia</dt>
                          <dd className="text-[#0F172A] font-medium">{selectedConv.details.cnpjInfo.nomeFantasia}</dd>
                        </>
                      )}
                      <dt className="text-[#64748B]">Situação Cadastral</dt>
                      <dd className="text-[#0F172A] font-medium">
                        <span className="text-[#039855] font-semibold bg-[#ECFDF3] px-1.5 py-0.5 rounded text-[11px]">
                          {selectedConv.details.cnpjInfo.situacaoCadastral}
                        </span>
                      </dd>
                      {selectedConv.details.cnpjInfo.dataInicioAtividade && (
                        <>
                          <dt className="text-[#64748B]">Data de Abertura</dt>
                          <dd className="text-[#0F172A] font-medium">
                            {new Date(selectedConv.details.cnpjInfo.dataInicioAtividade).toLocaleDateString('pt-BR')} ({Math.floor((Date.now() - new Date(selectedConv.details.cnpjInfo.dataInicioAtividade).getTime()) / (365 * 24 * 60 * 60 * 1000))} anos de atuação)
                          </dd>
                        </>
                      )}
                      {selectedConv.details.cnpjInfo.cnaeFiscal && (
                        <>
                          <dt className="text-[#64748B]">CNAE Principal</dt>
                          <dd className="text-[#0F172A] font-medium font-mono">{selectedConv.details.cnpjInfo.cnaeFiscal}</dd>
                        </>
                      )}
                      {selectedConv.details.cnpjInfo.qsa && selectedConv.details.cnpjInfo.qsa.length > 0 && (
                        <>
                          <dt className="text-[#64748B]">Sócios (QSA)</dt>
                          <dd className="text-[#0F172A] font-medium space-y-1.5 mt-0.5">
                            {selectedConv.details.cnpjInfo.qsa.map((socio, idx) => (
                              <div key={idx} className="bg-slate-50 border border-slate-100 p-1.5 rounded text-[11.5px] leading-relaxed">
                                <span className="font-semibold block text-slate-800">{socio.nome}</span>
                                <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wide">{socio.qual}</span>
                              </div>
                            ))}
                          </dd>
                        </>
                      )}
                    </div>
                  </>
                )}

                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-2 mt-4">
                  Prioridade
                </h4>
                <div className="bg-white p-3 rounded-lg border border-[#E5E7EB] mb-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      selectedConv.details.priority === 'high' ? 'bg-[#039855]' :
                      selectedConv.details.priority === 'medium' ? 'bg-[#E8981C]' : 'bg-[#64748B]'
                    }`} />
                    <span className="text-[12.5px] font-semibold text-[#0F172A]">
                      {selectedConv.details.priority === 'high' ? 'Alta prioridade' :
                       selectedConv.details.priority === 'medium' ? 'Média prioridade' : 'Baixa prioridade'}
                    </span>
                    <span className="text-[11px] text-[#64748B] ml-auto">
                      Fit {selectedConv.fitScore} · {selectedConv.details.health}
                    </span>
                  </div>
                </div>

                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-2 mt-4">
                  Tags
                </h4>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selectedConv.details.tags?.length > 0 ? (
                    selectedConv.details.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] bg-[#F1F3F6] text-[#475569] border border-[#E5E7EB] px-2 py-0.5 rounded-full font-medium"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-[#64748B] italic">Nenhuma tag atribuída</span>
                  )}
                </div>

                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-2 mt-4">
                  Anotações Suas
                </h4>
                <div className="bg-white p-3 rounded-lg border border-[#E5E7EB] space-y-3">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Adicione anotações sobre este lead..."
                    className="w-full min-h-[80px] p-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-xs outline-none focus:border-[#1B3A6B] focus:bg-white text-slate-800 placeholder-slate-400 leading-relaxed resize-y"
                  />
                  <div className="flex justify-end">
                    <Button
                      onClick={handleSaveNote}
                      disabled={!newNote.trim()}
                      className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-semibold text-[11px] h-7 px-3 rounded-md shadow-sm disabled:opacity-50"
                    >
                      Salvar anotação
                    </Button>
                  </div>

                  {isLoadingNotes ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="w-4 h-4 rounded-full border border-slate-400 border-t-transparent animate-spin" />
                    </div>
                  ) : notes.length > 0 ? (
                    <div className="border-t border-[#EEF0F3] pt-2 space-y-2 max-h-[150px] overflow-y-auto pr-1">
                      {notes.map((note) => (
                        <div key={note.id} className="bg-slate-50 p-2 rounded border border-slate-100 text-[11.5px] leading-relaxed text-slate-700">
                          <p>{note.content}</p>
                          <span className="text-[9px] text-slate-400 font-mono mt-1 block">
                            {new Date(note.created_at || note.createdAt).toLocaleString('pt-BR')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : drawerTab === 'health' ? (
              /* Saúde pane */
              <div className="flex-1 overflow-y-auto p-5 bg-[#F7F8FA] space-y-4">
                <div className="bg-[#FFF9F6] border border-[#FFE4D6] rounded-xl p-3 flex items-start gap-2.5">
                  <span className="text-base text-[#D95B16] shrink-0">⚠️</span>
                  <div className="text-[12px] text-[#A5511D] leading-relaxed">
                    Pré-qualificação coletada pela IA na conversa. Confirmar dados em reunião antes de enviar cotação.
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#EEF0F3]">
                    <h4 className="text-[12px] font-bold uppercase tracking-wider text-[#64748B]">
                      Pré-qualificação para Cotação MetLife
                    </h4>
                  </div>
                  <div className="p-4 space-y-2.5 text-[12.5px]">
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Tabagista</span>
                      <span className="text-[#0F172A] font-semibold">
                        {selectedConv.details.healthProfile?.smoker === true ? '🚬 Sim' : 
                         selectedConv.details.healthProfile?.smoker === false ? '✅ Não' : '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Pratica esporte</span>
                      <span className="text-[#0F172A] font-semibold">{selectedConv.details.healthProfile?.physicalActivity || '—'}</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Peso aproximado</span>
                      <span className="text-[#0F172A] font-semibold">{selectedConv.details.healthProfile?.weightKg ? `${selectedConv.details.healthProfile.weightKg} kg` : '—'}</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Altura</span>
                      <span className="text-[#0F172A] font-semibold">{selectedConv.details.healthProfile?.heightCm ? `${(selectedConv.details.healthProfile.heightCm / 100).toFixed(2)} m` : '—'}</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">IMC estimado</span>
                      <span className="text-[#0F172A] font-semibold font-mono">
                        {selectedConv.details.healthProfile?.bmiCalculated 
                          ? `${selectedConv.details.healthProfile.bmiCalculated.toFixed(1)} · ${
                              selectedConv.details.healthProfile.bmiCalculated < 18.5 ? 'Abaixo do peso' :
                              selectedConv.details.healthProfile.bmiCalculated < 25 ? 'Normal' :
                              selectedConv.details.healthProfile.bmiCalculated < 30 ? 'Sobrepeso' : 'Obesidade'
                            }`
                          : '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Doença pré-existente</span>
                      <span className="text-[#0F172A] font-semibold">{selectedConv.details.healthProfile?.preExistingDiseases || 'Não declarada'}</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Medicação contínua</span>
                      <span className="text-[#0F172A] font-semibold">{selectedConv.details.healthProfile?.continuousMedication || 'Não'}</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Cirurgia nos últimos 5a</span>
                      <span className="text-[#0F172A] font-semibold">
                        {selectedConv.details.healthProfile?.recentSurgery === true ? 'Sim' : 
                         selectedConv.details.healthProfile?.recentSurgery === false ? 'Não' : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#EEF0F3]">
                    <h4 className="text-[12px] font-bold uppercase tracking-wider text-[#64748B]">
                      Histórico Familiar
                    </h4>
                  </div>
                  <div className="p-4 space-y-2.5 text-[12.5px]">
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Pai</span>
                      <span className="text-[#0F172A] font-semibold">{(selectedConv.details.healthProfile?.familyHistory as any)?.father || 'Sem doença declarada'}</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Mãe</span>
                      <span className="text-[#0F172A] font-semibold">{(selectedConv.details.healthProfile?.familyHistory as any)?.mother || 'Sem doença declarada'}</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Irmãos</span>
                      <span className="text-[#0F172A] font-semibold">{(selectedConv.details.healthProfile?.familyHistory as any)?.siblings || 'Sem doença declarada'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#EEF0F3]">
                    <h4 className="text-[12px] font-bold uppercase tracking-wider text-[#64748B]">
                      Avaliação de Risco MetLife
                    </h4>
                  </div>
                  <div className="p-4 space-y-2.5 text-[12.5px]">
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Categoria</span>
                      <span className="text-[#027A48] font-bold">
                        {selectedConv.details.healthProfile?.riskCategory === 'low' ? 'Padrão - sem exames adicionais' :
                         selectedConv.details.healthProfile?.riskCategory === 'medium' ? 'Médio risco' :
                         selectedConv.details.healthProfile?.riskCategory === 'high' ? 'Alto risco' : 'Padrão - sem exames adicionais'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Faixa de prêmio estimada</span>
                      <span className="text-[#0F172A] font-bold font-mono">
                        {selectedConv.details.healthProfile?.estimatedPremiumMinCents
                          ? `R$ ${(selectedConv.details.healthProfile.estimatedPremiumMinCents / 100).toFixed(0)} – R$ ${(selectedConv.details.healthProfile.estimatedPremiumMaxCents ? selectedConv.details.healthProfile.estimatedPremiumMaxCents / 100 : 0).toFixed(0)} / mês`
                          : 'R$ 487 - 652 / mês'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr] pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                      <span className="text-[#64748B]">Cobertura sugerida</span>
                      <span className="text-[#0F172A] font-semibold">{selectedConv.details.healthProfile?.suggestedCoverage || 'R$ 800k vida + R$ 300k DIH'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Histórico pane */
              <div className="flex-1 overflow-y-auto p-5" style={{ background: '#F7F8FA' }}>
                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-3">
                  Timeline de Eventos
                </h4>

                {(() => {
                  const eventLabels: Record<string, string> = {
                    lead_captured: 'Lead capturado pelo Google Maps',
                    lead_enriched: 'Dados enriquecidos automaticamente',
                    status_changed: 'Status atualizado',
                    conversation_started: 'Conversa iniciada',
                    message_sent: 'Mensagem enviada',
                    message_received: 'Resposta recebida do lead',
                    meeting_scheduled: 'Reunião agendada',
                    meeting_completed: 'Reunião realizada',
                    meeting_cancelled: 'Reunião cancelada',
                    fit_score_calculated: 'Fit Score calculado',
                    whatsapp_validated: 'WhatsApp validado',
                    ai_takeover: 'IA assumiu a conversa',
                    manual_takeover: 'Operador assumiu a conversa',
                    escalated: 'Conversa escalada para humano',
                  };

                  const allEvents = leadEvents.length > 0
                    ? leadEvents
                    : selectedConv.details.logs.map((log, i) => ({
                        id: `fallback-${i}`,
                        eventType: i === 0 ? 'lead_captured' : 'conversation_started',
                        payload: null,
                        createdAt: log.time,
                      }));

                  return (
                    <div className="relative border-l-2 border-[#E5E7EB] pl-4 space-y-4">
                      {allEvents.map((evt, idx) => {
                        const label = eventLabels[evt.eventType] || evt.eventType.replace(/_/g, ' ');
                        const statusPayload = evt.payload as any;
                        const detail = statusPayload?.new_status || statusPayload?.source || null;
                        const timeStr = evt.createdAt.includes('T')
                          ? new Date(evt.createdAt).toLocaleString('pt-BR')
                          : evt.createdAt;

                        return (
                          <div key={evt.id} className="relative text-xs">
                            <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white ${
                              idx === 0 ? 'bg-[#1B3A6B]' : 'bg-[#E5E7EB]'
                            }`} />
                            <div className="bg-white p-3 rounded-lg border border-[#E5E7EB]">
                              <p className="text-[#0F172A] font-medium">{label}</p>
                              {detail && (
                                <p className="text-[10px] text-[#475569] mt-0.5">{detail}</p>
                              )}
                              <span className="text-[9px] text-[#64748B] font-mono flex items-center gap-1 mt-1">
                                <Clock className="w-2.5 h-2.5" />
                                {timeStr}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {selectedConv.aiHandling && (
                        <div className="relative text-xs">
                          <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-[#E8981C] border-2 border-white animate-pulse" />
                          <div className="bg-white p-3 rounded-lg border border-[#E8981C]/30">
                            <p className="text-[#A56B0A] font-medium">IA conversando agora</p>
                            <span className="text-[9px] text-[#64748B] font-mono flex items-center gap-1 mt-1">
                              <Clock className="w-2.5 h-2.5" />
                              em andamento
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Drawer footer */}
            <div className="px-4 py-3 border-t border-[#E5E7EB] bg-white flex gap-[6px] shrink-0 flex-wrap">
              <button
                onClick={() => {
                  if (selectedConv.details.phone) {
                    window.open(`tel:${selectedConv.details.phone}`, '_self');
                  } else {
                    toast.info('Ligação', 'Número não disponível.');
                  }
                }}
                className="flex-1 min-w-[100px] h-[38px] rounded-lg text-xs font-semibold bg-[#F1F3F6] text-[#0F172A] hover:bg-[#E5E7EB] inline-flex items-center justify-center gap-1.5 transition-all"
              >
                <Phone className="w-[13px] h-[13px]" />
                Ligar
              </button>
              <button
                onClick={handleTakeover}
                className="flex-1 min-w-[100px] h-[38px] rounded-lg text-xs font-semibold bg-[#F1F3F6] text-[#0F172A] hover:bg-[#E5E7EB] inline-flex items-center justify-center gap-1.5 transition-all"
              >
                <User className="w-[13px] h-[13px]" />
                {selectedConv.aiHandling ? 'Assumir' : 'Manual'}
              </button>
              <button
                onClick={() => setIsOutcomeModalOpen(true)}
                className="flex-1 min-w-[100px] h-[38px] rounded-lg text-xs font-semibold bg-[#039855] text-white hover:bg-[#027A48] inline-flex items-center justify-center gap-1.5 transition-all"
              >
                <Award className="w-[13px] h-[13px]" />
                Resultado
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Loading Drawer Overlay ═══ */}
      {isLoadingDrawer && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-900/20 backdrop-blur-[1px]">
          <div className="bg-white px-5 py-4 rounded-xl shadow-lg border border-slate-100 flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-[#1B3A6B] border-t-transparent animate-spin" />
            <span className="text-xs font-semibold text-slate-700">Carregando ficha do lead...</span>
          </div>
        </div>
      )}

      {/* ═══ Outcome Modal ═══ */}
      {isOutcomeModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm">
          <div className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-[420px] overflow-hidden shadow-xl animate-fadeIn">
            <div className="px-[22px] py-[18px] border-b border-[#EEF0F3] flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#0F172A]">Registrar Venda / Fechamento</h3>
              <button
                onClick={() => setIsOutcomeModalOpen(false)}
                className="w-[30px] h-[30px] rounded-lg bg-[#F1F3F6] flex items-center justify-center text-[#475569] hover:bg-[#FEF3F2] hover:text-[#D92D20] transition-all"
              >
                <X className="w-[15px] h-[15px]" />
              </button>
            </div>

            <form onSubmit={handleOutcomeSubmit} className="p-[20px_22px] space-y-4">
              <div>
                <label className="block text-[12.5px] font-semibold text-[#0F172A] mb-[5px]">
                  Valor Estimado da Apólice (Anual)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#64748B] font-mono">R$</span>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={outcomeValue}
                    onChange={(e) => setOutcomeValue(e.target.value)}
                    className="pl-9 bg-white border-[#D0D5DD] text-[#0F172A] placeholder-[#64748B] text-xs focus:border-[#1B3A6B] h-9 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12.5px] font-semibold text-[#0F172A] mb-[5px]">
                  Comissão Estimada Ganha
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#64748B] font-mono">R$</span>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={outcomeCommission}
                    onChange={(e) => setOutcomeCommission(e.target.value)}
                    className="pl-9 bg-white border-[#D0D5DD] text-[#0F172A] placeholder-[#64748B] text-xs focus:border-[#1B3A6B] h-9 font-mono"
                    required
                  />
                </div>
              </div>
            </form>

            <div className="px-[22px] py-[14px] border-t border-[#EEF0F3] bg-[#F1F3F6] flex justify-end gap-2">
              <Button
                type="button"
                onClick={() => setIsOutcomeModalOpen(false)}
                className="bg-[#F1F3F6] hover:bg-[#E5E7EB] text-[#0F172A] font-semibold text-xs h-9 px-4 rounded-lg border border-[#E5E7EB]"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                onClick={handleOutcomeSubmit}
                className="bg-[#1B3A6B] hover:bg-[#142C52] text-white font-semibold text-xs h-9 px-4 rounded-lg"
              >
                Confirmar Faturamento
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
