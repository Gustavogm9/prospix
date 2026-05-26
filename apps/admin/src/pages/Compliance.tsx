import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { ShieldAlert, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';
import { AxiosError } from 'axios';

type LgpdStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'CANCELED';
type LgpdType = 'EXPORT_DATA' | 'DELETE_TENANT_DATA' | 'DELETE_LEAD_DATA' | 'CORRECT_DATA' | 'CONFIRM_DATA';

interface LgpdRequest {
  id: string;
  tenantId: string;
  tenant: { id: string; name: string; slug: string };
  type: LgpdType;
  status: LgpdStatus;
  scope: unknown;
  requestedByUser: { id: string; name: string; email: string } | null;
  requestedByLead: string | null;
  rejectionReason: string | null;
  processedBy: { id: string; name: string; email: string } | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  downloadExpiresAt: string | null;
}

interface Pagination { total: number; limit: number; offset: number; hasMore: boolean; }

const PAGE_SIZE = 50;

const STATUS_STYLES: Record<LgpdStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-300',
  PROCESSING: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-success-soft text-success-text border-success/30',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  CANCELED: 'bg-surface-sunken text-text-secondary border-border',
};

const TYPE_LABEL: Record<LgpdType, string> = {
  EXPORT_DATA: 'Exportar dados (art. 18 V)',
  DELETE_TENANT_DATA: 'Excluir tenant (art. 18 VI)',
  DELETE_LEAD_DATA: 'Excluir lead (art. 18 VI)',
  CORRECT_DATA: 'Corrigir dados (art. 18 III)',
  CONFIRM_DATA: 'Confirmar dados (art. 18 I)',
};

// SLA LGPD · ANPD: 15 dias para confirmação, prática Guilds: 30d completion
const SLA_DAYS = 15;

function daysSinceCreation(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function slaState(req: LgpdRequest): { label: string; ok: boolean; warn: boolean; expired: boolean } {
  if (req.status === 'COMPLETED' || req.status === 'REJECTED' || req.status === 'CANCELED') {
    return { label: 'finalizado', ok: true, warn: false, expired: false };
  }
  const days = daysSinceCreation(req.createdAt);
  if (days > SLA_DAYS) return { label: `SLA vencido (${days}d)`, ok: false, warn: false, expired: true };
  if (days >= SLA_DAYS - 3) return { label: `${SLA_DAYS - days}d restantes`, ok: false, warn: true, expired: false };
  return { label: `${SLA_DAYS - days}d restantes`, ok: true, warn: false, expired: false };
}

export default function Compliance() {
  const [items, setItems] = useState<LgpdRequest[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | LgpdStatus>('all');
  const [filterType, setFilterType] = useState<'all' | LgpdType>('all');

  const fetchRequests = async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(newOffset));
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterType !== 'all') params.set('type', filterType);

      const response = await adminApiClient.get(`/admin/lgpd-requests?${params.toString()}`);
      const payload = response.data?.data;
      setItems(payload?.items ?? []);
      setPagination(payload?.pagination ?? { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
      setStatusCounts(payload?.statusCounts ?? {});
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao carregar LGPD.'
        : 'Falha ao carregar LGPD.';
      setLoadError(message);
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterType]);

  const expiredCount = items.filter((r) => slaState(r).expired).length;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-primary" aria-hidden />
            Compliance LGPD
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Requisições art. 18 (LGPD) cross-tenant. SLA legal: confirmação em até 15 dias, sob pena de sanção ANPD.
          </p>
        </div>
        <Button
          onClick={() => fetchRequests(pagination.offset)}
          disabled={isLoading}
          className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <CountCard label="Pendentes" value={statusCounts.PENDING ?? 0} tone="warn" />
        <CountCard label="Processando" value={statusCounts.PROCESSING ?? 0} tone="neutral" />
        <CountCard label="SLA vencido" value={expiredCount} tone={expiredCount > 0 ? 'danger' : 'good'} />
        <CountCard label="Completas" value={statusCounts.COMPLETED ?? 0} tone="good" />
        <CountCard label="Rejeitadas" value={statusCounts.REJECTED ?? 0} tone="neutral" />
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold font-heading text-text">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label htmlFor="f-status" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Status</label>
              <select id="f-status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | LgpdStatus)} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:border-border-strong focus:outline-none">
                <option value="all">Todos</option>
                <option value="PENDING">Pendentes</option>
                <option value="PROCESSING">Processando</option>
                <option value="COMPLETED">Completas</option>
                <option value="REJECTED">Rejeitadas</option>
                <option value="CANCELED">Canceladas</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-type" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Tipo</label>
              <select id="f-type" value={filterType} onChange={(e) => setFilterType(e.target.value as 'all' | LgpdType)} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:border-border-strong focus:outline-none">
                <option value="all">Todos</option>
                <option value="EXPORT_DATA">Exportar</option>
                <option value="DELETE_TENANT_DATA">Excluir tenant</option>
                <option value="DELETE_LEAD_DATA">Excluir lead</option>
                <option value="CORRECT_DATA">Corrigir</option>
                <option value="CONFIRM_DATA">Confirmar</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold font-heading text-text">Requisições</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Total: {pagination.total.toLocaleString('pt-BR')} · página {Math.floor(pagination.offset / PAGE_SIZE) + 1}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button onClick={() => fetchRequests(Math.max(0, pagination.offset - PAGE_SIZE))} disabled={pagination.offset === 0 || isLoading} className="bg-white border border-border text-text text-xs px-2 h-8 rounded-lg disabled:opacity-40">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button onClick={() => pagination.hasMore && fetchRequests(pagination.offset + PAGE_SIZE)} disabled={!pagination.hasMore || isLoading} className="bg-white border border-border text-text text-xs px-2 h-8 rounded-lg disabled:opacity-40">
                <ChevronRight className="w-3.5 h-3.5" />
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
              <p className="text-sm font-semibold text-text">Sem requisições.</p>
              <p className="text-[11px] text-text-secondary mt-1">Nenhum registro LGPD corresponde aos filtros.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                    <th className="text-left py-2 px-2">Criada</th>
                    <th className="text-left py-2 px-2">Tenant</th>
                    <th className="text-left py-2 px-2">Tipo</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">SLA</th>
                    <th className="text-left py-2 px-2">Solicitante</th>
                    <th className="text-left py-2 px-2">Processado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.map((r) => {
                    const sla = slaState(r);
                    return (
                      <tr key={r.id} className="hover:bg-surface-sunken/40">
                        <td className="py-2 px-2 font-mono text-text-secondary whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="py-2 px-2">
                          <Link to={`/tenants/${r.tenantId}`} className="font-semibold text-text hover:text-primary hover:underline">
                            {r.tenant.name}
                          </Link>
                        </td>
                        <td className="py-2 px-2 text-text" title={TYPE_LABEL[r.type]}>
                          <Badge className="bg-surface-sunken text-text-secondary border border-border/60 text-[9px] px-1.5 py-0">
                            {r.type}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${STATUS_STYLES[r.status]}`}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                            sla.expired ? 'bg-red-50 text-red-700 border-red-200' :
                            sla.warn ? 'bg-amber-50 text-amber-800 border-amber-300' :
                            sla.ok ? 'bg-success-soft/40 text-success-text border-success/30' :
                            'bg-surface-sunken text-text-secondary border-border'
                          }`}>
                            <Clock className="w-3 h-3" aria-hidden /> {sla.label}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          {r.requestedByUser ? (
                            <>
                              <div className="font-semibold text-text">{r.requestedByUser.name}</div>
                              <div className="text-[9px] text-text-secondary font-mono">{r.requestedByUser.email}</div>
                            </>
                          ) : r.requestedByLead ? (
                            <span className="font-mono text-text-secondary">{r.requestedByLead}</span>
                          ) : (
                            <span className="text-text-secondary italic">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {r.processedBy ? (
                            <>
                              <div className="font-semibold text-text">{r.processedBy.name}</div>
                              <div className="text-[9px] text-text-secondary">
                                {r.processedAt ? new Date(r.processedAt).toLocaleDateString('pt-BR') : ''}
                              </div>
                            </>
                          ) : (
                            <span className="text-text-secondary italic">não processado</span>
                          )}
                        </td>
                      </tr>
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

function CountCard({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'good' | 'warn' | 'danger' }) {
  const toneClass = tone === 'good' ? 'text-success-text border-success/30'
    : tone === 'warn' ? 'text-amber-700 border-amber-300'
    : tone === 'danger' ? 'text-error-text border-red-200'
    : 'text-text border-border';
  return (
    <Card className={`bg-white shadow-sm ${toneClass}`}>
      <CardContent className="pt-4 pb-3">
        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">{label}</span>
        <span className={`text-2xl font-bold font-heading font-mono block ${toneClass}`}>{value}</span>
      </CardContent>
    </Card>
  );
}
