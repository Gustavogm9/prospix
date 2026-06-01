'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { MessageSquare, RefreshCw, Loader2, Search, Bot, ChevronDown, ChevronUp } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';

interface ConversationItem {
  id: string;
  tenantId: string;
  tenant: { id: string; name: string; slug: string } | null;
  lead: { id: string; name: string; whatsapp: string; email: string | null } | null;
  status: string;
  aiHandlingEnabled: boolean;
  messageCount: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  startedAt: string;
  updatedAt: string;
  recentMessages: { id: string; direction: string; sender: string; content: string; deliveryStatus: string; createdAt: string }[];
}

interface Stats {
  totalAll: number;
  totalToday: number;
  totalWeek: number;
  totalMonth: number;
  activeAI: number;
  escalated: number;
  topTenants: { tenantId: string; tenantName: string; count: number }[];
}

interface Pagination { total: number; limit: number; offset: number; hasMore: boolean; }

const PAGE_SIZE = 30;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-success-soft text-success-text border-success/30',
  PAUSED: 'bg-amber-50 text-amber-700 border-amber-200',
  ESCALATED: 'bg-red-50 text-red-700 border-red-200',
  CLOSED: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function Conversations() {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterAI, setFilterAI] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchConversations = async (newOffset = 0) => {
    setIsLoading(true);
    try {
      // ── Build conversation query ──
      let query = supabaseAdmin
        .from('conversations')
        .select('*, leads(id, name, whatsapp, email), tenants(id, name, slug)', { count: 'exact' })
        .order('started_at', { ascending: false })
        .range(newOffset, newOffset + PAGE_SIZE - 1);

      if (filterStatus !== 'all') query = query.eq('status', filterStatus);
      if (filterAI === 'true') query = query.eq('ai_handling', true);
      if (searchTerm.trim()) {
        // Search by lead name – need to use a textSearch or filter on the joined lead
        // Supabase doesn't support .ilike on nested joins easily, so we do a sub-query approach
        const { data: matchingLeads } = await supabaseAdmin
          .from('leads')
          .select('id')
          .or(`name.ilike.%${searchTerm.trim()}%,whatsapp.ilike.%${searchTerm.trim()}%`)
          .limit(200);
        const leadIds = (matchingLeads ?? []).map((l: any) => l.id);
        if (leadIds.length === 0) {
          setItems([]);
          setPagination({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
          setIsLoading(false);
          // Still fetch stats
          await fetchStats();
          return;
        }
        query = query.in('lead_id', leadIds);
      }

      const { data: convRows, count, error } = await query;
      if (error) throw error;

      // Fetch recent messages for each conversation (last 5 each)
      const convIds = (convRows ?? []).map((c: any) => c.id);
      let messagesMap: Record<string, any[]> = {};
      if (convIds.length > 0) {
        const { data: msgs } = await supabaseAdmin
          .from('messages')
          .select('id, conversation_id, direction, sender, content, delivery_status, created_at')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false })
          .limit(convIds.length * 5);

        (msgs ?? []).forEach((m: any) => {
          if (!messagesMap[m.conversation_id]) messagesMap[m.conversation_id] = [];
          if (messagesMap[m.conversation_id]!.length < 5) {
            messagesMap[m.conversation_id]!.push(m);
          }
        });
      }

      const mapped: ConversationItem[] = (convRows ?? []).map((c: any) => ({
        id: c.id,
        tenantId: c.tenant_id,
        tenant: c.tenants ? { id: c.tenants.id ?? c.tenant_id, name: c.tenants.name, slug: c.tenants.slug } : null,
        lead: c.leads ? { id: c.leads.id ?? c.lead_id, name: c.leads.name, whatsapp: c.leads.whatsapp, email: c.leads.email } : null,
        status: c.status,
        aiHandlingEnabled: c.ai_handling,
        messageCount: c.message_count,
        lastInboundAt: c.last_inbound_at,
        lastOutboundAt: c.last_outbound_at,
        startedAt: c.started_at,
        updatedAt: c.last_message_at ?? c.started_at,
        recentMessages: (messagesMap[c.id] ?? []).reverse().map((m: any) => ({
          id: m.id,
          direction: m.direction,
          sender: m.sender,
          content: m.content,
          deliveryStatus: m.delivery_status ?? '',
          createdAt: m.created_at,
        })),
      }));

      const total = count ?? 0;
      setItems(mapped);
      setPagination({ total, limit: PAGE_SIZE, offset: newOffset, hasMore: newOffset + PAGE_SIZE < total });

      // ── Compute stats client-side ──
      await fetchStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar conversas.';
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { data: allConvs } = await supabaseAdmin
        .from('conversations')
        .select('id, status, ai_handling, tenant_id, started_at, tenants(name)');

      const rows = allConvs ?? [];
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const totalToday = rows.filter((c: any) => c.started_at >= todayStart).length;
      const totalWeek = rows.filter((c: any) => c.started_at >= weekAgo).length;
      const totalMonth = rows.filter((c: any) => c.started_at >= monthStart).length;
      const activeAI = rows.filter((c: any) => c.status === 'ACTIVE' && c.ai_handling).length;
      const escalated = rows.filter((c: any) => c.status === 'ESCALATED').length;

      // Top tenants
      const tenantCounts: Record<string, { name: string; count: number }> = {};
      rows.forEach((c: any) => {
        const tid = c.tenant_id;
        const tname = (c.tenants as any)?.name ?? 'Unknown';
        if (!tenantCounts[tid]) tenantCounts[tid] = { name: tname, count: 0 };
        tenantCounts[tid].count++;
      });
      const topTenants = Object.entries(tenantCounts)
        .map(([tenantId, v]) => ({ tenantId, tenantName: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setStats({
        totalAll: rows.length,
        totalToday,
        totalWeek,
        totalMonth,
        activeAI,
        escalated,
        topTenants,
      });
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    fetchConversations(0);
  }, [filterStatus, filterAI]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchConversations(0), 400);
    return () => clearTimeout(timeout);
  }, [searchTerm]);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" aria-hidden />
            Monitoramento de Conversas IA
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Visão cross-tenant de todas as conversas · AI handling · escalações · qualidade
          </p>
        </div>
        <Button onClick={() => fetchConversations(pagination.offset)} disabled={isLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-white shadow-sm border-border">
            <CardContent className="pt-4 pb-3">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Conversas Hoje</span>
              <span className="text-2xl font-bold font-heading font-mono text-text">{stats.totalToday}</span>
            </CardContent>
          </Card>
          <Card className={`bg-white shadow-sm ${stats.activeAI > 0 ? 'border-blue-300' : 'border-border'}`}>
            <CardContent className="pt-4 pb-3">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">IA Ativa</span>
              <span className="text-2xl font-bold font-heading font-mono text-blue-700">{stats.activeAI}</span>
            </CardContent>
          </Card>
          <Card className={`bg-white shadow-sm ${stats.escalated > 0 ? 'border-red-300' : 'border-border'}`}>
            <CardContent className="pt-4 pb-3">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Escaladas</span>
              <span className={`text-2xl font-bold font-heading font-mono ${stats.escalated > 0 ? 'text-error-text' : 'text-text'}`}>{stats.escalated}</span>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-sm border-border">
            <CardContent className="pt-4 pb-3">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total (Mês)</span>
              <span className="text-2xl font-bold font-heading font-mono text-text">{stats.totalMonth.toLocaleString('pt-BR')}</span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Tenants */}
      {stats && stats.topTenants.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-3 pb-3">
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-2">Top 5 Tenants (volume)</span>
            <div className="flex flex-wrap gap-2">
              {stats.topTenants.map((t) => (
                <Badge key={t.tenantId} className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-2 py-0.5 border">
                  {t.tenantName}: {t.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar por lead..." className="w-full pl-9 pr-3 h-9 text-xs rounded-lg border border-border bg-white text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
            </div>
            <div className="flex gap-1.5">
              {(['all', 'ACTIVE', 'ESCALATED', 'PAUSED', 'CLOSED'] as const).map((s) => (
                <Button key={s} onClick={() => setFilterStatus(s)} className={`text-[10px] px-3 h-8 rounded-lg ${filterStatus === s ? 'bg-primary text-white' : 'bg-white text-text border border-border hover:bg-surface-sunken'}`}>
                  {s === 'all' ? 'Todos' : s}
                </Button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Button onClick={() => setFilterAI(filterAI === 'true' ? 'all' : 'true')} className={`text-[10px] px-3 h-8 rounded-lg flex items-center gap-1 ${filterAI === 'true' ? 'bg-blue-600 text-white' : 'bg-white text-text border border-border hover:bg-surface-sunken'}`}>
                <Bot className="w-3 h-3" /> Só IA
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversation List */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Conversas</CardTitle>
          <CardDescription className="text-text-secondary text-xs">{pagination.total} total</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-secondary" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <MessageSquare className="w-6 h-6 text-text-secondary mx-auto mb-2" />
              <p className="text-sm font-semibold text-text">Nenhuma conversa encontrada.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((conv) => (
                <div key={conv.id} className="p-3 rounded-lg border border-border/50 hover:border-border transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className={`text-[9px] px-1.5 py-0 border ${STATUS_STYLES[conv.status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>{conv.status}</Badge>
                        {conv.aiHandlingEnabled && <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[9px] px-1.5 py-0 border flex items-center gap-0.5"><Bot className="w-2.5 h-2.5" /> IA</Badge>}
                        {conv.tenant && <Link href={`/admin/tenants/${conv.tenant.id}`} className="text-[10px] font-semibold text-text hover:underline">{conv.tenant.name}</Link>}
                      </div>
                      <div className="text-xs font-semibold text-text">{conv.lead?.name ?? 'Lead sem nome'}</div>
                      <div className="text-[10px] text-text-secondary font-mono">{conv.lead?.whatsapp ?? '—'}</div>
                      <div className="text-[10px] text-text-secondary mt-1">
                        {conv.messageCount} msgs · Última atividade: {new Date(conv.updatedAt).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <button onClick={() => setExpandedId(expandedId === conv.id ? null : conv.id)} className="text-text-secondary hover:text-text p-1">
                      {expandedId === conv.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                  
                  {expandedId === conv.id && conv.recentMessages.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
                      <span className="text-[9px] text-text-secondary uppercase tracking-wider font-semibold">Últimas mensagens</span>
                      {conv.recentMessages.map((msg) => (
                        <div key={msg.id} className={`flex gap-2 ${msg.direction === 'OUTBOUND' ? 'justify-end' : ''}`}>
                          <div className={`max-w-[70%] p-2 rounded-lg text-[11px] ${msg.direction === 'OUTBOUND' ? 'bg-primary/10 text-text' : 'bg-surface-sunken text-text'}`}>
                            <div className="flex items-center gap-1 mb-0.5">
                              <Badge className={`text-[8px] px-1 py-0 border ${msg.sender === 'AI' ? 'bg-blue-50 text-blue-700 border-blue-200' : msg.sender === 'USER' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>{msg.sender}</Badge>
                              <span className="text-[9px] text-text-secondary">{new Date(msg.createdAt).toLocaleTimeString('pt-BR')}</span>
                            </div>
                            <p className="leading-relaxed">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {pagination.total > PAGE_SIZE && (
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
              <span className="text-[10px] text-text-secondary">
                {pagination.offset + 1}–{Math.min(pagination.offset + PAGE_SIZE, pagination.total)} de {pagination.total}
              </span>
              <div className="flex gap-1.5">
                <Button onClick={() => fetchConversations(Math.max(0, pagination.offset - PAGE_SIZE))} disabled={pagination.offset === 0} className="text-[10px] px-3 h-7 rounded bg-white text-text border border-border">Anterior</Button>
                <Button onClick={() => fetchConversations(pagination.offset + PAGE_SIZE)} disabled={!pagination.hasMore} className="text-[10px] px-3 h-7 rounded bg-white text-text border border-border">Próximo</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
