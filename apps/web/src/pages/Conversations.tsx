import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, toast } from '@prospix/ui';
import { MessageSquare, Send, Bot, User, Phone, ChevronRight, Filter, ArrowUpDown, LayoutList, Columns3, X, Award, Clock } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { AxiosError } from 'axios';

import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { useAuthStore } from '../store/auth-store';

interface Message {
  id: string;
  sender: 'lead' | 'ai' | 'agent';
  content: string;
  timestamp: string;
}

interface Conversation {
  id: string;
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
  tagType?: 'success' | 'live' | 'warning' | 'info';
  tagLabel?: string;
  whenLabel?: string;
  whenUrgent?: boolean;
  details: {
    phone: string;
    city: string;
    faturamento: string;
    susep: string;
    company: string;
    health: string;
    priority: 'high' | 'medium' | 'low';
    tags: string[];
    logs: Array<{ action: string; time: string }>;
  };
}

// Avatar color classes matching prototype
const AVATAR_COLORS = [
  '#1B3A6B', '#5A2A82', '#B8740E', '#075E54', '#9E2A2B', '#1F4E5F', '#374151',
];

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
  const [outcomeValue, setOutcomeValue] = useState('');
  const [outcomeCommission, setOutcomeCommission] = useState('');
  const [drawerTab, setDrawerTab] = useState<'chat' | 'info'>('chat');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper to map DB Conversation to Web Frontend UI type
  const mapBackendConversation = (conv: any, index?: number): Conversation => {
    const lead = conv.lead || {};
    const city = lead.address?.city || 'São Paulo - SP';
    const metadata = lead.metadata || {};
    const name = lead.name || 'Sem nome';
    const idx = index ?? 0;
    return {
      id: conv.id,
      leadName: name,
      aiHandling: conv.aiHandling,
      lastMessage: conv.lastMessage || 'Nenhuma mensagem recebida.',
      timestamp: conv.lastMessageAt 
        ? new Date(conv.lastMessageAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
        : new Date(conv.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      fitScore: Number(lead.fitScore) || 5.0,
      unread: conv.status === 'ACTIVE' && !conv.lastOutboundAt,
      meetingId: conv.meetings?.[0]?.id,
      initials: getInitials(name),
      avatarColor: getAvatarColor(idx),
      profession: metadata.profession || lead.tags?.join(' · ') || '',
      tagType: conv.meetings?.[0] ? 'success' : conv.aiHandling ? 'live' : undefined,
      tagLabel: conv.meetings?.[0] ? '✓ Agendada' : conv.aiHandling ? 'IA respondendo' : undefined,
      whenLabel: conv.lastMessageAt 
        ? new Date(conv.lastMessageAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
        : new Date(conv.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      details: {
        phone: lead.whatsapp || '',
        city: city,
        faturamento: metadata.faturamento || 'N/A',
        susep: lead.registrationNumber || 'N/A',
        company: metadata.company || 'N/A',
        health: metadata.health || 'Estável',
        priority: lead.fitScore >= 8.5 ? 'high' : lead.fitScore >= 6.0 ? 'medium' : 'low',
        tags: lead.tags || [],
        logs: [
          { action: 'Lead capturado', time: new Date(lead.createdAt).toLocaleString('pt-BR') },
          { action: 'Campanha iniciada', time: new Date(conv.startedAt).toLocaleString('pt-BR') }
        ]
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
      timestamp: new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
  };

  // 1. Fetch Conversations from backend API
  const fetchConversations = async (silent = false) => {
    try {
      const response = await apiClient.get('/tenant/conversations');
      const list = response.data;
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
        if (!silent) toast.error('Erro de Conexão', 'Não foi possível carregar as conversas.');
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
    if (!selectedConv) return;

    const fetchMessages = async () => {
      try {
        const response = await apiClient.get(`/tenant/conversations/${selectedConv.id}/messages`);
        const list = response.data || [];
        setMessages(list.map(mapBackendMessage));
      } catch (error) {
        console.error('Error fetching messages:', error);
        toast.error('Erro de sincronização', 'Não foi possível carregar as novas mensagens do servidor.');
      }
    };

    fetchMessages();
  }, [selectedConv]);

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

  const handleTakeover = async () => {
    if (!selectedConv) return;
    
    const updated = { ...selectedConv, aiHandling: false };
    setSelectedConv(updated);
    setConversations(conversations.map(c => c.id === selectedConv.id ? updated : c));

    if (selectedConv.id.startsWith('conv-')) {
      toast.success('Controle Manual Ativo', 'A IA foi desativada temporariamente. Você está no controle da conversa.');
      return;
    }

    try {
      await apiClient.patch(`/tenant/conversations/${selectedConv.id}`, {
        aiHandling: false,
      });
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
      const response = await apiClient.post(`/tenant/conversations/${selectedConv.id}/messages`, {
        content: userMsgContent,
      });
      const savedMsg = mapBackendMessage(response.data);
      setMessages(prev => prev.map(m => m.id === tempId ? savedMsg : m));
    } catch (err: unknown) {
      console.error('Error sending message:', err);
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao enviar a mensagem pelo gateway WhatsApp.'
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
      if (!meetingId) {
        const meetingsResponse = await apiClient.get('/tenant/meetings');
        const meetings = meetingsResponse.data?.data || [];
        meetingId = meetings.find((meeting: any) => meeting.conversationId === selectedConv.id)?.id;
      }

      if (!meetingId) {
        throw new Error('Meeting not found for selected conversation');
      }

      await apiClient.patch(`/tenant/meetings/${meetingId}`, {
        outcome: 'CLOSED',
        policy_value_cents: Math.floor(parseFloat(outcomeValue) * 100),
        commission_cents: Math.floor(parseFloat(outcomeCommission) * 100),
      });

      toast.success('Venda Registrada!', 'Parabéns pela apólice fechada! Faturamento cadastrado com sucesso.');
      setIsOutcomeModalOpen(false);
      setOutcomeValue('');
      setOutcomeCommission('');
    } catch {
      toast.error('Erro ao registrar', 'Tente novamente ou verifique os valores.');
    }
  };

  // Computed counts for toolbar
  const totalCount = conversations.length || 89;
  const hotCount = conversations.filter(c => c.fitScore >= 9.0).length || 12;
  const waitCount = conversations.filter(c => c.tagType === 'warning' || c.unread).length || 3;
  const scheduledCount = conversations.filter(c => c.tagType === 'success').length || 23;

  // Filtered conversations
  const filteredConversations = conversations.filter(c => {
    switch (activeFilter) {
      case 'hot': return c.fitScore >= 9.0;
      case 'wait': return c.tagType === 'warning' || c.unread;
      case 'scheduled': return c.tagType === 'success';
      default: return true;
    }
  });

  const handleSelectConv = (conv: Conversation) => {
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
      return (
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-[7px] py-[2px] rounded-[10px] bg-[rgba(232,152,28,0.14)] text-[#A56B0A] whitespace-nowrap">
          <span className="w-[5px] h-[5px] rounded-full bg-[#E8981C] animate-pulse" />
          {conv.tagLabel}
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

        <button
          onClick={() => toast.info('Filtro de profissão', 'Em breve!')}
          className="h-8 px-[11px] rounded-md text-xs font-medium text-[#475569] bg-transparent border border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A] inline-flex items-center gap-1.5 transition-all"
        >
          <Filter className="w-[13px] h-[13px]" />
          Profissão
        </button>
        <button
          onClick={() => toast.info('Ordenação', 'Ordenado por Fit Score')}
          className="h-8 px-[11px] rounded-md text-xs font-medium text-[#475569] bg-transparent border border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#0F172A] inline-flex items-center gap-1.5 transition-all"
        >
          <ArrowUpDown className="w-[13px] h-[13px]" />
          Ordenar
        </button>

        {/* View toggle */}
        <div className="flex bg-[#F1F3F6] rounded-md p-[2px] ml-auto">
          <button className="h-7 px-[11px] text-xs font-medium rounded text-[#1B3A6B] bg-white shadow-sm inline-flex items-center gap-[5px]">
            <LayoutList className="w-[13px] h-[13px]" />
            Tabela
          </button>
          <button className="h-7 px-[11px] text-xs font-medium rounded text-[#475569] inline-flex items-center gap-[5px]">
            <Columns3 className="w-[13px] h-[13px]" />
            Kanban
          </button>
        </div>
      </div>

      {/* ── Panel with lead rows ────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
        {/* Panel header */}
        <div className="px-[18px] py-[14px] border-b border-[#EEF0F3] flex items-center justify-between gap-[10px]">
          <div>
            <div className="text-sm font-semibold text-[#0F172A] flex items-center gap-[7px]">
              Todas as conversas ativas
            </div>
            <div className="text-[11.5px] text-[#94A3B8] mt-[3px]">
              {filteredConversations.length} leads em diálogo · ordenadas por temperatura
            </div>
          </div>
          <span className="text-[10.5px] font-semibold px-2 py-[2px] rounded-[10px] bg-[rgba(232,152,28,0.14)] text-[#A56B0A] inline-flex items-center gap-[5px]">
            <span className="w-[5px] h-[5px] rounded-full bg-[#E8981C] animate-pulse" />
            {filteredConversations.length} ao vivo
          </span>
        </div>

        {/* Lead rows */}
        <div>
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <MessageSquare className="w-12 h-12 text-[#94A3B8]/40" />
              <p className="text-sm text-[#475569] font-medium">Nenhuma conversa encontrada</p>
              <p className="text-xs text-[#94A3B8]">Ajuste os filtros ou aguarde novas conversas.</p>
            </div>
          ) : (
            filteredConversations.map((conv, idx) => (
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
                  <div className="text-[11px] text-[#94A3B8] mt-[2px]">
                    Fit {conv.fitScore}
                  </div>
                </div>

                {/* Chevron action */}
                <div className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-lg transition-all ${
                  selectedConv?.id === conv.id 
                    ? 'bg-[#1B3A6B] text-white' 
                    : 'bg-[#F1F3F6] text-[#94A3B8]'
                }`}>
                  <ChevronRight className="w-[13px] h-[13px]" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Lead Detail Drawer ──────────────────────────────────────────── */}
      {selectedConv && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-[rgba(15,23,42,0.5)] z-[88] transition-opacity duration-300"
            onClick={() => setSelectedConv(null)}
          />
          {/* Drawer */}
          <div className="fixed top-0 right-0 h-screen w-full sm:w-[580px] sm:max-w-[90vw] bg-white shadow-xl z-[89] flex flex-col overflow-hidden animate-slideIn">
            {/* Drawer header */}
            <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center gap-[13px] shrink-0">
              <div
                className="w-[42px] h-[42px] rounded-full text-white flex items-center justify-center text-sm font-bold shrink-0"
                style={{ backgroundColor: selectedConv.avatarColor || getAvatarColor(0) }}
              >
                {selectedConv.initials || getInitials(selectedConv.leadName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold text-[#0F172A]">{selectedConv.leadName}</div>
                <div className="text-xs text-[#94A3B8] mt-[2px]">
                  {selectedConv.profession || selectedConv.details.company} · Fit {selectedConv.fitScore}
                </div>
              </div>
              <button
                onClick={() => setSelectedConv(null)}
                className="ml-auto w-8 h-8 rounded-lg bg-[#F1F3F6] text-[#475569] flex items-center justify-center hover:bg-[#FEF3F2] hover:text-[#D92D20] transition-all"
              >
                <X className="w-[15px] h-[15px]" />
              </button>
            </div>

            {/* Drawer tabs */}
            <div className="flex px-4 bg-white border-b border-[#E5E7EB] shrink-0 gap-[2px]">
              <button
                onClick={() => setDrawerTab('chat')}
                className={`px-[13px] py-[10px] text-[12.5px] font-medium border-b-2 whitespace-nowrap transition-all ${
                  drawerTab === 'chat'
                    ? 'text-[#1B3A6B] border-[#1B3A6B] font-semibold'
                    : 'text-[#475569] border-transparent hover:text-[#0F172A]'
                }`}
              >
                💬 Conversa
              </button>
              <button
                onClick={() => setDrawerTab('info')}
                className={`px-[13px] py-[10px] text-[12.5px] font-medium border-b-2 whitespace-nowrap transition-all ${
                  drawerTab === 'info'
                    ? 'text-[#1B3A6B] border-[#1B3A6B] font-semibold'
                    : 'text-[#475569] border-transparent hover:text-[#0F172A]'
                }`}
              >
                📋 Ficha
              </button>
            </div>

            {/* Drawer panes */}
            {drawerTab === 'chat' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Chat messages (WhatsApp style) */}
                <div className="flex-1 p-[14px] overflow-y-auto flex flex-col gap-[9px]" style={{ background: '#ECE5DD' }}>
                  <div className="self-center text-[10.5px] text-[#94A3B8] bg-white/85 px-[9px] py-[3px] rounded-[10px]">
                    Hoje
                  </div>
                  {messages.map((msg) => {
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
                        <div className="text-[9.5px] text-[#94A3B8] text-right mt-[3px] font-mono">
                          {msg.timestamp}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* AI control or message input */}
                {selectedConv.aiHandling ? (
                  <div className="p-3 bg-[rgba(27,58,107,0.04)] border-t border-[rgba(27,58,107,0.12)] flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] rounded-lg">
                        <Bot className="w-4 h-4 animate-pulse" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-[#0F172A]">IA conduzindo conversa</p>
                        <p className="text-[10px] text-[#475569]">A IA está respondendo no WhatsApp agora.</p>
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
                      className="flex-1 bg-white border-[#E5E7EB] text-xs focus:border-[#1B3A6B] h-[38px] text-[#0F172A] placeholder-[#94A3B8]"
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
            ) : (
              /* Info pane */
              <div className="flex-1 overflow-y-auto p-5" style={{ background: '#F7F8FA' }}>
                <h4 className="text-[11px] uppercase tracking-wider text-[#94A3B8] font-semibold mb-2">
                  Dados do Lead
                </h4>
                <div className="bg-white p-[12px_14px] rounded-lg border border-[#E5E7EB] grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-x-3 gap-y-[5px] text-[12.5px] mb-4">
                  <dt className="text-[#94A3B8]">Nome</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.leadName}</dd>
                  <dt className="text-[#94A3B8]">Telefone</dt>
                  <dd className="text-[#0F172A] font-medium font-mono">{selectedConv.details.phone}</dd>
                  <dt className="text-[#94A3B8]">Cidade</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.details.city}</dd>
                  <dt className="text-[#94A3B8]">Profissão</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.profession || 'N/A'}</dd>
                  <dt className="text-[#94A3B8]">Empresa</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.details.company}</dd>
                  <dt className="text-[#94A3B8]">Registro</dt>
                  <dd className="text-[#0F172A] font-medium">{selectedConv.details.susep}</dd>
                  <dt className="text-[#94A3B8]">Fit Score</dt>
                  <dd className="text-[#A56B0A] font-bold font-mono">{selectedConv.fitScore}</dd>
                </div>

                <h4 className="text-[11px] uppercase tracking-wider text-[#94A3B8] font-semibold mb-2 mt-4">
                  Tags
                </h4>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selectedConv.details.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] bg-[#F1F3F6] text-[#475569] border border-[#E5E7EB] px-2 py-0.5 rounded-full font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <h4 className="text-[11px] uppercase tracking-wider text-[#94A3B8] font-semibold mb-2 mt-4">
                  Histórico
                </h4>
                <div className="relative border-l-2 border-[#E5E7EB] pl-4 space-y-3">
                  {selectedConv.details.logs.map((log, idx) => (
                    <div key={idx} className="relative text-xs">
                      <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#E5E7EB]" />
                      <p className="text-[#0F172A] font-medium">{log.action}</p>
                      <span className="text-[9px] text-[#94A3B8] font-mono flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {log.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Drawer footer - action buttons */}
            <div className="px-4 py-3 border-t border-[#E5E7EB] bg-white flex gap-[6px] shrink-0 flex-wrap">
              <button
                onClick={handleTakeover}
                className="flex-1 min-w-[120px] h-[38px] rounded-lg text-xs font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] inline-flex items-center justify-center gap-1.5 transition-all"
              >
                <User className="w-[13px] h-[13px]" />
                Assumir
              </button>
              <button
                onClick={() => toast.info('Ligação', 'Funcionalidade em breve!')}
                className="flex-1 min-w-[120px] h-[38px] rounded-lg text-xs font-semibold bg-[#F1F3F6] text-[#0F172A] hover:bg-[#E5E7EB] inline-flex items-center justify-center gap-1.5 transition-all"
              >
                <Phone className="w-[13px] h-[13px]" />
                Ligar
              </button>
              <button
                onClick={() => setIsOutcomeModalOpen(true)}
                className="flex-1 min-w-[120px] h-[38px] rounded-lg text-xs font-semibold bg-[#039855] text-white hover:bg-[#027A48] inline-flex items-center justify-center gap-1.5 transition-all"
              >
                <Award className="w-[13px] h-[13px]" />
                Marcar resultado
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
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#94A3B8] font-mono">R$</span>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={outcomeValue}
                    onChange={(e) => setOutcomeValue(e.target.value)}
                    className="pl-9 bg-white border-[#D0D5DD] text-[#0F172A] placeholder-[#94A3B8] text-xs focus:border-[#1B3A6B] h-9 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12.5px] font-semibold text-[#0F172A] mb-[5px]">
                  Comissão Estimada Ganha
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#94A3B8] font-mono">R$</span>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={outcomeCommission}
                    onChange={(e) => setOutcomeCommission(e.target.value)}
                    className="pl-9 bg-white border-[#D0D5DD] text-[#0F172A] placeholder-[#94A3B8] text-xs focus:border-[#1B3A6B] h-9 font-mono"
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
