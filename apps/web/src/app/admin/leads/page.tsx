'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { Contact, RefreshCw, Loader2, Search, Download } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';

interface LeadItem {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
  status: string;
  source: string;
  profession: string | null;
  city: string | null;
  tenantId: string;
  tenant: { id: string; name: string; slug: string } | null;
  conversationCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  totalAll: number;
  newToday: number;
  newWeek: number;
  newMonth: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  topTenants: { tenantId: string; tenantName: string; count: number }[];
}

interface Pagination { total: number; limit: number; offset: number; hasMore: boolean; }

const PAGE_SIZE = 50;

const STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-blue-50 text-blue-700 border-blue-200',
  CONTACTED: 'bg-amber-50 text-amber-700 border-amber-200',
  QUALIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CONVERTED: 'bg-success-soft text-success-text border-success/30',
  LOST: 'bg-red-50 text-red-700 border-red-200',
  INACTIVE: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function LeadManagement() {
  const [items, setItems] = useState<LeadItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [exporting, setExporting] = useState(false);

  const fetchLeads = async (newOffset = 0) => {
    setIsLoading(true);
    try {
      // ── Build leads query ──
      let query = supabaseAdmin
        .from('leads')
        .select('*, tenants(id, name, slug)', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(newOffset, newOffset + PAGE_SIZE - 1);

      if (filterStatus !== 'all') query = query.eq('status', filterStatus);
      if (searchTerm.trim()) {
        query = query.or(`name.ilike.%${searchTerm.trim()}%,whatsapp.ilike.%${searchTerm.trim()}%,email.ilike.%${searchTerm.trim()}%`);
      }

      const { data: leadRows, count, error } = await query;
      if (error) throw error;

      // Get conversation counts for these leads
      const leadIds = (leadRows ?? []).map((l: any) => l.id);
      const convCountMap: Record<string, number> = {};
      if (leadIds.length > 0) {
        const { data: convs } = await supabaseAdmin
          .from('conversations')
          .select('lead_id')
          .in('lead_id', leadIds);
        (convs ?? []).forEach((c: any) => {
          convCountMap[c.lead_id] = (convCountMap[c.lead_id] || 0) + 1;
        });
      }

      const mapped: LeadItem[] = (leadRows ?? []).map((l: any) => ({
        id: l.id,
        name: l.name ?? 'Sem nome',
        whatsapp: l.whatsapp,
        email: l.email,
        status: l.status,
        source: l.source,
        profession: l.profession,
        city: l.address?.city ?? null,
        tenantId: l.tenant_id,
        tenant: l.tenants ? { id: l.tenants.id ?? l.tenant_id, name: l.tenants.name, slug: l.tenants.slug } : null,
        conversationCount: convCountMap[l.id] ?? 0,
        createdAt: l.created_at,
        updatedAt: l.updated_at,
      }));

      const total = count ?? 0;
      setItems(mapped);
      setPagination({ total, limit: PAGE_SIZE, offset: newOffset, hasMore: newOffset + PAGE_SIZE < total });

      // ── Compute stats client-side ──
      await fetchStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar leads.';
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { data: allLeads } = await supabaseAdmin
        .from('leads')
        .select('id, status, source, tenant_id, created_at, tenants(name)')
        .is('deleted_at', null);

      const rows = allLeads ?? [];
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const newToday = rows.filter((l: any) => l.created_at >= todayStart).length;
      const newWeek = rows.filter((l: any) => l.created_at >= weekAgo).length;
      const newMonth = rows.filter((l: any) => l.created_at >= monthStart).length;

      const byStatus: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      const tenantCounts: Record<string, { name: string; count: number }> = {};

      rows.forEach((l: any) => {
        byStatus[l.status] = (byStatus[l.status] || 0) + 1;
        bySource[l.source] = (bySource[l.source] || 0) + 1;
        const tid = l.tenant_id;
        const tname = (l.tenants as any)?.name ?? 'Unknown';
        if (!tenantCounts[tid]) tenantCounts[tid] = { name: tname, count: 0 };
        tenantCounts[tid].count++;
      });

      const topTenants = Object.entries(tenantCounts)
        .map(([tenantId, v]) => ({ tenantId, tenantName: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setStats({
        totalAll: rows.length,
        newToday,
        newWeek,
        newMonth,
        byStatus,
        bySource,
        topTenants,
      });
    } catch {
      // non-blocking
    }
  };

  useEffect(() => { fetchLeads(0); }, [filterStatus]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchLeads(0), 400);
    return () => clearTimeout(timeout);
  }, [searchTerm]);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Generate CSV client-side from supabase data
      let query = supabaseAdmin
        .from('leads')
        .select('name, whatsapp, email, status, source, profession, created_at, tenants(name)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10000);

      if (filterStatus !== 'all') query = query.eq('status', filterStatus);

      const { data: exportRows, error } = await query;
      if (error) throw error;

      const headers = ['Nome', 'WhatsApp', 'Email', 'Status', 'Fonte', 'Profissão', 'Tenant', 'Criado em'];
      const csvRows = (exportRows ?? []).map((l: any) => [
        l.name ?? '',
        l.whatsapp,
        l.email ?? '',
        l.status,
        l.source,
        l.profession ?? '',
        (l.tenants as any)?.name ?? '',
        l.created_at,
      ].map((v: string) => `"${String(v).replace(/"/g, '""')}"`).join(','));

      const csv = [headers.join(','), ...csvRows].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Exportado', 'CSV baixado com sucesso.');
    } catch {
      toast.error('Erro', 'Falha ao exportar leads.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Contact className="w-5 h-5 text-primary" aria-hidden />
            Gestão de Leads
          </h2>
          <p className="text-text-secondary text-xs mt-1">Visão cross-tenant de todos os leads · filtros · exportação CSV</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fetchLeads(pagination.offset)} disabled={isLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
          <Button onClick={handleExport} disabled={exporting} className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* KPI */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-white shadow-sm border-border"><CardContent className="pt-4 pb-3"><span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total Leads</span><span className="text-2xl font-bold font-heading font-mono text-text">{stats.totalAll.toLocaleString('pt-BR')}</span></CardContent></Card>
          <Card className="bg-white shadow-sm border-border"><CardContent className="pt-4 pb-3"><span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Novos Hoje</span><span className="text-2xl font-bold font-heading font-mono text-blue-700">{stats.newToday}</span></CardContent></Card>
          <Card className="bg-white shadow-sm border-border"><CardContent className="pt-4 pb-3"><span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Novos (7d)</span><span className="text-2xl font-bold font-heading font-mono text-text">{stats.newWeek}</span></CardContent></Card>
          <Card className="bg-white shadow-sm border-border"><CardContent className="pt-4 pb-3"><span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Novos (Mês)</span><span className="text-2xl font-bold font-heading font-mono text-text">{stats.newMonth}</span></CardContent></Card>
        </div>
      )}

      {/* Top tenants + source breakdown */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="bg-white border-border shadow-sm">
            <CardContent className="pt-3 pb-3">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-2">Top 5 Tenants</span>
              <div className="flex flex-wrap gap-2">
                {stats.topTenants.map((t) => (
                  <Badge key={t.tenantId} className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-2 py-0.5 border">{t.tenantName}: {t.count}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-border shadow-sm">
            <CardContent className="pt-3 pb-3">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-2">Por Fonte</span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.bySource).map(([source, count]) => (
                  <Badge key={source} className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-2 py-0.5 border">{source}: {count}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar por nome, WhatsApp ou email..." className="w-full pl-9 pr-3 h-9 text-xs rounded-lg border border-border bg-white text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {['all', 'NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'INACTIVE'].map((s) => (
                <Button key={s} onClick={() => setFilterStatus(s)} className={`text-[10px] px-3 h-8 rounded-lg ${filterStatus === s ? 'bg-primary text-white' : 'bg-white text-text border border-border hover:bg-surface-sunken'}`}>
                  {s === 'all' ? 'Todos' : s}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lead Table */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Leads</CardTitle>
          <CardDescription className="text-text-secondary text-xs">{pagination.total} total</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-secondary" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-10"><Contact className="w-6 h-6 text-text-secondary mx-auto mb-2" /><p className="text-sm font-semibold text-text">Nenhum lead encontrado.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Lead</th>
                  <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Tenant</th>
                  <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Fonte</th>
                  <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Profissão</th>
                  <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Conversas</th>
                  <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Criado</th>
                </tr></thead>
                <tbody>
                  {items.map((lead) => (
                    <tr key={lead.id} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                      <td className="py-2.5 px-2">
                        <div className="font-semibold text-text">{lead.name}</div>
                        <div className="text-text-secondary text-[10px] font-mono">{lead.whatsapp}</div>
                        {lead.email && <div className="text-text-muted text-[10px]">{lead.email}</div>}
                      </td>
                      <td className="py-2.5 px-2">
                        {lead.tenant ? <Link href={`/admin/tenants/${lead.tenant.id}`} className="text-primary hover:underline font-medium">{lead.tenant.name}</Link> : '—'}
                      </td>
                      <td className="py-2.5 px-2"><Badge className={`text-[9px] px-1.5 py-0 border ${STATUS_STYLES[lead.status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>{lead.status}</Badge></td>
                      <td className="py-2.5 px-2 text-text-secondary">{lead.source}</td>
                      <td className="py-2.5 px-2 text-text-secondary">{lead.profession ?? '—'}</td>
                      <td className="py-2.5 px-2 text-text font-mono">{lead.conversationCount}</td>
                      <td className="py-2.5 px-2 text-text-secondary text-[10px]">{new Date(lead.createdAt).toLocaleDateString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination.total > PAGE_SIZE && (
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
              <span className="text-[10px] text-text-secondary">{pagination.offset + 1}–{Math.min(pagination.offset + PAGE_SIZE, pagination.total)} de {pagination.total}</span>
              <div className="flex gap-1.5">
                <Button onClick={() => fetchLeads(Math.max(0, pagination.offset - PAGE_SIZE))} disabled={pagination.offset === 0} className="text-[10px] px-3 h-7 rounded bg-white text-text border border-border">Anterior</Button>
                <Button onClick={() => fetchLeads(pagination.offset + PAGE_SIZE)} disabled={!pagination.hasMore} className="text-[10px] px-3 h-7 rounded bg-white text-text border border-border">Próximo</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
