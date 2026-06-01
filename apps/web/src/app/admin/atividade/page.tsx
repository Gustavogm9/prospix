'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge } from '@prospix/ui';
import { Users, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, Monitor, Clock, Building2, UserX } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { AxiosError } from 'axios';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface LoginEntry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface DormantTenant {
  id: string;
  name: string;
  slug: string;
}

interface TopTenant {
  tenantId: string;
  tenantName: string;
  sessionCount: number;
}

interface ActivitySummary {
  activeSessions: number;
  loginsToday: number;
  loginsWeek: number;
  dormantTenantsCount: number;
  dormantTenants: DormantTenant[];
  topTenants: TopTenant[];
}

const PAGE_SIZE = 50;

const ROLE_STYLES: Record<string, string> = {
  GUILDS_ADMIN: 'bg-amber-50 text-amber-800 border-amber-200',
  OWNER: 'bg-blue-50 text-blue-700 border-blue-200',
  ASSISTANT: 'bg-slate-50 text-slate-700 border-slate-200',
};

function truncateUA(ua: string | null, max = 60): string {
  if (!ua) return 'â€”';
  return ua.length > max ? ua.slice(0, max) + 'â€¦' : ua;
}

export default function Activity() {
  const [items, setItems] = useState<LoginEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState('');

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

  /* ---------- Fetch logins ---------- */
  const fetchLogins = useCallback(async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(newOffset));
      if (filterTenantId) params.set('tenantId', filterTenantId);

      const response = await adminApiClient.get(`/admin/activity/logins?${params.toString()}`);
      const payload = response.data?.data;
      setItems(payload?.items ?? []);
      setPagination(payload?.pagination ?? { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao carregar logins.' : 'Falha ao carregar logins.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId]);

  /* ---------- Fetch summary ---------- */
  const fetchSummary = useCallback(async () => {
    try {
      const response = await adminApiClient.get('/admin/activity/summary');
      setSummary(response.data?.data ?? null);
    } catch {
      /* non-blocking; KPIs stay at previous values */
    }
  }, []);

  /* ---------- Initial + filter-driven load ---------- */
  useEffect(() => {
    fetchLogins(0);
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId]);

  /* ---------- Auto-refresh every 60s ---------- */
  useEffect(() => {
    const timer = setInterval(() => {
      fetchLogins(pagination.offset);
      fetchSummary();
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.offset, filterTenantId]);

  /* ---------- Pagination helpers ---------- */
  const currentPage = Math.floor(pagination.offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" aria-hidden />
            Atividade do Sistema
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            SessÃµes de login, atividade por tenant e detecÃ§Ã£o de dormÃªncia. AtualizaÃ§Ã£o automÃ¡tica a cada 60 s.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => { fetchLogins(pagination.offset); fetchSummary(); }}
            disabled={isLoading}
            className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </Button>
        </div>
      </div>

      {/* â”€â”€ KPI Cards â”€â”€ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">SessÃµes Ativas</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{summary?.activeSessions ?? 'â€”'}</span>
              </div>
              <Monitor className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Logins Hoje</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{summary?.loginsToday ?? 'â€”'}</span>
              </div>
              <Clock className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Logins (7d)</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{summary?.loginsWeek ?? 'â€”'}</span>
              </div>
              <Building2 className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className={`bg-white shadow-sm ${(summary?.dormantTenantsCount ?? 0) > 0 ? 'border-amber-300' : 'border-border'}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Tenants Dormentes</span>
                <span className={`text-2xl font-bold font-heading font-mono ${(summary?.dormantTenantsCount ?? 0) > 0 ? 'text-amber-700' : 'text-text'}`}>
                  {summary?.dormantTenantsCount ?? 'â€”'}
                </span>
              </div>
              <UserX className={`w-4 h-4 ${(summary?.dormantTenantsCount ?? 0) > 0 ? 'text-amber-700' : 'text-text-secondary'} opacity-80`} aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* â”€â”€ Dormant tenants detail (collapsible) â”€â”€ */}
      {summary && summary.dormantTenants.length > 0 && (
        <Card className="bg-white border-amber-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-amber-800">Tenants sem login hÃ¡ 14+ dias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {summary.dormantTenants.map((t) => (
                <Badge key={t.id} className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] px-2 py-0.5">
                  {t.name} <span className="text-amber-600 font-mono ml-1">({t.slug})</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Top tenants â”€â”€ */}
      {summary && summary.topTenants.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-text">Top 10 tenants mais ativos (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {summary.topTenants.map((t, idx) => (
                <Badge key={t.tenantId} className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5">
                  #{idx + 1} {t.tenantName} <span className="text-blue-500 font-mono ml-1">({t.sessionCount} sessÃµes)</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* â”€â”€ Filter bar â”€â”€ */}
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
          </div>
        </CardContent>
      </Card>

      {/* â”€â”€ Logins table â”€â”€ */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Logins recentes</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            {pagination.total.toLocaleString('pt-BR')} total Â· ordenado por data desc
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
              <Users className="w-6 h-6 text-text-secondary mx-auto mb-2" aria-hidden />
              <p className="text-sm font-semibold text-text">Nenhum login encontrado.</p>
              <p className="text-[11px] text-text-secondary mt-1">Ajuste os filtros ou aguarde novos logins.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">UsuÃ¡rio</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Email</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Role</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Tenant</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">IP</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">User Agent</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Data</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((entry) => {
                      const isExpired = new Date(entry.expiresAt) < new Date();
                      const isRevoked = !!entry.revokedAt;
                      const isActive = !isExpired && !isRevoked;
                      return (
                        <tr key={entry.id} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                          <td className="py-2 px-2 font-semibold text-text whitespace-nowrap">{entry.userName}</td>
                          <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">{entry.userEmail}</td>
                          <td className="py-2 px-2">
                            <Badge className={`text-[9px] px-1.5 py-0 border ${ROLE_STYLES[entry.userRole] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                              {entry.userRole}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-text whitespace-nowrap">{entry.tenantName ?? <span className="italic text-text-secondary">â€”</span>}</td>
                          <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">{entry.ipAddress ?? 'â€”'}</td>
                          <td className="py-2 px-2 text-text-secondary max-w-[200px] truncate" title={entry.userAgent ?? undefined}>
                            {truncateUA(entry.userAgent)}
                          </td>
                          <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">
                            {new Date(entry.createdAt).toLocaleString('pt-BR')}
                          </td>
                          <td className="py-2 px-2">
                            {isActive ? (
                              <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] px-1.5 py-0">Ativa</Badge>
                            ) : isRevoked ? (
                              <Badge className="bg-red-50 text-red-700 border border-red-200 text-[9px] px-1.5 py-0">Revogada</Badge>
                            ) : (
                              <Badge className="bg-slate-50 text-slate-500 border border-slate-200 text-[9px] px-1.5 py-0">Expirada</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4 mt-2 border-t border-border/50">
                <span className="text-[11px] text-text-secondary">
                  PÃ¡gina {currentPage} de {totalPages} Â· {pagination.total.toLocaleString('pt-BR')} registros
                </span>
                <div className="flex gap-1.5">
                  <Button
                    onClick={() => fetchLogins(Math.max(0, pagination.offset - PAGE_SIZE))}
                    disabled={pagination.offset === 0 || isLoading}
                    className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2.5 h-7 rounded-lg flex items-center gap-1 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3 h-3" aria-hidden /> Anterior
                  </Button>
                  <Button
                    onClick={() => fetchLogins(pagination.offset + PAGE_SIZE)}
                    disabled={!pagination.hasMore || isLoading}
                    className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2.5 h-7 rounded-lg flex items-center gap-1 disabled:opacity-40"
                  >
                    PrÃ³xima <ChevronRight className="w-3 h-3" aria-hidden />
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
