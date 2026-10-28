'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge } from '@prospix/ui';
import { Users, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, Monitor, Clock, Building2, UserX } from 'lucide-react';
import { adminNextApi } from '@/lib/admin-api-fetch';

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

interface ActivitySummary {
  usersWithLogin: number;
  loginsToday: number;
  loginsWeek: number;
  dormantTenantsCount: number;
  dormantTenants: DormantTenant[];
}

const PAGE_SIZE = 50;

const ROLE_STYLES: Record<string, string> = {
  GUILDS_ADMIN: 'bg-amber-50 text-amber-800 border-amber-200',
  OWNER: 'bg-blue-50 text-blue-700 border-blue-200',
  ASSISTANT: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function Activity() {
  const [items, setItems] = useState<LoginEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState('');

  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);

  const fetchLogins = useCallback(async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const query = new URLSearchParams({ offset: String(newOffset) });
      if (filterTenantId) query.set('tenantId', filterTenantId);
      const response = await adminNextApi.get(`/api/admin/activity?${query.toString()}`);
      setItems(response.data.data ?? []);
      setPagination(response.data.pagination);
      setSummary(response.data.summary);
      setTenants(response.data.tenants ?? []);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao carregar acessos.');
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId]);
  /* ---------- Initial + filter-driven load ---------- */
  useEffect(() => {
    fetchLogins(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId]);

  /* ---------- Auto-refresh every 60s ---------- */
  useEffect(() => {
    const timer = setInterval(() => {
      fetchLogins(pagination.offset);
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.offset, filterTenantId]);

  /* ---------- Pagination helpers ---------- */
  const currentPage = Math.floor(pagination.offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" aria-hidden />
            Atividade do Sistema
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Último login de cada usuário e tenants sem acesso recente. Atualização automática a cada 60 s.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => { fetchLogins(pagination.offset); }}
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
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Usuários com login registrado</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{summary?.usersWithLogin ?? '—'}</span>
              </div>
              <Monitor className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Usuários que acessaram hoje</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{summary?.loginsToday ?? '—'}</span>
              </div>
              <Clock className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Usuários que acessaram em 7 dias</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{summary?.loginsWeek ?? '—'}</span>
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
                  {summary?.dormantTenantsCount ?? '—'}
                </span>
              </div>
              <UserX className={`w-4 h-4 ${(summary?.dormantTenantsCount ?? 0) > 0 ? 'text-amber-700' : 'text-text-secondary'} opacity-80`} aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Dormant tenants detail (collapsible) ── */}
      {summary && summary.dormantTenants.length > 0 && (
        <Card className="bg-white border-amber-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold font-heading text-amber-800">Tenants sem login há 14+ dias</CardTitle>
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
          </div>
        </CardContent>
      </Card>

      {/* ── Logins table ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Último login por usuário</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            {pagination.total.toLocaleString('pt-BR')} usuário(s) com acesso registrado · um login por usuário, ordenado pelo mais recente
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
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Usuário</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Email</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Role</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Tenant</th>
                      <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Último acesso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((entry) => (
                        <tr key={entry.id} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                          <td className="py-2 px-2 font-semibold text-text whitespace-nowrap">{entry.userName}</td>
                          <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">{entry.userEmail}</td>
                          <td className="py-2 px-2">
                            <Badge className={`text-[9px] px-1.5 py-0 border ${ROLE_STYLES[entry.userRole] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                              {entry.userRole}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-text whitespace-nowrap">{entry.tenantName ?? <span className="italic text-text-secondary">—</span>}</td>
                          <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">
                            {new Date(entry.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
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
