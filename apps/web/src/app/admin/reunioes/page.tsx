'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge } from '@prospix/ui';
import { Calendar, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, Clock, TrendingUp, UserX, DollarSign } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';
import { adminTenantsQueries } from '@/lib/admin-queries';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface MeetingEntry {
  id: string;
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  leadId: string;
  leadName: string | null;
  leadWhatsapp: string | null;
  leadProfession: string | null;
  conversationId: string | null;
  googleEventId: string | null;
  scheduledFor: string;
  durationMinutes: number;
  location: string | null;
  status: string;
  outcome: string | null;
  policyValueCents: number | null;
  commissionCents: number | null;
  notes: string | null;
  referralsCount: number;
  outcomeMarkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface TopTenant {
  tenantId: string;
  tenantName: string;
  meetingCount: number;
}

interface StatusBreakdown {
  status: string;
  count: number;
}

interface OutcomeBreakdown {
  outcome: string;
  count: number;
}

interface MeetingStats {
  meetingsToday: number;
  meetingsWeek: number;
  meetingsMonth: number;
  noShowRate: number;
  noShowCount: number;
  totalMeetings: number;
  statusBreakdown: StatusBreakdown[];
  outcomeBreakdown: OutcomeBreakdown[];
  revenue: {
    totalPolicyValueCents: number;
    totalCommissionCents: number;
  };
  topTenants: TopTenant[];
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 50;

const MEETING_STATUSES = [
  { value: '', label: 'Todos' },
  { value: 'SCHEDULED', label: 'Agendada' },
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'HAPPENED', label: 'Realizada' },
  { value: 'NO_SHOW', label: 'No-Show' },
  { value: 'RESCHEDULED', label: 'Reagendada' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: 'bg-blue-50 text-blue-700 border-blue-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  HAPPENED: 'bg-slate-50 text-slate-700 border-slate-200',
  NO_SHOW: 'bg-red-50 text-red-700 border-red-200',
  RESCHEDULED: 'bg-amber-50 text-amber-700 border-amber-200',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  HAPPENED: 'Realizada',
  NO_SHOW: 'No-Show',
  RESCHEDULED: 'Reagendada',
  CANCELLED: 'Cancelada',
};

const OUTCOME_LABELS: Record<string, string> = {
  CLOSED: 'Fechou',
  SECOND_MEETING: '2ª Reunião',
  NOT_INTERESTED: 'Sem Interesse',
  THINKING: 'Pensando',
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Meetings() {
  const [items, setItems] = useState<MeetingEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [stats, setStats] = useState<MeetingStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [filterTenantId, setFilterTenantId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
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

  /* ---------- Fetch meetings ---------- */
  const fetchMeetings = useCallback(async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      let query = supabaseAdmin
        .from('meetings')
        .select('*, tenants(id, name, slug), leads(id, name, whatsapp, profession)', { count: 'exact' })
        .order('scheduled_for', { ascending: false })
        .range(newOffset, newOffset + PAGE_SIZE - 1);

      if (filterTenantId) query = query.eq('tenant_id', filterTenantId);
      if (filterStatus) query = query.eq('status', filterStatus);
      if (filterFrom) query = query.gte('scheduled_for', new Date(filterFrom).toISOString());
      if (filterTo) query = query.lte('scheduled_for', new Date(filterTo).toISOString());

      const { data: meetingRows, count, error } = await query;
      if (error) throw error;

      const mapped: MeetingEntry[] = (meetingRows ?? []).map((m: any) => ({
        id: m.id,
        tenantId: m.tenant_id,
        tenantName: m.tenants?.name ?? null,
        tenantSlug: m.tenants?.slug ?? null,
        leadId: m.lead_id,
        leadName: m.leads?.name ?? null,
        leadWhatsapp: m.leads?.whatsapp ?? null,
        leadProfession: m.leads?.profession ?? null,
        conversationId: m.conversation_id,
        googleEventId: m.google_event_id,
        scheduledFor: m.scheduled_for,
        durationMinutes: m.duration_minutes,
        location: m.location,
        status: m.status,
        outcome: m.outcome,
        policyValueCents: m.policy_value_cents,
        commissionCents: m.commission_cents,
        notes: m.notes,
        referralsCount: m.referrals_count,
        outcomeMarkedAt: m.outcome_marked_at,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
      }));

      const total = count ?? 0;
      setItems(mapped);
      setPagination({ total, limit: PAGE_SIZE, offset: newOffset, hasMore: newOffset + PAGE_SIZE < total });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar reuniões.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId, filterStatus, filterFrom, filterTo]);

  /* ---------- Fetch stats ---------- */
  const fetchStats = useCallback(async () => {
    try {
      const { data: allMeetings } = await supabaseAdmin
        .from('meetings')
        .select('id, status, outcome, policy_value_cents, commission_cents, tenant_id, scheduled_for, tenants(name)');

      const rows = allMeetings ?? [];
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const meetingsToday = rows.filter((m: any) => m.scheduled_for >= todayStart && m.scheduled_for < todayEnd).length;
      const meetingsWeek = rows.filter((m: any) => m.scheduled_for >= weekAgo).length;
      const meetingsMonth = rows.filter((m: any) => m.scheduled_for >= monthStart).length;

      const noShowCount = rows.filter((m: any) => m.status === 'NO_SHOW').length;
      const noShowRate = rows.length > 0 ? Math.round((noShowCount / rows.length) * 100) : 0;

      // Status breakdown
      const statusMap: Record<string, number> = {};
      rows.forEach((m: any) => { statusMap[m.status] = (statusMap[m.status] || 0) + 1; });
      const statusBreakdown: StatusBreakdown[] = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

      // Outcome breakdown
      const outcomeMap: Record<string, number> = {};
      rows.filter((m: any) => m.outcome).forEach((m: any) => { outcomeMap[m.outcome] = (outcomeMap[m.outcome] || 0) + 1; });
      const outcomeBreakdown: OutcomeBreakdown[] = Object.entries(outcomeMap).map(([outcome, count]) => ({ outcome, count }));

      // Revenue
      const totalPolicyValueCents = rows
        .filter((m: any) => m.outcome === 'CLOSED')
        .reduce((sum: number, m: any) => sum + (m.policy_value_cents ?? 0), 0);
      const totalCommissionCents = rows
        .filter((m: any) => m.outcome === 'CLOSED')
        .reduce((sum: number, m: any) => sum + (m.commission_cents ?? 0), 0);

      // Top tenants
      const tenantCounts: Record<string, { name: string; count: number }> = {};
      rows.forEach((m: any) => {
        const tid = m.tenant_id;
        const tname = (m.tenants as any)?.name ?? 'Unknown';
        if (!tenantCounts[tid]) tenantCounts[tid] = { name: tname, count: 0 };
        tenantCounts[tid].count++;
      });
      const topTenants: TopTenant[] = Object.entries(tenantCounts)
        .map(([tenantId, v]) => ({ tenantId, tenantName: v.name, meetingCount: v.count }))
        .sort((a, b) => b.meetingCount - a.meetingCount)
        .slice(0, 5);

      setStats({
        meetingsToday,
        meetingsWeek,
        meetingsMonth,
        noShowRate,
        noShowCount,
        totalMeetings: rows.length,
        statusBreakdown,
        outcomeBreakdown,
        revenue: { totalPolicyValueCents, totalCommissionCents },
        topTenants,
      });
    } catch {
      /* non-blocking; KPIs stay at previous values */
    }
  }, []);

  /* ---------- Initial + filter-driven load ---------- */
  useEffect(() => {
    fetchMeetings(0);
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId, filterStatus, filterFrom, filterTo]);

  /* ---------- Auto-refresh every 60s ---------- */
  useEffect(() => {
    const timer = setInterval(() => {
      fetchMeetings(pagination.offset);
      fetchStats();
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.offset, filterTenantId, filterStatus, filterFrom, filterTo]);

  /* ---------- Pagination helpers ---------- */
  const currentPage = Math.floor(pagination.offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" aria-hidden />
            Reuniões
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Agenda de reuniões cross-tenant, estatísticas de no-show e receita projetada. Atualização automática a cada 60 s.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => { fetchMeetings(pagination.offset); fetchStats(); }}
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
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Reuniões Hoje</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.meetingsToday ?? '—'}</span>
              </div>
              <Calendar className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Semana (7d)</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.meetingsWeek ?? '—'}</span>
              </div>
              <Clock className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className={`bg-white shadow-sm ${(stats?.noShowRate ?? 0) > 15 ? 'border-red-300' : 'border-border'}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Taxa No-Show</span>
                <span className={`text-2xl font-bold font-heading font-mono ${(stats?.noShowRate ?? 0) > 15 ? 'text-red-700' : 'text-text'}`}>
                  {stats ? `${stats.noShowRate}%` : '—'}
                </span>
              </div>
              <UserX className={`w-4 h-4 ${(stats?.noShowRate ?? 0) > 15 ? 'text-red-700' : 'text-text-secondary'} opacity-80`} aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Receita Projetada</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">
                  {stats ? formatCurrency(stats.revenue.totalPolicyValueCents) : '—'}
                </span>
              </div>
              <DollarSign className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Status Breakdown ── */}
      {stats && stats.statusBreakdown.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-text">Reuniões por Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {stats.statusBreakdown.map((r) => (
                <Badge key={r.status} className={`text-[10px] px-2 py-0.5 border ${STATUS_STYLES[r.status] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                  {STATUS_LABELS[r.status] ?? r.status} <span className="font-mono ml-1">({r.count})</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Outcome Breakdown ── */}
      {stats && stats.outcomeBreakdown.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-text flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-text-secondary" aria-hidden />
              Desfecho das Reuniões
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {stats.outcomeBreakdown.map((r) => (
                <Badge key={r.outcome} className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5">
                  {OUTCOME_LABELS[r.outcome] ?? r.outcome} <span className="font-mono ml-1">({r.count})</span>
                </Badge>
              ))}
            </div>
            {stats.revenue.totalCommissionCents > 0 && (
              <p className="text-[11px] text-text-secondary mt-2">
                Comissão total (fechados): <span className="font-semibold font-mono text-text">{formatCurrency(stats.revenue.totalCommissionCents)}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Top Tenants ── */}
      {stats && stats.topTenants.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-text">Top 5 tenants por reuniões</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {stats.topTenants.map((t, idx) => (
                <Badge key={t.tenantId} className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5">
                  #{idx + 1} {t.tenantName} <span className="text-blue-500 font-mono ml-1">({t.meetingCount} reuniões)</span>
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
              <label htmlFor="filter-status" className="text-[11px] font-semibold text-text-secondary">Status:</label>
              <select
                id="filter-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 h-8 bg-white text-text focus:ring-1 focus:ring-primary/30 focus:border-primary outline-none"
              >
                {MEETING_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
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

            {(filterTenantId || filterStatus || filterFrom || filterTo) && (
              <Button
                onClick={() => { setFilterTenantId(''); setFilterStatus(''); setFilterFrom(''); setFilterTo(''); }}
                className="bg-white hover:bg-surface-sunken text-text-secondary border border-border text-[10px] px-2.5 h-7 rounded-lg"
              >
                Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Meetings table ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Reuniões</CardTitle>
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
              <Calendar className="w-6 h-6 text-text-secondary mx-auto mb-2" aria-hidden />
              <p className="text-sm font-semibold text-text">Nenhuma reunião encontrada.</p>
              <p className="text-[11px] text-text-secondary mt-1">Ajuste os filtros ou aguarde novas reuniões.</p>
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
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Data/Hora</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Duração</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Status</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Outcome</th>
                      <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Valor Apólice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                        <td className="py-2 px-2 font-semibold text-text whitespace-nowrap">{entry.tenantName ?? <span className="italic text-text-secondary">—</span>}</td>
                        <td className="py-2 px-2 text-text whitespace-nowrap">{entry.leadName ?? <span className="italic text-text-secondary">—</span>}</td>
                        <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">{entry.leadWhatsapp ?? '—'}</td>
                        <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">
                          {new Date(entry.scheduledFor).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-2 px-2 text-text-secondary whitespace-nowrap">{entry.durationMinutes} min</td>
                        <td className="py-2 px-2">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${STATUS_STYLES[entry.status] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                            {STATUS_LABELS[entry.status] ?? entry.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-text-secondary whitespace-nowrap">
                          {entry.outcome ? (OUTCOME_LABELS[entry.outcome] ?? entry.outcome) : '—'}
                        </td>
                        <td className="py-2 px-2 text-right text-text font-mono whitespace-nowrap">
                          {entry.policyValueCents != null ? formatCurrency(entry.policyValueCents) : '—'}
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
                    onClick={() => fetchMeetings(Math.max(0, pagination.offset - PAGE_SIZE))}
                    disabled={pagination.offset === 0 || isLoading}
                    className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2.5 h-7 rounded-lg flex items-center gap-1 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3 h-3" aria-hidden /> Anterior
                  </Button>
                  <Button
                    onClick={() => fetchMeetings(pagination.offset + PAGE_SIZE)}
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
