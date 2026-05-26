import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { Bell, RefreshCw, Loader2, AlertCircle, AlertTriangle, CheckCircle2, Info, PlayCircle, Eye, X } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';
import { AxiosError } from 'axios';

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

interface OperationalAlert {
  id: string;
  type: string;
  severity: Severity;
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string } | null;
  title: string;
  message: string;
  context: unknown;
  dedupKey: string | null;
  ackById: string | null;
  ackBy: { id: string; name: string; email: string } | null;
  ackAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Pagination { total: number; limit: number; offset: number; hasMore: boolean; }

const PAGE_SIZE = 50;

const SEVERITY_ICON: Record<Severity, typeof AlertCircle> = {
  CRITICAL: AlertCircle,
  WARNING: AlertTriangle,
  INFO: Info,
};

const SEVERITY_STYLES: Record<Severity, string> = {
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',
  WARNING: 'bg-amber-50 text-amber-800 border-amber-300',
  INFO: 'bg-blue-50 text-blue-700 border-blue-200',
};

export default function Alerts() {
  const [items, setItems] = useState<OperationalAlert[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({ CRITICAL: 0, WARNING: 0, INFO: 0 });
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'open' | 'acked' | 'resolved' | 'all'>('open');
  const [filterSeverity, setFilterSeverity] = useState<'all' | Severity>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchAlerts = async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(newOffset));
      params.set('status', filterStatus);
      if (filterSeverity !== 'all') params.set('severity', filterSeverity);

      const response = await adminApiClient.get(`/admin/alerts?${params.toString()}`);
      const payload = response.data?.data;
      setItems(payload?.items ?? []);
      setPagination(payload?.pagination ?? { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
      setSummary(payload?.summary ?? {});
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao carregar alertas.' : 'Falha ao carregar alertas.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterSeverity]);

  const handleScan = async () => {
    setScanBusy(true);
    try {
      const response = await adminApiClient.post('/admin/alerts/scan');
      const r = response.data?.data;
      toast.success('Scan executado', `${r?.created ?? 0} criados · ${r?.updated ?? 0} atualizados · ${r?.errors ?? 0} erros`);
      await fetchAlerts(0);
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao executar scan.' : 'Falha ao executar scan.';
      toast.error('Erro', message);
    } finally {
      setScanBusy(false);
    }
  };

  const handleAck = async (id: string) => {
    setBusyId(id);
    try {
      await adminApiClient.patch(`/admin/alerts/${id}/ack`);
      toast.success('Alerta acknowledged');
      await fetchAlerts(pagination.offset);
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setBusyId(null);
    }
  };

  const handleResolve = async (id: string) => {
    if (!confirm('Resolver este alerta? Vai sair do feed "open" e ficar disponível apenas no filtro "resolvidos".')) return;
    setBusyId(id);
    try {
      await adminApiClient.patch(`/admin/alerts/${id}/resolve`);
      toast.success('Alerta resolvido');
      await fetchAlerts(pagination.offset);
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" aria-hidden />
            Alertas operacionais
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Scanner diário cross-tenant (08:15 BRT) · billing overdue, LGPD SLA, churn risk, DLQ acumulação, integration gaps.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fetchAlerts(pagination.offset)} disabled={isLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </Button>
          <Button onClick={handleScan} disabled={scanBusy} className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            {scanBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Executar scan agora
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className={`bg-white shadow-sm ${(summary.CRITICAL ?? 0) > 0 ? 'border-red-300' : 'border-border'}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Críticos abertos</span>
                <span className={`text-2xl font-bold font-heading font-mono ${(summary.CRITICAL ?? 0) > 0 ? 'text-error-text' : 'text-text'}`}>{summary.CRITICAL ?? 0}</span>
              </div>
              <AlertCircle className={`w-4 h-4 ${(summary.CRITICAL ?? 0) > 0 ? 'text-error-text' : 'text-text-secondary'} opacity-80`} aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className={`bg-white shadow-sm ${(summary.WARNING ?? 0) > 0 ? 'border-amber-300' : 'border-border'}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Warnings abertos</span>
                <span className={`text-2xl font-bold font-heading font-mono ${(summary.WARNING ?? 0) > 0 ? 'text-amber-700' : 'text-text'}`}>{summary.WARNING ?? 0}</span>
              </div>
              <AlertTriangle className={`w-4 h-4 ${(summary.WARNING ?? 0) > 0 ? 'text-amber-700' : 'text-text-secondary'} opacity-80`} aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Info abertos</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{summary.INFO ?? 0}</span>
              </div>
              <Info className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold font-heading text-text">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(['open', 'acked', 'resolved', 'all'] as const).map((s) => (
              <Button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`text-[10px] px-3 h-8 rounded-lg ${filterStatus === s ? 'bg-primary text-white' : 'bg-white text-text border border-border hover:bg-surface-sunken'}`}
              >
                {s === 'open' ? 'Abertos' : s === 'acked' ? 'Acked' : s === 'resolved' ? 'Resolvidos' : 'Todos'}
              </Button>
            ))}
            <span className="text-text-secondary text-xs px-2 self-center">·</span>
            {(['all', 'CRITICAL', 'WARNING', 'INFO'] as const).map((s) => (
              <Button
                key={s}
                onClick={() => setFilterSeverity(s)}
                className={`text-[10px] px-3 h-8 rounded-lg ${filterSeverity === s ? 'bg-primary text-white' : 'bg-white text-text border border-border hover:bg-surface-sunken'}`}
              >
                {s === 'all' ? 'Todas severidades' : s}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Feed</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            {pagination.total.toLocaleString('pt-BR')} total · ordenado por severity (CRITICAL primeiro) + data desc
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
              <CheckCircle2 className="w-6 h-6 text-success-text mx-auto mb-2" aria-hidden />
              <p className="text-sm font-semibold text-text">Sem alertas {filterStatus === 'open' ? 'abertos' : ''}.</p>
              <p className="text-[11px] text-text-secondary mt-1">Sistema operacional saudável.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((a) => {
                const Icon = SEVERITY_ICON[a.severity];
                const isExpanded = expandedId === a.id;
                const isResolved = !!a.resolvedAt;
                const isAcked = !!a.ackAt && !isResolved;
                return (
                  <div
                    key={a.id}
                    className={`p-3 rounded-lg border transition-colors ${SEVERITY_STYLES[a.severity]} ${isResolved ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2 flex-wrap">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${SEVERITY_STYLES[a.severity]}`}>
                            {a.severity}
                          </Badge>
                          <Badge className="bg-white/60 text-text-secondary border border-border/60 text-[9px] px-1.5 py-0 font-mono">
                            {a.type}
                          </Badge>
                          {a.tenant ? (
                            <Link to={`/tenants/${a.tenant.id}`} className="text-[10px] font-semibold text-text hover:underline">
                              {a.tenant.name}
                            </Link>
                          ) : (
                            <span className="text-[10px] font-semibold text-text-secondary italic">global</span>
                          )}
                          {isResolved && (
                            <Badge className="bg-success-soft text-success-text border border-success/30 text-[9px] px-1.5 py-0">
                              Resolvido {new Date(a.resolvedAt!).toLocaleDateString('pt-BR')}
                            </Badge>
                          )}
                          {isAcked && !isResolved && (
                            <Badge className="bg-blue-50 text-blue-700 border border-blue-200 text-[9px] px-1.5 py-0">
                              Acked por {a.ackBy?.name ?? 'sistema'}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs font-bold text-text mt-1">{a.title}</div>
                        <div className="text-[11px] text-text mt-0.5 leading-relaxed">{a.message}</div>
                        <div className="text-[9px] text-text-secondary font-mono mt-1">
                          criado {new Date(a.createdAt).toLocaleString('pt-BR')} · atualizado {new Date(a.updatedAt).toLocaleString('pt-BR')}
                        </div>
                        {isExpanded && a.context !== null && (
                          <pre className="text-[10px] font-mono text-text whitespace-pre-wrap break-words mt-2 p-2 bg-white/60 rounded border border-border/40 max-h-60 overflow-y-auto">
                            {JSON.stringify(a.context, null, 2)}
                          </pre>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {a.context !== null && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : a.id)}
                            className="text-[10px] text-text-secondary hover:text-text underline flex items-center gap-1"
                            aria-expanded={isExpanded}
                          >
                            <Eye className="w-3 h-3" aria-hidden /> {isExpanded ? 'recolher' : 'contexto'}
                          </button>
                        )}
                        {!isResolved && !isAcked && (
                          <Button
                            onClick={() => handleAck(a.id)}
                            disabled={busyId !== null}
                            className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2 h-7 rounded flex items-center gap-1"
                          >
                            {busyId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Ack
                          </Button>
                        )}
                        {!isResolved && (
                          <Button
                            onClick={() => handleResolve(a.id)}
                            disabled={busyId !== null}
                            className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[10px] px-2 h-7 rounded flex items-center gap-1"
                          >
                            <X className="w-3 h-3" aria-hidden /> Resolver
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
