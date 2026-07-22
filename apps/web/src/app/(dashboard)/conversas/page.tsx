'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button, Input, toast } from '@prospix/ui';
import { MessageSquare, Send, Bot, User, Phone, ChevronRight, Filter, ArrowUpDown, LayoutList, Columns3, X, Award, Clock, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { conversationsQueries, meetingsQueries, leadsQueries } from '@/lib/queries';

import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { useAuthStore } from '@/store/auth-store';
import { useOperationalStatusContext } from '@/hooks/useOperationalStatus';

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
  // Prototype-specific display fields
  initials?: string;
  avatarColor?: string;
  profession?: string;
  professionKey?: string;
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
      bmiCalculated: number | null;
      preExistingDiseases: string | null;
      continuousMedication: string | null;
      riskCategory: string | null;
      estimatedPremiumMinCents: number | null;
      estimatedPremiumMaxCents: number | null;
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

// Avatar color classes matching prototype
const AVATAR_COLORS = [
  '#1B3A6B', '#5A2A82', '#B8740E', '#075E54', '#9E2A2B', '#1F4E5F', '#374151',
];

const PROFESSION_LABELS: Record<string, string> = {
  DOCTOR: 'Médico(a)',
  LAWYER: 'Advogado(a)',
  DENTIST: 'Dentista',
  ENTREPRENEUR: 'Empresário(a)',
  ENGINEER: 'Engenheiro(a)',
  ARCHITECT: 'Arquiteto(a)',
  ACCOUNTANT: 'Contador(a)',
  OTHER: 'Outro',
};

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).filter((c): c is string => Boolean(c)).slice(0, 2).join('').toUpperCase();
}

function getAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? '#1B3A6B';
}

// Filter types for toolbar
type FilterType = 'all' | 'hot' | 'wait' | 'scheduled';

export default function Conversations() {
  const { tenantId } = useAuthStore();
  const router = useRouter();
  const operationalStatus = useOperationalStatusContext();
  const operationalView = operationalStatus?.view;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
  const [outcomeValue, setOutcomeValue] = useState('');
  const [outcomeCommission, setOutcomeCommission] = useState('');
  const [drawerTab, setDrawerTab] = useState<'chat' | 'info' | 'health' | 'history'>('chat');
  const [leadEvents, setLeadEvents] = useState<Array<{ id: string; eventType: string; payload: any; createdAt: string }>>([]);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [professionFilter, setProfessionFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'temperature' | 'recent' | 'name' | 'score'>('temperature');
  const [showProfDropdown, setShowProfDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper to map DB Conversation to Web Frontend UI type
  const mapBackendConversation = (conv: any, index?: number): Conversation => {
    const lead = conv.leads || conv.lead || {};
    const metadata = (lead.metadata || {}) as Record<string, any>;
    const name = lead.name || 'Sem nome';
    const idx = index ?? 0;

    // Derive company from real data sources
    const company = metadata.cnpj_info?.nomeFantasia
      || metadata.cnpj_info?.razaoSocial
      || (lead.source_raw_data as any)?.name
      || '';

    // Translate profession enum to PT-BR
    const professionLabel = lead.profession ? (PROFESSION_LABELS[lead.profession] || lead.profession) : '';

    // HealthProfile from backend include (Supabase returns snake_case nested)
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
      professionKey: lead.profession || '',
      ...(() => {
        const isWaiting = !conv.ai_handling && (
          conv.status === 'ESCALATED' ||
          (conv.last_inbound_at && (!conv.last_outbound_at || new Date(conv.last_inbound_at) > new Date(conv.last_outbound_at)))
        );
        if (conv.ai_handling) return { tagType: 'live' as const, tagLabel: 'IA respondendo' };
        if (isWaiting) return { tagType: 'warning' as const, tagLabel: 'Aguardando você' };
        return { tagType: undefined, tagLabel: undefined };
      })(),
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
          bmiCalculated: hp.bmi_calculated ? Number(hp.bmi_calculated) : null,
          preExistingDiseases: hp.pre_existing_diseases,
          continuousMedication: hp.continuous_medication,
          riskCategory: hp.risk_category,
          estimatedPremiumMinCents: hp.estimated_premium_min_cents,
          estimatedPremiumMaxCents: hp.estimated_premium_max_cents,
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

  // Helper to map DB Message to Web Frontend UI type
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

  // 1. Fetch Conversations from Supabase
  const fetchConversations = async (silent = false) => {
    if (!tenantId) return;
    try {
      const result = await conversationsQueries.list(tenantId);
      if (result.error) throw new Error(result.error.message);
      const list = result.data;
      if (list && list.length > 0) {
        const mapped = list.map((conv: any, idx: number) => mapBackendConversation(conv, idx));
        setConversations(mapped);
        if (!selectedConv) {
          setSelectedConv(mapped[0] || null);
        }
      } else {
        setConversations([]);
        setSelectedConv(null);
      }
    } catch (error) {
      console.error('Error fetching real conversations:', error);
      if (!silent) {
        setConversations([]);
        setSelectedConv(null);
        toast.error('Erro de Conexão', 'Não foi possível carregar as conversas.');
      }
    }
  };

  useEffect(() => {
    fetchConversations();
    // Auto-refresh every 15 seconds
    const interval = setInterval(() => fetchConversations(true), 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Fetch Messages for selected conversation
  useEffect(() => {
    if (!selectedConv || !tenantId) return;

    const fetchMessages = async () => {
      try {
        const result = await conversationsQueries.getMessages(selectedConv.id, tenantId);
        if (result.error) throw new Error(result.error.message);
        setMessages((result.data || []).map(mapBackendMessage));
      } catch (error) {
        console.error('Error fetching messages:', error);
        toast.error('Erro de sincronização', 'Não foi possível carregar as novas mensagens do servidor.');
      }
    };

    fetchMessages();
  }, [selectedConv?.id, tenantId]);

   // 3. SSE Real-time Synchronization (replaces Supabase Realtime)
  useRealtimeEvents(tenantId, {
    onMessageCreated: (payload: Record<string, unknown>) => {
      const newMsg = payload;
      if (selectedConv && newMsg.conversation_id === selectedConv.id) {
        setMessages(prev => {
          if (prev.some(m => m.id === (newMsg.id as string))) return prev;
          return [...prev, mapBackendMessage({
            id: newMsg.id,
            sender: newMsg.sender,
            content: newMsg.content,
            createdAt: newMsg.created_at,
          })];
        });
      }

      setConversations(prev =>
        prev.map(c => {
          if (c.id === (newMsg.conversation_id as string)) {
            return {
              ...c,
              lastMessage: newMsg.content as string,
              timestamp: new Date(newMsg.created_at as string).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              unread: selectedConv?.id !== c.id,
            };
          }
          return c;
        })
      );
    },
    onConversationCreated: () => {
      fetchConversations(true);
    },
    onConversationUpdated: (payload: Record<string, unknown>) => {
      const updated = payload;
      setConversations(prev =>
        prev.map(c => {
          if (c.id === (updated.id as string)) {
            return {
              ...c,
              aiHandling: updated.ai_handling as boolean,
            };
          }
          return c;
        })
      );
      if (selectedConv && selectedConv.id === (updated.id as string)) {
        setSelectedConv(prev => prev ? { ...prev, aiHandling: updated.ai_handling as boolean } : null);
      }
    },
  });

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

  const handleTakeover = async () => {
    if (!selectedConv || !tenantId) return;
    
    const updated = { ...selectedConv, aiHandling: false };
    setSelectedConv(updated);
    setConversations(conversations.map(c => c.id === selectedConv.id ? updated : c));

    if (selectedConv.id.startsWith('conv-')) {
      toast.success('Controle Manual Ativo', 'A IA foi desativada temporariamente. Você está no controle da conversa.');
      return;
    }

    try {
      const result = await conversationsQueries.update(tenantId, selectedConv.id, false);
      if (result.error) throw new Error(result.error.message);
      toast.success('Controle Manual Ativo', 'A IA foi desativada temporariamente. Você está no controle da conversa.');
    } catch {
      toast.error('Erro de Conexão', 'Não foi possível alterar o status do bot.');
      const rolled = { ...selectedConv, aiHandling: true };
      setSelectedConv(rolled);
      setConversations(conversations.map(c => c.id === selectedConv.id ? rolled : c));
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConv) return;

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

    setConversations(prev =>
      prev.map(c => c.id === selectedConv.id ? { ...c, lastMessage: userMsgContent, timestamp: newMsg.timestamp } : c)
    );

    if (selectedConv.id.startsWith('conv-')) {
      return;
    }

    try {
      const result = await conversationsQueries.sendMessage(tenantId!, selectedConv.id, userMsgContent);
      if (result.error) throw new Error(result.error.message);
      const savedMsg = mapBackendMessage(result.data);
      setMessages(prev => prev.map(m => m.id === tempId ? savedMsg : m));
    } catch (err: unknown) {
      console.error('Error sending message:', err);
      const message = err instanceof Error
        ? err.message || 'Falha ao enviar a mensagem pelo gateway WhatsApp.'
        : 'Falha ao enviar a mensagem pelo gateway WhatsApp.';
      toast.error('Erro ao enviar', message);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };

  const handleOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv) return;

    try {
      if (selectedConv.id.startsWith('conv-')) {
        toast.success('Venda Registrada!', 'Parabéns pela apólice fechada! Faturamento cadastrado com sucesso.');
        setIsOutcomeModalOpen(false);
        setOutcomeValue('');
        setOutcomeCommission('');
        return;
      }

      let meetingId = selectedConv.meetingId;
      if (!meetingId && tenantId) {
        const meetingsResult = await meetingsQueries.list(tenantId);
        const meetings = meetingsResult.data || [];
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
      toast.error('Erro ao registrar', 'Tente novamente ou verifique os valores.');
    }
  };

  // Computed counts for toolbar
  const totalCount = conversations.length;
  const hotCount = conversations.filter(c => c.fitScore >= 9.0).length;
  const waitCount = conversations.filter(c => c.tagType === 'warning' || c.unread).length;
  const scheduledCount = conversations.filter(c => c.tagType === 'success').length;
  const liveCount = conversations.filter(c => c.aiHandling).length;

  // Filtered + sorted conversations
  const sortedConversations = useMemo(() => {
    return conversations
      .filter(c => {
        const matchesTab = (() => {
          switch (activeFilter) {
            case 'hot': return c.fitScore >= 9.0;
            case 'wait': return c.tagType === 'warning' || c.unread;
            case 'scheduled': return c.tagType === 'success';
            default: return true;
          }
        })();
        const matchesProf = professionFilter === 'all' || c.professionKey === professionFilter;
        return matchesTab && matchesProf;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'temperature':
          case 'score':
            return b.fitScore - a.fitScore;
          case 'name':
            return a.leadName.localeCompare(b.leadName, 'pt-BR');
          case 'recent':
          default:
            return 0; // Already sorted by last_message_at from DB
        }
      });
  }, [conversations, activeFilter, professionFilter, sortBy]);

  const handleSelectConv = (conv: Conversation) => {
    setMessages([]);
    setLeadEvents([]);
    setSelectedConv(conv);
    setDrawerTab('chat');
  };

  // Tag rendering helper
  const renderTag = (conv: Conversation) => {
    if (!conv.tagType && !conv.tagLabel) return null;
    const type = conv.tagType;
    if (type === 'success') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-[7px] py-[2px] rounded-[10px] bg-[#ECFDF3] text-[#027A48] whitespace-nowrap">
          {conv.tagLabel}
        </span>
      );
    }
    if (type === 'live') {
      const tone = operationalView?.conversationTone || 'green';
      const tagClass = tone === 'red'
        ? 'bg-[#FEF3F2] text-[#B42318]'
        : tone === 'amber'
          ? 'bg-[#FFFAEB] text-[#B54708]'
          : tone === 'blue'
            ? 'bg-[#EFF8FF] text-[#175CD3]'
            : tone === 'neutral'
              ? 'bg-[#F1F5F9] text-[#475569]'
              : 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]';
      const dotClassName = tone === 'red'
        ? 'bg-[#D92D20]'
        : tone === 'amber'
          ? 'bg-[#E8981C]'
          : tone === 'blue'
            ? 'bg-[#175CD3]'
            : tone === 'neutral'
              ? 'bg-[#94A3B8]'
              : 'bg-[#E8981C]';
      return (
        <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-[7px] py-[2px] rounded-[10px] whitespace-nowrap ${tagClass}`}>
          <span className={`w-[5px] h-[5px] rounded-full ${dotClassName} ${operationalView?.canSend ? 'animate-pulse' : ''}`} />
          {operationalView?.conversationBadgeLabel || conv.tagLabel}
        </span>
      );
    }
    if (type === 'warning') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-[7px] py-[2px] rounded-[10px] bg-[#FFFAEB] text-[#B54708] whitespace-nowrap">
          {conv.tagLabel}
        </span>
      );
    }
    if (type === 'info') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-[7px] py-[2px] rounded-[10px] bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] whitespace-nowrap">
          {conv.tagLabel}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="animate-fadeIn space-y-[14px]">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-[10px_14px] flex items-center gap-2 flex-wrap shadow-sm">
        <button
          onClick={() => setActiveFilter('all')}
          className={`h-8 px-[11px] rounded-md text-xs font-medium border inline-flex items-center gap-1.5 transition-all ${
            activeFilter === 'all'
              ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
              : 'text-[#475569] bg-transparent border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A]'
          }`}
        >
          Todas
          <span className={`h-[18px] px-[6px] text-[10px] rounded-[14px] inline-flex items-center font-medium ${
            activeFilter === 'all'
              ? 'bg-white/20 text-white'
              : 'bg-[rgba(27,58,107,0.08)] text-[#1B3A6B]'
          }`}>
            {totalCount}
          </span>
        </button>
        <button
          onClick={() => setActiveFilter('hot')}
          className={`h-8 px-[11px] rounded-md text-xs font-medium border inline-flex items-center gap-1.5 transition-all ${
            activeFilter === 'hot'
              ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
              : 'text-[#475569] bg-transparent border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A]'
          }`}
        >
          🔥 Quentes
          <span className={`h-[18px] px-[6px] text-[10px] rounded-[14px] inline-flex items-center font-medium ${
            activeFilter === 'hot'
              ? 'bg-white/20 text-white'
              : 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]'
          }`}>
            {hotCount}
          </span>
        </button>
        <button
          onClick={() => setActiveFilter('wait')}
          className={`h-8 px-[11px] rounded-md text-xs font-medium border inline-flex items-center gap-1.5 transition-all ${
            activeFilter === 'wait'
              ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
              : 'text-[#475569] bg-transparent border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A]'
          }`}
        >
          ⚠ Aguardando você
          <span className={`h-[18px] px-[6px] text-[10px] rounded-[14px] inline-flex items-center font-medium ${
            activeFilter === 'wait'
              ? 'bg-white/20 text-white'
              : 'bg-[#FFFAEB] text-[#B54708]'
          }`}>
            {waitCount}
          </span>
        </button>
        <button
          onClick={() => setActiveFilter('scheduled')}
          className={`h-8 px-[11px] rounded-md text-xs font-medium border inline-flex items-center gap-1.5 transition-all ${
            activeFilter === 'scheduled'
              ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
              : 'text-[#475569] bg-transparent border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A]'
          }`}
        >
          ✓ Agendadas
          <span className={`h-[18px] px-[6px] text-[10px] rounded-[14px] inline-flex items-center font-medium ${
            activeFilter === 'scheduled'
              ? 'bg-white/20 text-white'
              : 'bg-[#ECFDF3] text-[#027A48]'
          }`}>
            {scheduledCount}
          </span>
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-[#E5E7EB] mx-1" />

        {/* Profession filter dropdown */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowProfDropdown(v => !v); setShowSortDropdown(false); }}
            className={`h-8 px-[11px] rounded-md text-xs font-medium border inline-flex items-center gap-1.5 transition-all ${
              professionFilter !== 'all'
                ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                : 'text-[#475569] bg-transparent border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A]'
            }`}
          >
            <Filter className="w-[13px] h-[13px]" />
            {professionFilter === 'all' ? 'Profissão' : (PROFESSION_LABELS[professionFilter] || professionFilter)}
            {professionFilter !== 'all' && (
              <span onClick={(e) => { e.stopPropagation(); setProfessionFilter('all'); }} className="ml-0.5 hover:opacity-60 cursor-pointer">✕</span>
            )}
          </button>
          {showProfDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowProfDropdown(false)} />
              <div className="absolute top-full left-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg z-20 min-w-[180px] py-1 animate-fadeIn">
                <button onClick={() => { setProfessionFilter('all'); setShowProfDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-[#F1F3F6] transition-colors ${professionFilter === 'all' ? 'text-[#1B3A6B] font-semibold bg-[rgba(27,58,107,0.04)]' : 'text-[#475569]'}`}>
                  Todas as profissões
                </button>
                {Object.entries(PROFESSION_LABELS).map(([key, label]) => (
                  <button key={key} onClick={() => { setProfessionFilter(key); setShowProfDropdown(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-[#F1F3F6] transition-colors ${professionFilter === key ? 'text-[#1B3A6B] font-semibold bg-[rgba(27,58,107,0.04)]' : 'text-[#475569]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowSortDropdown(v => !v); setShowProfDropdown(false); }}
            className="h-8 px-[11px] rounded-md text-xs font-medium text-[#475569] bg-transparent border border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A] inline-flex items-center gap-1.5 transition-all"
          >
            <ArrowUpDown className="w-[13px] h-[13px]" />
            {sortBy === 'temperature' ? 'Temperatura' : sortBy === 'recent' ? 'Recentes' : sortBy === 'name' ? 'Nome A-Z' : 'Fit Score'}
          </button>
          {showSortDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSortDropdown(false)} />
              <div className="absolute top-full left-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg z-20 min-w-[170px] py-1 animate-fadeIn">
                {[
                  { key: 'temperature', label: '🔥 Temperatura' },
                  { key: 'recent', label: '🕐 Mais recentes' },
                  { key: 'name', label: '🔤 Nome A-Z' },
                  { key: 'score', label: '📊 Fit Score' },
                ].map(opt => (
                  <button key={opt.key} onClick={() => { setSortBy(opt.key as any); setShowSortDropdown(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-[#F1F3F6] transition-colors ${sortBy === opt.key ? 'text-[#1B3A6B] font-semibold bg-[rgba(27,58,107,0.04)]' : 'text-[#475569]'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* View toggle */}
        <div className="flex bg-[#F1F3F6] rounded-md p-[2px] ml-auto">
          <button
            onClick={() => setViewMode('table')}
            className={`h-7 px-[11px] text-xs font-medium rounded inline-flex items-center gap-[5px] transition-all ${
              viewMode === 'table' ? 'text-[#1B3A6B] bg-white shadow-sm' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <LayoutList className="w-[13px] h-[13px]" />
            Tabela
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`h-7 px-[11px] text-xs font-medium rounded inline-flex items-center gap-[5px] transition-all ${
              viewMode === 'kanban' ? 'text-[#1B3A6B] bg-white shadow-sm' : 'text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <Columns3 className="w-[13px] h-[13px]" />
            Kanban
          </button>
        </div>
      </div>

      {/* ── Panel with lead rows ────────────────────────────────────────── */}
      <div className={`bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm ${viewMode !== 'table' ? 'hidden' : ''}`}>
        {/* Panel header */}
        <div className="px-[18px] py-[14px] border-b border-[#EEF0F3] flex items-center justify-between gap-[10px]">
          <div>
            <div className="text-sm font-semibold text-[#0F172A] flex items-center gap-[7px]">
              Todas as conversas ativas
            </div>
            <div className="text-[11.5px] text-[#64748B] mt-[3px]">
              {sortedConversations.length} leads em diálogo · ordenadas por {sortBy === 'temperature' ? 'temperatura' : sortBy === 'recent' ? 'data' : sortBy === 'name' ? 'nome' : 'score'}
            </div>
          </div>
          <span className="text-[10.5px] font-semibold px-2 py-[2px] rounded-[10px] bg-[rgba(232,152,28,0.14)] text-[#A56B0A] inline-flex items-center gap-[5px]">
            <span className="w-[5px] h-[5px] rounded-full bg-[#E8981C] animate-pulse" />
            {liveCount} {operationalView?.conversationTone === 'green' ? 'ao vivo' : 'com IA'}
          </span>
        </div>

        {/* Lead rows */}
        <div>
          {sortedConversations.length === 0 ? (
            activeFilter === 'all' && professionFilter === 'all' && conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <div className="w-16 h-16 bg-[#EFF6FF] rounded-full flex items-center justify-center mb-2">
                  <MessageSquare className="w-8 h-8 text-[#1B3A6B]" />
                </div>
                <h3 className="text-[16px] font-bold text-[#0F172A] mb-1">Caixa de entrada vazia</h3>
                <p className="text-[13px] text-[#475569] max-w-md mb-4 leading-relaxed">
                  Quando a inteligência artificial começar a conversar com seus leads, as mensagens aparecerão aqui. Crie uma campanha para começar a prospecção!
                </p>
                <button 
                  onClick={() => router.push('/campanhas')}
                  className="h-10 px-6 bg-[#1B3A6B] text-white text-[13px] font-semibold rounded-lg hover:bg-[#142C52] transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Criar Nova Campanha
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <MessageSquare className="w-12 h-12 text-[#64748B]/40" />
                <p className="text-sm text-[#475569] font-medium">Nenhuma conversa encontrada</p>
                <p className="text-xs text-[#64748B]">Ajuste os filtros ou aguarde novas conversas.</p>
              </div>
            )
          ) : (
            sortedConversations.map((conv, idx) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConv(conv)}
                className={`px-[18px] py-[13px] border-b border-[#EEF0F3] last:border-b-0 flex items-center gap-[13px] cursor-pointer transition-all border-l-[3px] border-l-transparent hover:bg-[rgba(27,58,107,0.04)] hover:border-l-[#1B3A6B] ${
                  selectedConv?.id === conv.id ? 'bg-[rgba(27,58,107,0.04)] border-l-[#1B3A6B]' : ''
                }`}
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-full text-white flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: conv.avatarColor || getAvatarColor(idx) }}
                >
                  {conv.initials || getInitials(conv.leadName)}
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[7px] mb-[2px] flex-wrap">
                    <span className="text-[13.5px] font-semibold text-[#0F172A]">
                      {conv.leadName}
                    </span>
                    {renderTag(conv)}
                  </div>
                  <div className="text-[11.5px] text-[#475569]">
                    {conv.profession || conv.details.company}
                  </div>
                  <div className="text-xs text-[#475569] mt-[2px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[60vw] sm:max-w-[380px] italic">
                    {conv.lastMessage}
                  </div>
                </div>

                {/* Side: time + fit */}
                <div className="text-right shrink-0 min-w-[90px]">
                  <div className={`text-[11.5px] font-semibold ${conv.whenUrgent ? 'text-[#B42318]' : 'text-[#0F172A]'}`}>
                    {conv.whenLabel || conv.timestamp}
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-[2px]">
                    Fit {conv.fitScore}
                  </div>
                </div>

                {/* Chevron action */}
                <div className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-lg transition-all ${
                  selectedConv?.id === conv.id 
                    ? 'bg-[#1B3A6B] text-white' 
                    : 'bg-[#F1F3F6] text-[#64748B]'
                }`}>
                  <ChevronRight className="w-[13px] h-[13px]" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Kanban View ──────────────────────────────────────────────────── */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { key: 'live', label: '🤖 IA Respondendo', bg: 'rgba(232,152,28,0.06)', accent: '#E8981C', items: sortedConversations.filter(c => c.tagType === 'live') },
            { key: 'warning', label: '⚠️ Aguardando Você', bg: 'rgba(181,71,8,0.04)', accent: '#B54708', items: sortedConversations.filter(c => c.tagType === 'warning') },
            { key: 'success', label: '📅 Agendadas', bg: 'rgba(2,122,72,0.04)', accent: '#027A48', items: sortedConversations.filter(c => c.tagType === 'success') },
            { key: 'other', label: '💬 Em Diálogo', bg: 'rgba(27,58,107,0.03)', accent: '#1B3A6B', items: sortedConversations.filter(c => !c.tagType) },
          ].map(col => (
            <div key={col.key} className="rounded-xl p-3 min-h-[200px] border border-[#E5E7EB]" style={{ background: col.bg }}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-1 h-4 rounded-full" style={{ background: col.accent }} />
                <span className="text-[11.5px] font-semibold text-[#0F172A]">{col.label}</span>
                <span className="text-[10px] bg-white border border-[#E5E7EB] rounded-full h-[18px] min-w-[18px] px-1.5 inline-flex items-center justify-center text-[#475569] font-semibold">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConv(conv)}
                    className={`bg-white rounded-lg border p-3 cursor-pointer hover:shadow-md transition-all ${
                      selectedConv?.id === conv.id ? 'border-[#1B3A6B] shadow-md' : 'border-[#E5E7EB] hover:border-[#1B3A6B]/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-7 h-7 rounded-full text-white flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: conv.avatarColor }}>
                        {conv.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-[#0F172A] truncate">{conv.leadName}</div>
                        <div className="text-[10px] text-[#475569] truncate">{conv.profession || conv.details.company || ''}</div>
                      </div>
                      <div className={`text-[11px] font-bold font-mono shrink-0 ${conv.fitScore >= 8 ? 'text-[#039855]' : conv.fitScore >= 5 ? 'text-[#A56B0A]' : 'text-[#64748B]'}`}>
                        {conv.fitScore}
                      </div>
                    </div>
                    <div className="text-[10.5px] text-[#475569] italic truncate">{conv.lastMessage}</div>
                    <div className="text-[9px] text-[#94A3B8] font-mono mt-1">{conv.whenLabel || conv.timestamp}</div>
                  </div>
                ))}
                {col.items.length === 0 && (
                  <div className="text-center py-8 text-[11px] text-[#94A3B8]">
                    Nenhuma conversa
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Lead Detail Drawer ──────────────────────────────────────────── */}
      {selectedConv && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-[rgba(15,23,42,0.5)] z-[88] transition-opacity duration-300"
            onClick={() => setSelectedConv(null)}
          />
          {/* Drawer */}
          <div className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[580px] sm:max-w-[90vw] bg-white shadow-xl z-[89] flex flex-col overflow-hidden animate-slideIn">
            {/* Drawer header - enriched like prototype */}
            <div className="px-5 py-4 border-b border-[#E5E7EB] shrink-0">
              <div className="flex items-center gap-[13px]">
                <div
                  className="w-[46px] h-[46px] rounded-full text-white flex items-center justify-center text-[15px] font-bold shrink-0"
                  style={{ backgroundColor: selectedConv.avatarColor || getAvatarColor(0) }}
                >
                  {selectedConv.initials || getInitials(selectedConv.leadName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-bold text-[#0F172A] flex items-center gap-2 flex-wrap">
                    {selectedConv.leadName}
                    {selectedConv.tagType && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        selectedConv.tagType === 'success' ? 'bg-[#ECFDF3] text-[#027A48]' :
                        selectedConv.tagType === 'live' ? 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' :
                        selectedConv.tagType === 'warning' ? 'bg-[#FFFAEB] text-[#B54708]' :
                        'bg-[rgba(27,58,107,0.08)] text-[#1B3A6B]'
                      }`}>{selectedConv.tagLabel}</span>
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

            {/* Drawer tabs — 4 tabs like prototype */}
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
                {/* Chat messages (WhatsApp style) */}
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
                          {msg.sender === 'agent' && (
                            <div className="text-[9px] uppercase tracking-wider text-[#1B3A6B] font-bold mb-[3px]">
                              Você
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
              /* Ficha pane — enriched */
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
              </div>
            ) : drawerTab === 'health' ? (
              /* Saúde pane — real HealthProfile data when available */
              <div className="flex-1 overflow-y-auto p-5" style={{ background: '#F7F8FA' }}>
                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-3">
                  Indicadores de Engajamento
                </h4>
                <div className="space-y-2.5 mb-5">
                  {[
                    { label: 'Respondeu à abordagem', value: selectedConv.details.health === 'Ativo', positive: true },
                    { label: 'Conversa ativa', value: selectedConv.aiHandling, positive: true },
                    { label: 'Pediu ligação', value: selectedConv.tagType === 'warning', positive: null },
                    { label: 'Reunião agendada', value: selectedConv.tagType === 'success', positive: true },
                  ].map((indicator, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-lg border border-[#E5E7EB] flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] ${
                        indicator.value 
                          ? (indicator.positive !== false ? 'bg-[#ECFDF3] text-[#039855]' : 'bg-[#FFFAEB] text-[#B54708]')
                          : 'bg-[#F1F3F6] text-[#64748B]'
                      }`}>
                        {indicator.value ? (indicator.positive !== false ? '✓' : '⚠') : '—'}
                      </div>
                      <span className="text-[12.5px] text-[#0F172A] font-medium">{indicator.label}</span>
                      <span className={`ml-auto text-[11px] font-semibold ${
                        indicator.value ? 'text-[#039855]' : 'text-[#64748B]'
                      }`}>
                        {indicator.value ? 'Sim' : 'Não'}
                      </span>
                    </div>
                  ))}
                </div>

                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-3">
                  Pré-qualificação de Saúde
                </h4>
                {selectedConv.details.healthProfile ? (
                  <div className="bg-white p-[12px_14px] rounded-lg border border-[#E5E7EB] grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-x-3 gap-y-[5px] text-[12.5px] mb-4">
                    <dt className="text-[#64748B]">Fumante</dt>
                    <dd className="text-[#0F172A] font-medium">
                      {selectedConv.details.healthProfile.smoker === true ? '🚬 Sim' : 
                       selectedConv.details.healthProfile.smoker === false ? '✅ Não' : '—'}
                    </dd>
                    <dt className="text-[#64748B]">Atividade física</dt>
                    <dd className="text-[#0F172A] font-medium">{selectedConv.details.healthProfile.physicalActivity || '—'}</dd>
                    <dt className="text-[#64748B]">IMC</dt>
                    <dd className="text-[#0F172A] font-medium font-mono">
                      {selectedConv.details.healthProfile.bmiCalculated 
                        ? selectedConv.details.healthProfile.bmiCalculated.toFixed(1) 
                        : '—'}
                    </dd>
                    <dt className="text-[#64748B]">Doenças pré-existentes</dt>
                    <dd className="text-[#0F172A] font-medium">{selectedConv.details.healthProfile.preExistingDiseases || '—'}</dd>
                    <dt className="text-[#64748B]">Medicação contínua</dt>
                    <dd className="text-[#0F172A] font-medium">{selectedConv.details.healthProfile.continuousMedication || '—'}</dd>
                    <dt className="text-[#64748B]">Categoria de risco</dt>
                    <dd className={`font-bold ${
                      selectedConv.details.healthProfile.riskCategory === 'low' ? 'text-[#039855]' :
                      selectedConv.details.healthProfile.riskCategory === 'medium' ? 'text-[#A56B0A]' :
                      selectedConv.details.healthProfile.riskCategory === 'high' ? 'text-[#D92D20]' : 'text-[#0F172A]'
                    }`}>{selectedConv.details.healthProfile.riskCategory || '—'}</dd>
                    {selectedConv.details.healthProfile.estimatedPremiumMinCents && (
                      <>
                        <dt className="text-[#64748B]">Prêmio estimado</dt>
                        <dd className="text-[#0F172A] font-medium font-mono">
                          R$ {(selectedConv.details.healthProfile.estimatedPremiumMinCents / 100).toFixed(0)}
                          {selectedConv.details.healthProfile.estimatedPremiumMaxCents && 
                            ` – R$ ${(selectedConv.details.healthProfile.estimatedPremiumMaxCents / 100).toFixed(0)}`
                          }/mês
                        </dd>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="bg-white p-4 rounded-lg border border-[#E5E7EB] text-center mb-4">
                    <div className="text-[24px] mb-2">🏥</div>
                    <p className="text-[12.5px] text-[#475569] font-medium">Dados de saúde ainda não coletados</p>
                    <p className="text-[11px] text-[#64748B] mt-1">
                      A pré-qualificação será preenchida durante a conversa com o lead.
                    </p>
                  </div>
                )}

                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-3">
                  Temperatura do Lead
                </h4>
                <div className="bg-white p-4 rounded-lg border border-[#E5E7EB]">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="text-[24px]">
                      {selectedConv.fitScore >= 8 ? '🔥' : selectedConv.fitScore >= 5 ? '🌡️' : '❄️'}
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[#0F172A]">
                        {selectedConv.fitScore >= 8 ? 'Quente — Alto potencial' :
                         selectedConv.fitScore >= 5 ? 'Morno — Potencial moderado' : 'Frio — Baixo potencial'}
                      </div>
                      <div className="text-[11px] text-[#475569]">
                        Fit Score {selectedConv.fitScore}/10 · {selectedConv.details.priority === 'high' ? 'Prioridade alta' : 'Prioridade normal'}
                      </div>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-[#F1F3F6] rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${
                        selectedConv.fitScore >= 8 ? 'bg-[#039855]' : selectedConv.fitScore >= 5 ? 'bg-[#E8981C]' : 'bg-[#64748B]'
                      }`}
                      style={{ width: `${(selectedConv.fitScore / 10) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* Histórico pane — real events from API */
              <div className="flex-1 overflow-y-auto p-5" style={{ background: '#F7F8FA' }}>
                <h4 className="text-[11px] uppercase tracking-wider text-[#64748B] font-semibold mb-3">
                  Timeline de Eventos
                </h4>

                {(() => {
                  // Map event types to readable labels
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

                  // Combine API events with base fallback events  
                  const allEvents = leadEvents.length > 0
                    ? leadEvents
                    : selectedConv.details.logs.map((log, i) => ({
                        id: `fallback-${i}`,
                        eventType: i === 0 ? 'lead_captured' : 'conversation_started',
                        payload: null,
                        createdAt: log.time,
                      }));

                  return (
                    <>
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

                        {/* Live AI indicator */}
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

                      {allEvents.length === 0 && !selectedConv.aiHandling && (
                        <div className="text-center py-8 text-[12px] text-[#64748B]">
                          Nenhum evento registrado ainda.
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Drawer footer - action buttons (prototype style) */}
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
                Assumir
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

      {/* ── Outcome closed modal ────────────────────────────────────────── */}
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
