import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Avatar, toast } from '@prospix/ui';
import { MessageSquare, Send, Bot, User, Phone, DollarSign, Award, Activity, Clock, ChevronLeft } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { canUseMockFallbacks } from '../lib/demo-mode';
import { supabase } from '../lib/supabase';
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

// Default high-fidelity mock conversations for new tenants without active campaigns
const mockConversations: Conversation[] = [
  {
    id: 'conv-1',
    leadName: 'Marcos de Oliveira',
    aiHandling: true,
    lastMessage: 'Quero agendar uma conversa para entender a apólice PME.',
    timestamp: '14:32',
    fitScore: 9.4,
    unread: true,
    details: {
      phone: '+55 11 98888-7777',
      city: 'São Paulo - SP',
      faturamento: 'R$ 150.000 / mês',
      susep: 'N/A (Cliente)',
      company: 'Oliveira Consultoria',
      health: 'Excelente',
      priority: 'high',
      tags: ['PME', 'Seguro de Vida', 'Decisor'],
      logs: [
        { action: 'Lead capturado no Maps', time: '2026-05-21 09:30' },
        { action: 'Primeiro contato IA (WhatsApp)', time: '2026-05-21 09:35' },
        { action: 'Resposta de interesse do Lead', time: '2026-05-21 14:30' },
      ],
    },
  },
  {
    id: 'conv-2',
    leadName: 'Ana Beatriz Reis',
    aiHandling: false,
    lastMessage: 'Acho que o preço está um pouco acima do planejado.',
    timestamp: 'Ontem',
    fitScore: 8.8,
    unread: false,
    details: {
      phone: '+55 21 97777-6666',
      city: 'Rio de Janeiro - RJ',
      faturamento: 'R$ 80.000 / mês',
      susep: 'N/A',
      company: 'Reis Arquitetura',
      health: 'Estável',
      priority: 'medium',
      tags: ['Auto Frota', 'Objeção de Preço'],
      logs: [
        { action: 'Lead capturado no Maps', time: '2026-05-20 10:15' },
        { action: 'Primeira mensagem enviada por IA', time: '2026-05-20 10:20' },
        { action: 'Agente assumiu conversa manualmente', time: '2026-05-20 15:40' },
      ],
    },
  },
];

const mockMessagesConv1: Message[] = [
  { id: '1', sender: 'ai', content: 'Olá Marcos, sou o assistente virtual da Prospix. Identifiquei que sua empresa Oliveira Consultoria pode economizar até 30% em planos de seguro saúde corporativo. Vocês já possuem algum plano ativo?', timestamp: '09:35' },
  { id: '2', sender: 'lead', content: 'Sim, temos a Bradesco Saúde hoje mas achamos caro.', timestamp: '14:28' },
  { id: '3', sender: 'ai', content: 'Entendo perfeitamente, o custo de sinistralidade tem subido bastante. Nós temos tabelas especiais com operadoras premium de excelente custo-benefício. Que tal agendarmos uma chamada rápida de 10 minutos amanhã às 14h para eu te apresentar uma cotação comparativa?', timestamp: '14:30' },
  { id: '4', sender: 'lead', content: 'Quero agendar uma conversa para entender a apólice PME.', timestamp: '14:32' },
];

const mockMessagesConv2: Message[] = [
  { id: '1', sender: 'ai', content: 'Olá Ana, tudo bem? Notei que a Reis Arquitetura tem ampliado sua frota de veículos comerciais. Gostaria de cotar um seguro frota unificado com condições especiais?', timestamp: '10:20' },
  { id: '2', sender: 'lead', content: 'Até me interessa, mas já cotamos uma vez e ficou muito caro.', timestamp: '14:50' },
  { id: '3', sender: 'agent', content: 'Olá Ana! Aqui é o Gustavo, corretor sênior. Entendo que o custo seja uma barreira. Consegui uma condição especial direto na seguradora Porto Seguro com 25% de desconto de frota para arquitetos credenciados. O que acha?', timestamp: '15:42' },
  { id: '4', sender: 'lead', content: 'Acho que o preço está um pouco acima do planejado.', timestamp: 'Ontem' },
];

export default function Conversations() {
  const { tenantId } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [activeTab, setActiveTab] = useState('conversa');
  const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
  const [outcomeValue, setOutcomeValue] = useState('');
  const [outcomeCommission, setOutcomeCommission] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper to map DB Conversation to Web Frontend UI type
  const mapBackendConversation = (conv: any): Conversation => {
    const lead = conv.lead || {};
    const city = lead.address?.city || 'São Paulo - SP';
    const metadata = lead.metadata || {};
    return {
      id: conv.id,
      leadName: lead.name || 'Sem nome',
      aiHandling: conv.aiHandling,
      lastMessage: conv.lastMessage || 'Nenhuma mensagem recebida.',
      timestamp: conv.lastMessageAt 
        ? new Date(conv.lastMessageAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
        : new Date(conv.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      fitScore: Number(lead.fitScore) || 5.0,
      unread: conv.status === 'ACTIVE' && !conv.lastOutboundAt,
      meetingId: conv.meetings?.[0]?.id,
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
        const mapped = list.map(mapBackendConversation);
        setConversations(mapped);
        if (!selectedConv) {
          setSelectedConv(mapped[0] || null);
        }
      } else if (canUseMockFallbacks) {
        setConversations(mockConversations);
        if (!selectedConv) {
          setSelectedConv(mockConversations[0] || null);
        }
      } else {
        setConversations([]);
        setSelectedConv(null);
      }
    } catch (error) {
      console.error('Error fetching real conversations:', error);
      if (!silent) {
        if (canUseMockFallbacks) {
          setConversations(mockConversations);
          if (!selectedConv) {
            setSelectedConv(mockConversations[0] || null);
          }
        } else {
          setConversations([]);
          setSelectedConv(null);
          toast.error('Erro de Conexão', 'Não foi possível carregar conversas reais da API.');
        }
      }
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  // 2. Fetch Messages for selected conversation
  useEffect(() => {
    if (!selectedConv) return;

    const fetchMessages = async () => {
      // Mock Fallback Check
      if (selectedConv.id.startsWith('conv-') && canUseMockFallbacks) {
        if (selectedConv.id === 'conv-1') {
          setMessages(mockMessagesConv1);
        } else {
          setMessages(mockMessagesConv2);
        }
        return;
      }

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

  // 3. Supabase Realtime Synchronization
  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase.channel(`tenant-${tenantId}-sync`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const newMsg = payload.new;
          if (selectedConv && newMsg.conversation_id === selectedConv.id) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, mapBackendMessage(newMsg)];
            });
          }

          setConversations(prev =>
            prev.map(c => {
              if (c.id === newMsg.conversation_id) {
                return {
                  ...c,
                  lastMessage: newMsg.content,
                  timestamp: new Date(newMsg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                  unread: selectedConv?.id !== c.id,
                };
              }
              return c;
            })
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenantId}` },
        () => {
          fetchConversations(true);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const updated = payload.new;
          setConversations(prev =>
            prev.map(c => {
              if (c.id === updated.id) {
                return {
                  ...c,
                  aiHandling: updated.ai_handling,
                };
              }
              return c;
            })
          );
          if (selectedConv && selectedConv.id === updated.id) {
            setSelectedConv(prev => prev ? { ...prev, aiHandling: updated.ai_handling } : null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, selectedConv?.id]);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleTakeover = async () => {
    if (!selectedConv) return;
    
    const updated = { ...selectedConv, aiHandling: false };
    setSelectedConv(updated);
    setConversations(conversations.map(c => c.id === selectedConv.id ? updated : c));

    if (selectedConv.id.startsWith('conv-') && canUseMockFallbacks) {
      toast.success('Controle Manual Ativo', 'A IA foi desativada temporariamente. Você está no controle da conversa.');
      return;
    }

    try {
      await apiClient.patch(`/tenant/conversations/${selectedConv.id}`, {
        aiHandling: false,
      });
      toast.success('Controle Manual Ativo', 'A IA foi desativada temporariamente. Você está no controle da conversa.');
    } catch (err) {
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

    if (selectedConv.id.startsWith('conv-') && canUseMockFallbacks) {
      return;
    }

    try {
      const response = await apiClient.post(`/tenant/conversations/${selectedConv.id}/messages`, {
        content: userMsgContent,
      });
      const savedMsg = mapBackendMessage(response.data);
      setMessages(prev => prev.map(m => m.id === tempId ? savedMsg : m));
    } catch (err: any) {
      console.error('Error sending message:', err);
      toast.error('Erro ao enviar', err.response?.data?.message || 'Falha ao enviar a mensagem pelo gateway WhatsApp.');
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };

  const handleOutcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv) return;

    try {
      if (selectedConv.id.startsWith('conv-') && canUseMockFallbacks) {
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
    } catch (error) {
      toast.error('Erro ao registrar', 'Tente novamente ou verifique os valores.');
    }
  };

  return (
    <div className="h-[calc(100vh-120px)] flex border border-border rounded-2xl overflow-hidden bg-white relative shadow-sm">
      {/* ── 1. Column: Conversation List (320px) ─────────────────────────── */}
      <div className={`w-full md:w-[320px] border-r border-border flex flex-col bg-white shrink-0 ${
        selectedConv ? 'hidden md:flex' : 'flex'
      }`}>
        <div className="p-4 border-b border-border/80 space-y-3">
          <h3 className="font-heading font-bold text-text text-sm">Mensagens</h3>
          <Input 
            placeholder="Filtrar por nome..." 
            className="w-full bg-white border-border h-9 text-xs focus:border-border-strong text-text placeholder-text-secondary" 
          />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setSelectedConv(conv)}
              className={`w-full text-left p-4 transition-all flex items-start gap-3 hover:bg-surface-sunken/60 ${
                selectedConv?.id === conv.id ? 'bg-primary-soft/40 border-l-2 border-primary' : ''
              }`}
            >
              <Avatar name={conv.leadName} className="w-9 h-9 shrink-0 text-xs font-semibold" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex justify-between items-center">
                  <span className={`text-xs font-bold leading-none truncate ${conv.unread ? 'text-text' : 'text-text-secondary'}`}>
                    {conv.leadName}
                  </span>
                  <span className="text-[10px] text-text-secondary/70 font-mono">{conv.timestamp}</span>
                </div>
                <p className="text-xs text-text-secondary/80 truncate">{conv.lastMessage}</p>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex gap-1.5">
                    {conv.aiHandling ? (
                      <Badge className="bg-primary-soft text-primary border border-primary/20 text-[9px] px-1.5 py-0">
                        IA no Leme
                      </Badge>
                    ) : (
                      <Badge className="bg-surface-sunken text-text-secondary border border-border/60 text-[9px] px-1.5 py-0">
                        Manual
                      </Badge>
                    )}
                  </div>
                  <span className="text-[9px] font-mono font-bold text-success-text">
                    {conv.fitScore} Fit
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── 2. Column: Active Chat Area ───────────────────────────────────── */}
      <div className={`flex-1 flex flex-col bg-surface-sunken min-w-0 ${
        selectedConv ? 'flex' : 'hidden md:flex'
      }`}>
        {selectedConv ? (
          <>
            {/* Chat Header */}
            <div className="h-[60px] border-b border-border flex items-center justify-between px-6 bg-white shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedConv(null)}
                  className="md:hidden p-1 mr-1 rounded-lg hover:bg-surface-sunken text-text-secondary"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <Avatar name={selectedConv.leadName} className="w-8 h-8 text-xs font-semibold" />
                <div>
                  <h4 className="text-xs font-bold text-text">{selectedConv.leadName}</h4>
                  <p className="text-[10px] text-text-secondary/70 leading-none mt-0.5">{selectedConv.details.phone}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setIsOutcomeModalOpen(true)}
                  className="bg-success hover:bg-success/90 text-white font-semibold text-[10px] h-7 px-3 rounded-lg flex items-center gap-1.5 shadow-lg shadow-success/10"
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>Marcar Venda</span>
                </Button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-white/40">
              {messages.map((msg) => {
                const isAgent = msg.sender === 'agent';
                const isAi = msg.sender === 'ai';
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 max-w-[85%] ${
                      isAgent || isAi ? 'ml-auto flex-row-reverse' : ''
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${
                      isAi ? 'bg-primary text-white' : isAgent ? 'bg-surface-sunken text-text-secondary' : 'bg-success text-white'
                    }`}>
                      {isAi ? <Bot className="w-3.5 h-3.5" /> : isAgent ? <User className="w-3.5 h-3.5" /> : 'L'}
                    </div>

                    <div className="space-y-1">
                      <div className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                        isAi 
                          ? 'bg-primary-soft text-primary border border-primary/20 rounded-tr-none' 
                          : isAgent 
                          ? 'bg-surface-sunken text-text border border-border rounded-tr-none shadow-sm' 
                          : 'bg-white text-text border border-border rounded-tl-none shadow-sm'
                      }`}>
                        {msg.content}
                      </div>
                      <p className={`text-[9px] text-text-secondary/50 font-mono ${isAgent || isAi ? 'text-right' : ''}`}>
                        {msg.timestamp}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* AI Control Banner / Takeover */}
            {selectedConv.aiHandling ? (
              <div className="p-4 bg-primary-soft/30 border-t border-primary/20 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-soft text-primary rounded-xl">
                    <Bot className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-text">Inteligência Artificial Ativa</p>
                    <p className="text-[10px] text-text-secondary">O robô está conduzindo a negociação no WhatsApp agora.</p>
                  </div>
                </div>
                <Button
                  onClick={handleTakeover}
                  className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs h-9 px-4 rounded-xl transition-all shadow-md shadow-primary/10"
                >
                  Assumir Conversa Manualmente
                </Button>
              </div>
            ) : (
              /* Message Input */
              <form onSubmit={handleSendMessage} className="p-4 border-t border-border bg-white shrink-0 flex gap-3">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Escreva sua mensagem profissional..."
                  className="flex-1 bg-white border-border text-xs focus:border-border-strong h-11 text-text placeholder-text-secondary"
                />
                <Button
                  type="submit"
                  className="bg-primary hover:bg-primary-hover text-white p-3 rounded-xl shadow-lg shadow-primary/10 w-11 h-11 flex items-center justify-center shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 bg-surface-sunken/40">
            <MessageSquare className="w-12 h-12 text-text-secondary/30" />
            <h4 className="text-text-secondary text-sm font-semibold">Nenhuma conversa selecionada</h4>
            <p className="text-xs text-text-secondary/70">Escolha uma conversa na lista lateral para iniciar.</p>
          </div>
        )}
      </div>

      {/* ── 3. Column: Right Details Drawer (280px) ──────────────────────── */}
      {selectedConv && (
        <div className="w-[280px] border-l border-border bg-white shrink-0 hidden xl:flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <div className="border-b border-border">
              <TabsList className="bg-transparent w-full flex justify-around rounded-none h-11 px-2 gap-1">
                <TabsTrigger value="conversa" className="text-[10px] font-semibold flex-1">Ficha</TabsTrigger>
                <TabsTrigger value="saude" className="text-[10px] font-semibold flex-1">Saúde</TabsTrigger>
                <TabsTrigger value="historico" className="text-[10px] font-semibold flex-1">Logs</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <TabsContent value="conversa" className="space-y-5 m-0">
                <div className="space-y-3">
                  <span className="text-[10px] font-semibold text-text-secondary/75 uppercase tracking-wider block">Lead Info</span>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2.5 text-xs">
                      <User className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                      <span className="text-text font-medium">{selectedConv.leadName}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs">
                      <Phone className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                      <span className="text-text-secondary font-mono">{selectedConv.details.phone}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs">
                      <DollarSign className="w-3.5 h-3.5 text-text-secondary shrink-0" />
                      <span className="text-text-secondary">{selectedConv.details.faturamento}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="text-[10px] font-semibold text-text-secondary/75 uppercase tracking-wider block">Empresa</span>
                  <p className="text-xs text-text bg-surface-sunken p-3 border border-border rounded-xl leading-snug">
                    {selectedConv.details.company} · {selectedConv.details.city}
                  </p>
                </div>

                <div className="space-y-2.5">
                  <span className="text-[10px] font-semibold text-text-secondary/75 uppercase tracking-wider block">Tags Operacionais</span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedConv.details.tags.map((tag) => (
                      <span key={tag} className="text-[10px] bg-surface-sunken text-text-secondary border border-border px-2 py-0.5 rounded-full font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="saude" className="space-y-5 m-0">
                <div className="space-y-3">
                  <span className="text-[10px] font-semibold text-text-secondary/75 uppercase tracking-wider block">Índice de Saúde</span>
                  <div className="p-4 rounded-xl bg-surface-sunken border border-border flex items-center gap-3">
                    <Activity className="w-5 h-5 text-success" />
                    <div>
                      <h5 className="text-xs font-bold text-text">Qualidade: {selectedConv.details.health}</h5>
                      <p className="text-[9px] text-text-secondary/80 leading-none mt-0.5">Sem objeções críticas no canal.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <span className="text-[10px] font-semibold text-text-secondary/75 uppercase tracking-wider block">Prioridade do Lead</span>
                  <Badge className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 border ${
                    selectedConv.details.priority === 'high' 
                      ? 'bg-red-50 text-red-600 border-red-200' 
                      : 'bg-surface-sunken text-text-secondary border-border'
                  }`}>
                    {selectedConv.details.priority === 'high' ? 'Alta' : 'Normal'}
                  </Badge>
                </div>
              </TabsContent>

              <TabsContent value="historico" className="space-y-4 m-0">
                <span className="text-[10px] font-semibold text-text-secondary/75 uppercase tracking-wider block">Histórico de Eventos</span>
                <div className="relative border-l border-border pl-4 space-y-4">
                  {selectedConv.details.logs.map((log, idx) => (
                    <div key={idx} className="relative text-xs">
                      <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-white border border-border" />
                      <p className="text-text font-medium leading-none mb-1">{log.action}</p>
                      <span className="text-[9px] text-text-secondary/65 font-mono flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {log.time}
                      </span>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}

      {/* ── Outcome closed modal ────────────────────────────────────────── */}
      {isOutcomeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-border rounded-2xl w-full max-w-[420px] p-6 space-y-5 shadow-2xl animate-scaleIn">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold font-heading text-text">Registrar Venda / Fechamento</h3>
                <p className="text-xs text-text-secondary leading-none mt-0.5">Parabéns pelo fechamento da apólice!</p>
              </div>
            </div>

            <form onSubmit={handleOutcomeSubmit} className="space-y-4">
              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                    Valor Estimado da Apólice (Anual)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-text-secondary/50 font-mono">R$</span>
                    <Input
                      type="number"
                      placeholder="0,00"
                      value={outcomeValue}
                      onChange={(e) => setOutcomeValue(e.target.value)}
                      className="pl-9 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                    Comissão Estimada Ganha
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-text-secondary/50 font-mono">R$</span>
                    <Input
                      type="number"
                      placeholder="0,00"
                      value={outcomeCommission}
                      onChange={(e) => setOutcomeCommission(e.target.value)}
                      className="pl-9 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setIsOutcomeModalOpen(false)}
                  variant="outline"
                  className="flex-1 border-border bg-white hover:bg-surface-sunken text-text-secondary h-10 rounded-xl font-bold"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-success hover:bg-success/90 text-white font-bold h-10 rounded-xl transition-all shadow-lg shadow-success/10"
                >
                  Confirmar Faturamento
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
