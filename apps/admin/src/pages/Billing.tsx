import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { CreditCard, AlertCircle, Loader2, CheckCircle2, RefreshCw, Calendar } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';
import { AxiosError } from 'axios';

interface BillingRecord {
  id: string;
  tenantId: string;
  periodMonth: string;
  totalCents: number;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';
  dueAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
  tenant: { name: string };
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-300',
  PAID: 'bg-success-soft text-success-text border-success/30',
  OVERDUE: 'bg-red-50 text-red-700 border-red-200',
  CANCELED: 'bg-surface-sunken text-text-secondary border-border',
};

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

export default function Billing() {
  const [billings, setBillings] = useState<BillingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'OVERDUE'>('all');

  const fetchBillings = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await adminApiClient.get('/admin/billing');
      setBillings(response.data?.data || []);
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao carregar cobranças.'
        : 'Falha ao carregar cobranças.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBillings();
  }, []);

  const handleMarkPaid = async (id: string) => {
    if (!confirm('Confirmar pagamento offline?\n\nMarca como PAID, registra paymentMethod=manual_offline e reativa o tenant se estiver SUSPENDED.')) return;
    setPayingId(id);
    try {
      await adminApiClient.patch(`/admin/billing/${id}/pay`);
      toast.success('Pagamento confirmado', 'Fatura marcada como PAID.');
      await fetchBillings();
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao confirmar.'
        : 'Falha ao confirmar.';
      toast.error('Erro', message);
    } finally {
      setPayingId(null);
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return billings;
    return billings.filter((b) => b.status === filter);
  }, [billings, filter]);

  const totals = useMemo(() => {
    const overdue = billings.filter((b) => b.status === 'OVERDUE');
    const pending = billings.filter((b) => b.status === 'PENDING');
    return {
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((s, b) => s + b.totalCents, 0),
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, b) => s + b.totalCents, 0),
    };
  }, [billings]);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" aria-hidden />
            Faturamento & Cobranças
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Cobranças PENDING e OVERDUE cross-tenant. Permite confirmação manual de pagamentos offline (PIX/transferência fora do Asaas).
          </p>
        </div>
        <Button
          onClick={fetchBillings}
          disabled={isLoading}
          className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white border-red-200 shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Vencidas (OVERDUE)</span>
                <span className="text-2xl font-bold font-heading font-mono text-error-text">{totals.overdueCount}</span>
                <span className="text-[10px] text-text-secondary block mt-0.5">{formatBRL(totals.overdueAmount)}</span>
              </div>
              <AlertCircle className="w-4 h-4 text-error-text opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-amber-200 shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Pendentes (PENDING)</span>
                <span className="text-2xl font-bold font-heading font-mono text-amber-700">{totals.pendingCount}</span>
                <span className="text-[10px] text-text-secondary block mt-0.5">{formatBRL(totals.pendingAmount)}</span>
              </div>
              <Calendar className="w-4 h-4 text-amber-700 opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total a receber</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{formatBRL(totals.overdueAmount + totals.pendingAmount)}</span>
                <span className="text-[10px] text-text-secondary block mt-0.5">{billings.length} cobranças abertas</span>
              </div>
              <CreditCard className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Filtrar</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="mt-1 w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:border-border-strong focus:outline-none"
              aria-label="Filtrar cobranças por status"
            >
              <option value="all">Todas ({billings.length})</option>
              <option value="OVERDUE">Vencidas ({totals.overdueCount})</option>
              <option value="PENDING">Pendentes ({totals.pendingCount})</option>
            </select>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Cobranças abertas</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Ordenadas por data de vencimento ascendente. Use "Confirmar pagamento" apenas para PIX/transferência fora do Asaas.
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
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle2 className="w-6 h-6 text-success-text mx-auto mb-2" aria-hidden />
              <p className="text-sm font-semibold text-text">Sem cobranças abertas.</p>
              <p className="text-[11px] text-text-secondary mt-1">
                {filter === 'all' ? 'Todos os tenants estão em dia.' : `Nenhuma cobrança ${filter}.`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                    <th className="text-left py-2 px-2">Tenant</th>
                    <th className="text-left py-2 px-2">Período</th>
                    <th className="text-right py-2 px-2">Valor</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Vencimento</th>
                    <th className="text-right py-2 px-2">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((b) => {
                    const days = daysUntil(b.dueAt);
                    const dueLabel = days < 0 ? `${Math.abs(days)}d em atraso` : days === 0 ? 'vence hoje' : `vence em ${days}d`;
                    return (
                      <tr key={b.id} className="hover:bg-surface-sunken/40">
                        <td className="py-2 px-2">
                          <Link to={`/tenants/${b.tenantId}`} className="font-semibold text-text hover:text-primary hover:underline">
                            {b.tenant.name}
                          </Link>
                          <div className="text-[9px] text-text-secondary font-mono">id: {b.tenantId.slice(0, 8)}…</div>
                        </td>
                        <td className="py-2 px-2 font-mono">{b.periodMonth.slice(0, 7)}</td>
                        <td className="py-2 px-2 text-right font-mono font-bold">{formatBRL(b.totalCents)}</td>
                        <td className="py-2 px-2">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${STATUS_STYLES[b.status]}`}>
                            {b.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-text-secondary">
                          <div>{new Date(b.dueAt).toLocaleDateString('pt-BR')}</div>
                          <div className={`text-[9px] ${days < 0 ? 'text-error-text font-semibold' : days <= 3 ? 'text-amber-700' : 'text-text-secondary'}`}>
                            {dueLabel}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Button
                            onClick={() => handleMarkPaid(b.id)}
                            disabled={payingId !== null}
                            className="bg-primary hover:bg-primary-hover text-white text-[10px] font-semibold px-2.5 h-7 rounded flex items-center gap-1 ml-auto disabled:opacity-50"
                            aria-label={`Confirmar pagamento de ${b.tenant.name}`}
                          >
                            {payingId === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Confirmar pagto
                          </Button>
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
