'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge } from '@prospix/ui';
import { Share2, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, TrendingUp, CheckCircle2, Users, Gift } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';
import { adminTenantsQueries } from '@/lib/admin-queries';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ReferralEntry {
  id: string;
  name: string | null;
  whatsapp: string;
  email: string | null;
  status: string;
  source: string;
  profession: string | null;
  tenantId: string;
  tenant: { id: string; name: string; slug: string } | null;
  createdAt: string;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ReferralStats {
  totalReferrals: number;
  converted: number;
  conversionRate: number;
  referralsCollected: number;
  topTenants: Array<{ tenantId: string; tenantName: string; count: number }>;
}

const PAGE_SIZE = 50;

const STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-blue-50 text-blue-700 border-blue-200',
  CONTACTED: 'bg-sky-50 text-sky-700 border-sky-200',
  QUALIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MEETING_SCHEDULED: 'bg-violet-50 text-violet-700 border-violet-200',
  CLOSED_WON: 'bg-green-50 text-green-800 border-green-200',
  CLOSED_LOST: 'bg-red-50 text-red-700 border-red-200',
  UNRESPONSIVE: 'bg-slate-50 text-slate-500 border-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Novo',
  CONTACTED: 'Contatado',
  QUALIFIED: 'Qualificado',
  MEETING_SCHEDULED: 'Reunião Agendada',
  CLOSED_WON: 'Fechado (Ganho)',
  CLOSED_LOST: 'Fechado (Perdido)',
  UNRESPONSIVE: 'Sem Resposta',
};

export default function ReferralMonitor() {
  const [items, setItems] = useState<ReferralEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  /* ---------- Tenants for filter dropdown ---------- */
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    adminTenantsQueries.list().then((result) => {
      if (!result.error) {
        const list = (result.data ?? []).map((t) => ({ id: t.id, name: t.name }));
        setTenants(list.sort((a, b) => a.name.localeCompare(b.name)));
      }
    });
  }, []);

  /* ---------- Fetch referrals ---------- */
  const fetchReferrals = useCallback(async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // Query leads where source = 'REFERRAL'
      let query = supabaseAdmin
        .from('leads')
        .select('id, name, whatsapp, email, status, source, profession, tenant_id, created_at, tenants(id, name, slug)', { count: 'exact' })
        .eq('source', 'REFERRAL')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(newOffset, newOffset + PAGE_SIZE - 1);

      if (filterTenantId) query = query.eq('tenant_id', filterTenantId);
      if (filterFrom) query = query.gte('created_at', new Date(filterFrom).toISOString());
      if (filterTo) query = query.lte('created_at', new Date(filterTo).toISOString());

      const { data: rows, count, error } = await query;
      if (error) throw error;

      const mapped: ReferralEntry[] = (rows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        whatsapp: r.whatsapp,
        email: r.email,
        status: r.status,
        source: r.source,
        profession: r.profession,
        tenantId: r.tenant_id,
        tenant: r.tenants ? { id: r.tenants.id, name: r.tenants.name, slug: r.tenants.slug } : null,
        createdAt: r.created_at,
      }));

      const total = count ?? 0;
      setItems(mapped);
      setPagination({ total, limit: PAGE_SIZE, offset: newOffset, hasMore: newOffset + PAGE_SIZE < total });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar indicações.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId, filterFrom, filterTo]);

  /* ---------- Fetch stats ---------- */
  const fetchStats = useCallback(async () => {
    try {
      // Fetch all referral leads for stats
      const { data: allReferrals } = await supabaseAdmin
        .from('leads')
        .select('id, status, tenant_id, tenants(name)')
        .eq('source', 'REFERRAL')
        .is('deleted_at', null);

      const rows = allReferrals ?? [];
      const totalReferrals = rows.length;
      const converted = rows.filter((r: any) =>
        r.status === 'CLOSED_WON' || r.status === 'MEETING_SCHEDULED' || r.status === 'QUALIFIED'
      ).length;
      const conversionRate = totalReferrals > 0 ? Math.round((converted / totalReferrals) * 1000) / 10 : 0;

      // referralsCollected = total count of referrals from meetings
      const { count: referralsCollected } = await supabaseAdmin
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .gt('referrals_count', 0);

      // Top tenants
      const tenantCounts: Record<string, { name: string; count: number }> = {};
      rows.forEach((r: any) => {
        const tid = r.tenant_id;
        const tname = (r.tenants as any)?.name ?? 'Unknown';
        if (!tenantCounts[tid]) tenantCounts[tid] = { name: tname, count: 0 };
        tenantCounts[tid].count++;
      });
      const topTenants = Object.entries(tenantCounts)
        .map(([tenantId, v]) => ({ tenantId, tenantName: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setStats({
        totalReferrals,
        converted,
        conversionRate,
        referralsCollected: referralsCollected ?? 0,
        topTenants,
      });
    } catch {
      /* non-blocking */
    }
  }, []);

  /* ---------- Initial + filter-driven load ---------- */
  useEffect(() => {
    fetchReferrals(0);
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId, filterFrom, filterTo]);

  /* ---------- Auto-refresh every 60s ---------- */
  useEffect(() => {
    const timer = setInterval(() => {
      fetchReferrals(pagination.offset);
      fetchStats();
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.offset, filterTenantId, filterFrom, filterTo]);

  /* ---------- Pagination helpers ---------- */
  const currentPage = Math.floor(pagination.offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Share2 className="w-5 h-5 text-primary" aria-hidden />
            Indicações
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Monitoramento de leads por indicação cross-tenant. Atualização automática a cada 60 s.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => { fetchReferrals(pagination.offset); fetchStats(); }}
            disabled={isLoading}
            className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total Indicações</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.totalReferrals ?? '—'}</span>
              </div>
              <Users className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Convertidos</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.converted ?? '—'}</span>
              </div>
              <CheckCircle2 className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Taxa Conversão</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">
                  {stats ? `${stats.conversionRate}%` : '—'}
                </span>
              </div>
              <TrendingUp className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Indicações Coletadas</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.referralsCollected ?? '—'}</span>
              </div>
              <Gift className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Top tenants ── */}
      {stats && stats.topTenants.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-text">Top 5 tenants por indicações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {stats.topTenants.map((t, idx) => (
                <Badge key={t.tenantId} className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5">
                  #{idx + 1} {t.tenantName} <span className="text-blue-500 font-mono ml-1">({t.count} indicações)</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Filter bar ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold font-heading text-text">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label htmlFor="filter-tenant" className="text-[11px] font-semibold text-text-secondary">Tenant:</label>
              <select
                id="filter-tenant"
                value={filterTenantId}
                onChange={(e) => setFilterTenantId(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 h-8 bg-white text-text focus:ring-1 focus:ring-primary/30 focus:border-primary outline-none"
              >
                <option value="">Todos</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="filter-from" className="text-[11px] font-semibold text-text-secondary">De:</label>
              <input
                id="filter-from"
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 h-8 bg-white text-text focus:ring-1 focus:ring-primary/30 focus:border-primary outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="filter-to" className="text-[11px] font-semibold text-text-secondary">Até:</label>
              <input
                id="filter-to"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 h-8 bg-white text-text focus:ring-1 focus:ring-primary/30 focus:border-primary outline-none"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Referrals table ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Leads por indicação</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            {pagination.total.toLocaleString('pt-BR')} total · ordenado por data desc
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10" role="status">
              <Loader2 className="w-5 h-5 animate-spin text-text-secondary" aria-label="Carregando" />
            </div>
          ) : loadError ? (
            <div className="text-center py-10" role="alert">
              <AlertCircle className="w-6 h-6 text-error-text mx-auto mb-2" aria-hidden />
              <p className="text-xs text-text-secondary">{loadError}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <Share2 className="w-6 h-6 text-text-secondary mx-auto mb-2" aria-hidden />
              <p className="text-sm font-semibold text-text">Nenhuma indicação encontrada.</p>
              <p className="text-[11px] text-text-secondary mt-1">Ajuste os filtros ou aguarde novas indicações.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Tenant</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Lead</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">WhatsApp</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Status</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Profissão</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Criado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                        <td className="py-2 px-2 font-semibold text-text whitespace-nowrap">
                          {entry.tenant?.name ?? <span className="italic text-text-secondary">—</span>}
                        </td>
                        <td className="py-2 px-2 text-text whitespace-nowrap">{entry.name ?? '—'}</td>
                        <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">{entry.whatsapp}</td>
                        <td className="py-2 px-2">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${STATUS_STYLES[entry.status] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                            {STATUS_LABELS[entry.status] ?? entry.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-text-secondary whitespace-nowrap">{entry.profession ?? '—'}</td>
                        <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4 mt-2 border-t border-border/50">
                <span className="text-[11px] text-text-secondary">
                  Página {currentPage} de {totalPages} · {pagination.total.toLocaleString('pt-BR')} registros
                </span>
                <div className="flex gap-1.5">
                  <Button
                    onClick={() => fetchReferrals(Math.max(0, pagination.offset - PAGE_SIZE))}
                    disabled={pagination.offset === 0 || isLoading}
                    className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2.5 h-7 rounded-lg flex items-center gap-1 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3 h-3" aria-hidden /> Anterior
                  </Button>
                  <Button
                    onClick={() => fetchReferrals(pagination.offset + PAGE_SIZE)}
                    disabled={!pagination.hasMore || isLoading}
                    className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2.5 h-7 rounded-lg flex items-center gap-1 disabled:opacity-40"
                  >
                    Próxima <ChevronRight className="w-3 h-3" aria-hidden />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
