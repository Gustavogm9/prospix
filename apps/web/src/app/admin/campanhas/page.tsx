'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge } from '@prospix/ui';
import { Target, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, Users, MessageSquare, CalendarCheck } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { AxiosError } from 'axios';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CampaignEntry {
  id: string;
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  name: string;
  status: string;
  profession: string;
  cities: string[];
  neighborhoods: string[];
  dailyLimit: number;
  hourWindowStart: number;
  hourWindowEnd: number;
  activeScriptId: string | null;
  filters: unknown;
  totalCaptured: number;
  totalConversing: number;
  totalScheduled: number;
  totalClosedWon: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
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
  campaignCount: number;
}

interface CampaignStats {
  byStatus: Record<string, number>;
  totals: {
    totalCaptured: number;
    totalConversing: number;
    totalScheduled: number;
    totalClosedWon: number;
  };
  topTenants: TopTenant[];
  byProfession: Record<string, number>;
}

const PAGE_SIZE = 50;

const STATUS_OPTIONS = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
const PROFESSION_OPTIONS = ['DOCTOR', 'LAWYER', 'DENTIST', 'ENTREPRENEUR', 'ENGINEER', 'ARCHITECT', 'ACCOUNTANT', 'OTHER'] as const;

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-50 text-slate-600 border-slate-200',
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-700 border-amber-200',
  ARCHIVED: 'bg-slate-50 text-slate-500 border-slate-200',
};

const PROFESSION_LABELS: Record<string, string> = {
  DOCTOR: 'Médico',
  LAWYER: 'Advogado',
  DENTIST: 'Dentista',
  ENTREPRENEUR: 'Empreendedor',
  ENGINEER: 'Engenheiro',
  ARCHITECT: 'Arquiteto',
  ACCOUNTANT: 'Contador',
  OTHER: 'Outro',
};

export default function CampaignMonitor() {
  const [items, setItems] = useState<CampaignEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProfession, setFilterProfession] = useState('');

  /* ---------- Tenants for filter dropdown ---------- */
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    adminApiClient.get('/admin/tenants')
      .then((res) => {
        const list = (res.data?.data ?? []) as Array<{ id: string; name: string }>;
        setTenants(list.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => { /* ignore */ });
  }, []);

  /* ---------- Fetch campaigns ---------- */
  const fetchCampaigns = useCallback(async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(newOffset));
      if (filterTenantId) params.set('tenantId', filterTenantId);
      if (filterStatus) params.set('status', filterStatus);
      if (filterProfession) params.set('profession', filterProfession);

      const response = await adminApiClient.get(`/admin/campaigns?${params.toString()}`);
      const payload = response.data?.data;
      setItems(payload?.items ?? []);
      setPagination(payload?.pagination ?? { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao carregar campanhas.' : 'Falha ao carregar campanhas.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId, filterStatus, filterProfession]);

  /* ---------- Fetch stats ---------- */
  const fetchStats = useCallback(async () => {
    try {
      const response = await adminApiClient.get('/admin/campaigns/stats');
      setStats(response.data?.data ?? null);
    } catch {
      /* non-blocking; KPIs stay at previous values */
    }
  }, []);

  /* ---------- Initial + filter-driven load ---------- */
  useEffect(() => {
    fetchCampaigns(0);
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId, filterStatus, filterProfession]);

  /* ---------- Auto-refresh every 60s ---------- */
  useEffect(() => {
    const timer = setInterval(() => {
      fetchCampaigns(pagination.offset);
      fetchStats();
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.offset, filterTenantId, filterStatus, filterProfession]);

  /* ---------- Pagination helpers ---------- */
  const currentPage = Math.floor(pagination.offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" aria-hidden />
            Monitoramento de Campanhas
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Campanhas cross-tenant, métricas de funil e desempenho por profissão. Atualização automática a cada 60 s.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => { fetchCampaigns(pagination.offset); fetchStats(); }}
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
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Campanhas Ativas</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.byStatus?.ACTIVE ?? '—'}</span>
              </div>
              <Target className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total Capturado</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.totals?.totalCaptured?.toLocaleString('pt-BR') ?? '—'}</span>
              </div>
              <Users className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total Conversando</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.totals?.totalConversing?.toLocaleString('pt-BR') ?? '—'}</span>
              </div>
              <MessageSquare className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Reuniões Agendadas</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{stats?.totals?.totalScheduled?.toLocaleString('pt-BR') ?? '—'}</span>
              </div>
              <CalendarCheck className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Top tenants by active campaigns ── */}
      {stats && stats.topTenants.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-text">Top 5 tenants por campanhas ativas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {stats.topTenants.map((t, idx) => (
                <Badge key={t.tenantId} className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5">
                  #{idx + 1} {t.tenantName} <span className="text-blue-500 font-mono ml-1">({t.campaignCount} campanhas)</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Profession breakdown ── */}
      {stats && Object.keys(stats.byProfession).length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-text">Campanhas por profissão</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.byProfession)
                .sort(([, a], [, b]) => b - a)
                .map(([prof, count]) => (
                  <Badge key={prof} className="bg-violet-50 text-violet-700 border border-violet-200 text-[10px] px-2 py-0.5">
                    {PROFESSION_LABELS[prof] ?? prof} <span className="text-violet-500 font-mono ml-1">({count})</span>
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
                <option value="">Todos</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="filter-profession" className="text-[11px] font-semibold text-text-secondary">Profissão:</label>
              <select
                id="filter-profession"
                value={filterProfession}
                onChange={(e) => setFilterProfession(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 h-8 bg-white text-text focus:ring-1 focus:ring-primary/30 focus:border-primary outline-none"
              >
                <option value="">Todas</option>
                {PROFESSION_OPTIONS.map((p) => (
                  <option key={p} value={p}>{PROFESSION_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Campaigns table ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Campanhas</CardTitle>
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
              <Target className="w-6 h-6 text-text-secondary mx-auto mb-2" aria-hidden />
              <p className="text-sm font-semibold text-text">Nenhuma campanha encontrada.</p>
              <p className="text-[11px] text-text-secondary mt-1">Ajuste os filtros ou aguarde novas campanhas.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Tenant</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Nome</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Profissão</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Status</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Cidades</th>
                      <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Limite Diário</th>
                      <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Capturados</th>
                      <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Conversando</th>
                      <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Agendados</th>
                      <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Fechados</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Criada em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                        <td className="py-2 px-2 text-text whitespace-nowrap">{c.tenantName ?? <span className="italic text-text-secondary">—</span>}</td>
                        <td className="py-2 px-2 font-semibold text-text whitespace-nowrap">{c.name}</td>
                        <td className="py-2 px-2 text-text-secondary whitespace-nowrap">{PROFESSION_LABELS[c.profession] ?? c.profession}</td>
                        <td className="py-2 px-2">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${STATUS_STYLES[c.status] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                            {c.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-text-secondary max-w-[150px] truncate" title={c.cities.join(', ')}>
                          {c.cities.length > 0 ? c.cities.join(', ') : '—'}
                        </td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{c.dailyLimit}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{c.totalCaptured.toLocaleString('pt-BR')}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{c.totalConversing.toLocaleString('pt-BR')}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{c.totalScheduled.toLocaleString('pt-BR')}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{c.totalClosedWon.toLocaleString('pt-BR')}</td>
                        <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">
                          {new Date(c.createdAt).toLocaleString('pt-BR')}
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
                    onClick={() => fetchCampaigns(Math.max(0, pagination.offset - PAGE_SIZE))}
                    disabled={pagination.offset === 0 || isLoading}
                    className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2.5 h-7 rounded-lg flex items-center gap-1 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3 h-3" aria-hidden /> Anterior
                  </Button>
                  <Button
                    onClick={() => fetchCampaigns(pagination.offset + PAGE_SIZE)}
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
