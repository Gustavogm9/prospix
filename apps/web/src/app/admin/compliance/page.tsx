'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { ShieldAlert, RefreshCw, Loader2, AlertCircle, ChevronLeft, ChevronRight, Clock, Play, CheckCircle2, XCircle, X } from 'lucide-react';
import { adminLgpdQueries } from '@/lib/admin-queries';
import { supabaseAdmin } from '@/lib/supabase';

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

  // Action states
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const fetchRequests = async (newOffset = 0) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      let query = supabaseAdmin
        .from('lgpd_requests')
        .select(`
          *,
          tenants(id, name, slug),
          requested_user:users!lgpd_requests_requested_by_user_id_fkey(id, name, email),
          processed_user:users!lgpd_requests_processed_by_id_fkey(id, name, email)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(newOffset, newOffset + PAGE_SIZE - 1);

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }
      if (filterType !== 'all') {
        query = query.eq('type', filterType);
      }

      const { data, error, count } = await query;
      if (error) throw new Error(error.message);

      const total = count ?? 0;
      const mapped: LgpdRequest[] = (data ?? []).map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenant: r.tenants ? { id: r.tenants.id, name: r.tenants.name, slug: r.tenants.slug } : { id: '', name: 'N/A', slug: '' },
        type: r.type,
        status: r.status,
        scope: r.scope,
        requestedByUser: r.requested_user ? { id: r.requested_user.id, name: r.requested_user.name, email: r.requested_user.email } : null,
        requestedByLead: r.requested_by_lead,
        rejectionReason: r.rejection_reason,
        processedBy: r.processed_user ? { id: r.processed_user.id, name: r.processed_user.name, email: r.processed_user.email } : null,
        processedAt: r.processed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        downloadExpiresAt: r.download_expires_at,
      }));

      setItems(mapped);
      setPagination({ total, limit: PAGE_SIZE, offset: newOffset, hasMore: newOffset + PAGE_SIZE < total });

      // Fetch status counts
      const countsQuery = await supabaseAdmin
        .from('lgpd_requests')
        .select('status');

      const counts: Record<string, number> = {};
      (countsQuery.data ?? []).forEach((r: any) => {
        counts[r.status] = (counts[r.status] || 0) + 1;
      });
      setStatusCounts(counts);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar LGPD.';
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

  const handleProcess = async (id: string) => {
    setActionLoadingId(id);
    try {
      const result = await adminLgpdQueries.markProcessing(id);
      if (result.error) throw new Error(result.error.message);
      toast.success('Processamento iniciado', 'Requisição LGPD movida para PROCESSING.');
      await fetchRequests(pagination.offset);
    } catch (err: unknown) {
      toast.error('Erro', err instanceof Error ? err.message : 'Falha ao iniciar processamento.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleComplete = async (id: string) => {
    setActionLoadingId(id);
    try {
      const result = await adminLgpdQueries.complete(id);
      if (result.error) throw new Error(result.error.message);
      toast.success('Requisição concluída', 'Requisição LGPD marcada como COMPLETED.');
      await fetchRequests(pagination.offset);
    } catch (err: unknown) {
      toast.error('Erro', err instanceof Error ? err.message : 'Falha ao concluir requisição.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const openRejectModal = (id: string) => {
    setRejectModalId(id);
    setRejectionReason('');
  };

  const closeRejectModal = () => {
    setRejectModalId(null);
    setRejectionReason('');
    setIsRejecting(false);
  };

  const handleReject = async () => {
    if (!rejectModalId) return;
    if (rejectionReason.trim().length < 5) {
      toast.error('Motivo obrigatório', 'Informe o motivo da rejeição (mínimo 5 caracteres).');
      return;
    }
    setIsRejecting(true);
    try {
      const result = await adminLgpdQueries.reject(rejectModalId, rejectionReason.trim());
      if (result.error) throw new Error(result.error.message);
      toast.success('Requisição rejeitada', 'Requisição LGPD marcada como REJECTED.');
      closeRejectModal();
      await fetchRequests(pagination.offset);
    } catch (err: unknown) {
      toast.error('Erro', err instanceof Error ? err.message : 'Falha ao rejeitar requisição.');
    } finally {
      setIsRejecting(false);
    }
  };

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
                    <th className="text-left py-2 px-2">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items.map((r) => {
                    const sla = slaState(r);
                    const isActionLoading = actionLoadingId === r.id;
                    return (
                      <tr key={r.id} className="hover:bg-surface-sunken/40">
                        <td className="py-2 px-2 font-mono text-text-secondary whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="py-2 px-2">
                          <Link href={`/admin/tenants/${r.tenantId}`} className="font-semibold text-text hover:text-primary hover:underline">
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
                          {r.status === 'REJECTED' && r.rejectionReason && (
                            <div className="text-[9px] text-red-600 mt-0.5 max-w-[160px] truncate" title={r.rejectionReason}>
                              Motivo: {r.rejectionReason}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            {r.status === 'PENDING' && (
                              <Button
                                onClick={() => handleProcess(r.id)}
                                disabled={isActionLoading}
                                className="bg-primary hover:bg-primary-hover text-white text-[9px] px-2 h-6 rounded flex items-center gap-1"
                              >
                                {isActionLoading ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Play className="w-3 h-3" />
                                )}
                                Iniciar
                              </Button>
                            )}
                            {r.status === 'PROCESSING' && (
                              <>
                                <Button
                                  onClick={() => handleComplete(r.id)}
                                  disabled={isActionLoading}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] px-2 h-6 rounded flex items-center gap-1"
                                >
                                  {isActionLoading ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="w-3 h-3" />
                                  )}
                                  Concluir
                                </Button>
                                <Button
                                  onClick={() => openRejectModal(r.id)}
                                  disabled={isActionLoading}
                                  className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[9px] px-2 h-6 rounded flex items-center gap-1"
                                >
                                  <XCircle className="w-3 h-3" />
                                  Rejeitar
                                </Button>
                              </>
                            )}
                            {r.status === 'PENDING' && (
                              <Button
                                onClick={() => openRejectModal(r.id)}
                                disabled={isActionLoading}
                                className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[9px] px-2 h-6 rounded flex items-center gap-1"
                              >
                                <XCircle className="w-3 h-3" />
                                Rejeitar
                              </Button>
                            )}
                            {(r.status === 'COMPLETED' || r.status === 'REJECTED' || r.status === 'CANCELED') && (
                              <span className="text-[9px] text-text-secondary italic">—</span>
                            )}
                          </div>
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

      {/* Rejection Modal */}
      {rejectModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeRejectModal} />
          <div className="relative bg-white rounded-xl shadow-xl border border-border w-full max-w-md mx-4 animate-fadeIn">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-bold font-heading text-text flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" aria-hidden />
                Rejeitar requisição LGPD
              </h3>
              <button
                onClick={closeRejectModal}
                className="text-text-secondary hover:text-text p-1 rounded-lg hover:bg-surface-sunken transition-colors"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label htmlFor="rejection-reason" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                  Motivo da rejeição *
                </label>
                <textarea
                  id="rejection-reason"
                  rows={4}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Descreva o motivo da rejeição (mín. 5 caracteres)..."
                  className="w-full bg-white border border-border rounded-lg px-3 py-2 text-xs text-text placeholder:text-text-secondary/60 focus:border-border-strong focus:outline-none resize-none"
                />
                <p className="text-[9px] text-text-secondary mt-1">
                  O motivo ficará registrado no audit log e será exibido ao solicitante.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <Button
                onClick={closeRejectModal}
                disabled={isRejecting}
                className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-4 h-8 rounded-lg"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleReject}
                disabled={isRejecting || rejectionReason.trim().length < 5}
                className="bg-red-600 hover:bg-red-700 text-white text-xs px-4 h-8 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
              >
                {isRejecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                Confirmar rejeição
              </Button>
            </div>
          </div>
        </div>
      )}
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
