'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Input, toast } from '@prospix/ui';
import { History, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';

interface AuditLogItem {
  id: string;
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string } | null;
  userId: string | null;
  user: { id: string; name: string; email: string; role: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface Pagination { total: number; limit: number; offset: number; hasMore: boolean; }

const PAGE_SIZE = 50;

const ACTION_COLOR: Record<string, string> = {
  'tenant.create': 'bg-success-soft text-success-text border-success/30',
  'tenant.suspend': 'bg-amber-50 text-amber-800 border-amber-300',
  'tenant.resume': 'bg-blue-50 text-blue-700 border-blue-200',
  'tenant.churn': 'bg-red-50 text-red-700 border-red-200',
  'discovery.promote': 'bg-primary-soft text-primary border-primary/20',
  'billing.pay': 'bg-success-soft text-success-text border-success/30',
  'lgpd.create': 'bg-purple-50 text-purple-700 border-purple-200',
  'lgpd.complete': 'bg-success-soft text-success-text border-success/30',
};

function actionBadgeClass(action: string): string {
  return ACTION_COLOR[action] ?? 'bg-surface-sunken text-text-secondary border-border/60';
}

export default function AuditLog() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [knownActions, setKnownActions] = useState<string[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [filterAction, setFilterAction] = useState('');
  const [filterTenantId, setFilterTenantId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const fetchLogs = async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      let query = supabaseAdmin
        .from('audit_logs')
        .select(`
          *,
          tenants(id, name, slug),
          users(id, name, email, role)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(newOffset, newOffset + PAGE_SIZE - 1);

      if (filterAction) query = query.eq('action', filterAction);
      if (filterTenantId) query = query.eq('tenant_id', filterTenantId);
      if (filterFrom) query = query.gte('created_at', new Date(filterFrom).toISOString());
      if (filterTo) query = query.lte('created_at', new Date(filterTo + 'T23:59:59').toISOString());

      const { data, error, count } = await query;
      if (error) throw new Error(error.message);

      const total = count ?? 0;
      const mapped: AuditLogItem[] = (data ?? []).map((l: any) => ({
        id: l.id,
        tenantId: l.tenant_id,
        tenant: l.tenants ? { id: l.tenants.id, name: l.tenants.name, slug: l.tenants.slug } : null,
        userId: l.user_id,
        user: l.users ? { id: l.users.id, name: l.users.name, email: l.users.email, role: l.users.role } : null,
        action: l.action,
        targetType: l.target_type,
        targetId: l.target_id,
        payload: l.payload,
        ipAddress: l.ip_address,
        userAgent: l.user_agent,
        createdAt: l.created_at,
      }));

      setItems(mapped);
      setPagination({ total, limit: PAGE_SIZE, offset: newOffset, hasMore: newOffset + PAGE_SIZE < total });

      // Fetch known actions for filter dropdown
      if (knownActions.length === 0) {
        const { data: actionsData } = await supabaseAdmin
          .from('audit_logs')
          .select('action')
          .limit(1000);

        const uniqueActions = [...new Set((actionsData ?? []).map((a: any) => a.action))].sort();
        setKnownActions(uniqueActions);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar audit logs.';
      setLoadError(message);
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyFilters = () => fetchLogs(0);
  const handleClearFilters = () => {
    setFilterAction('');
    setFilterTenantId('');
    setFilterFrom('');
    setFilterTo('');
    setTimeout(() => fetchLogs(0), 0);
  };

  const handlePrev = () => fetchLogs(Math.max(0, pagination.offset - PAGE_SIZE));
  const handleNext = () => pagination.hasMore && fetchLogs(pagination.offset + PAGE_SIZE);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <History className="w-5 h-5 text-primary" aria-hidden />
            Audit Log
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Histórico imutável de ações sensíveis. Use para investigação de incidentes, compliance LGPD e auditoria interna.
          </p>
        </div>
        <Button
          onClick={() => fetchLogs(pagination.offset)}
          disabled={isLoading}
          className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
        </Button>
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold font-heading text-text flex items-center gap-2">
            <Filter className="w-4 h-4 text-text-secondary" aria-hidden />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label htmlFor="f-action" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Ação</label>
              <select
                id="f-action"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:border-border-strong focus:outline-none"
              >
                <option value="">Todas</option>
                {knownActions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-tenant" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Tenant ID</label>
              <Input
                id="f-tenant"
                value={filterTenantId}
                onChange={(e) => setFilterTenantId(e.target.value)}
                placeholder="UUID do tenant"
                className="bg-white border-border text-text text-xs h-9 font-mono"
              />
            </div>
            <div>
              <label htmlFor="f-from" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">De</label>
              <Input id="f-from" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="bg-white border-border text-text text-xs h-9" />
            </div>
            <div>
              <label htmlFor="f-to" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Até</label>
              <Input id="f-to" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="bg-white border-border text-text text-xs h-9" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={handleApplyFilters} className="bg-primary hover:bg-primary-hover text-white text-xs px-3 h-8 rounded-lg">
              Aplicar filtros
            </Button>
            <Button onClick={handleClearFilters} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-8 rounded-lg">
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold font-heading text-text">Registros</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Total: {pagination.total.toLocaleString('pt-BR')} · página {Math.floor(pagination.offset / PAGE_SIZE) + 1} ({pagination.offset + 1}–{pagination.offset + items.length})
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button onClick={handlePrev} disabled={pagination.offset === 0 || isLoading} className="bg-white border border-border text-text text-xs px-2 h-8 rounded-lg disabled:opacity-40">
                <ChevronLeft className="w-3.5 h-3.5" aria-label="Página anterior" />
              </Button>
              <Button onClick={handleNext} disabled={!pagination.hasMore || isLoading} className="bg-white border border-border text-text text-xs px-2 h-8 rounded-lg disabled:opacity-40">
                <ChevronRight className="w-3.5 h-3.5" aria-label="Próxima página" />
              </Button>
            </div>
          </div>
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
              <p className="text-sm font-semibold text-text">Sem registros.</p>
              <p className="text-[11px] text-text-secondary mt-1">Nenhum audit log corresponde aos filtros aplicados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                    <th className="text-left py-2 px-2">Quando</th>
                    <th className="text-left py-2 px-2">Ação</th>
                    <th className="text-left py-2 px-2">Tenant</th>
                    <th className="text-left py-2 px-2">Por</th>
                    <th className="text-left py-2 px-2">Alvo</th>
                    <th className="text-left py-2 px-2">IP</th>
                    <th className="text-right py-2 px-2">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.map((l) => {
                    const isExpanded = expandedId === l.id;
                    const date = new Date(l.createdAt);
                    return (
                      <>
                        <tr key={l.id} className="hover:bg-surface-sunken/40">
                          <td className="py-2 px-2 text-text-secondary font-mono whitespace-nowrap">
                            <div>{date.toLocaleDateString('pt-BR')}</div>
                            <div className="text-[9px] opacity-70">{date.toLocaleTimeString('pt-BR')}</div>
                          </td>
                          <td className="py-2 px-2">
                            <Badge className={`text-[9px] px-1.5 py-0 border ${actionBadgeClass(l.action)}`}>
                              {l.action}
                            </Badge>
                          </td>
                          <td className="py-2 px-2">
                            {l.tenant ? (
                              <Link href={`/admin/tenants/${l.tenant.id}`} className="font-semibold text-text hover:text-primary hover:underline">
                                {l.tenant.name}
                              </Link>
                            ) : (
                              <span className="text-text-secondary italic">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            {l.user ? (
                              <>
                                <div className="font-semibold text-text">{l.user.name}</div>
                                <div className="text-[9px] text-text-secondary font-mono">{l.user.email}</div>
                              </>
                            ) : (
                              <span className="text-text-secondary italic">sistema</span>
                            )}
                          </td>
                          <td className="py-2 px-2 font-mono text-text-secondary">
                            {l.targetType ? (
                              <>
                                <div>{l.targetType}</div>
                                {l.targetId && <div className="text-[9px] opacity-70 truncate max-w-[120px]" title={l.targetId}>{l.targetId.slice(0, 16)}…</div>}
                              </>
                            ) : '—'}
                          </td>
                          <td className="py-2 px-2 font-mono text-text-secondary text-[10px]">{l.ipAddress ?? '—'}</td>
                          <td className="py-2 px-2 text-right">
                            {l.payload ? (
                              <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : l.id)}
                                className="text-[10px] text-primary hover:underline"
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? 'recolher' : 'ver'}
                              </button>
                            ) : (
                              <span className="text-text-secondary text-[10px]">—</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && l.payload !== null && (
                          <tr key={`${l.id}-payload`} className="bg-surface-sunken/60">
                            <td colSpan={7} className="py-2 px-4">
                              <pre className="text-[10px] font-mono text-text whitespace-pre-wrap break-words overflow-x-auto">
                                {JSON.stringify(l.payload, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
