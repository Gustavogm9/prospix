import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Badge } from '@prospix/ui';
import { GitBranch, RefreshCw, Loader2, AlertCircle, TrendingUp, Users, Trophy, MessageCircle, Target, ArrowRight } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';
import { AxiosError } from 'axios';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface StatusDistribution {
  status: string;
  count: number;
  percentage: number;
}

interface PipelineData {
  total: number;
  distribution: StatusDistribution[];
}

interface ConversionRate {
  from: string;
  to: string;
  label: string;
  fromCount: number;
  toCount: number;
  rate: number;
}

interface TenantBreakdown {
  tenantId: string;
  tenantName: string;
  total: number;
  captured: number;
  conversing: number;
  qualified: number;
  closedWon: number;
}

/* ------------------------------------------------------------------ */
/* Status styling & labels                                             */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<string, string> = {
  CAPTURED: 'Capturado',
  ENRICHED: 'Enriquecido',
  CONTACTED: 'Contatado',
  NO_RESPONSE: 'Sem Resposta',
  CONVERSING: 'Conversando',
  QUALIFIED: 'Qualificado',
  MEETING_SCHEDULED: 'Reunião Agendada',
  CLOSED_WON: 'Fechado (Won)',
  CLOSED_LOST: 'Fechado (Lost)',
  NOT_INTERESTED: 'Sem Interesse',
  LOST_BEFORE_MEETING: 'Perdido Pré-Reunião',
  OPTED_OUT: 'Opt-out',
  ARCHIVED: 'Arquivado',
  ESCALATED_HUMAN: 'Escalado p/ Humano',
};

const STATUS_COLORS: Record<string, string> = {
  CAPTURED: 'bg-blue-500',
  ENRICHED: 'bg-blue-400',
  CONTACTED: 'bg-indigo-500',
  NO_RESPONSE: 'bg-amber-400',
  CONVERSING: 'bg-violet-500',
  QUALIFIED: 'bg-emerald-500',
  MEETING_SCHEDULED: 'bg-teal-500',
  CLOSED_WON: 'bg-green-600',
  CLOSED_LOST: 'bg-red-500',
  NOT_INTERESTED: 'bg-rose-400',
  LOST_BEFORE_MEETING: 'bg-orange-500',
  OPTED_OUT: 'bg-slate-400',
  ARCHIVED: 'bg-slate-300',
  ESCALATED_HUMAN: 'bg-amber-600',
};

const CONVERSION_LABELS: Record<string, string> = {
  contact_rate: 'Taxa de Contato',
  response_rate: 'Taxa de Resposta',
  qualification_rate: 'Taxa de Qualificação',
  scheduling_rate: 'Taxa de Agendamento',
  close_rate: 'Taxa de Fechamento',
  overall: 'Conversão Geral',
};

/* ------------------------------------------------------------------ */
/* Main Funnel statuses (for bar visualization)                        */
/* ------------------------------------------------------------------ */

const FUNNEL_STATUSES = [
  'CAPTURED',
  'ENRICHED',
  'CONTACTED',
  'CONVERSING',
  'QUALIFIED',
  'MEETING_SCHEDULED',
  'CLOSED_WON',
];

export default function PipelineMonitor() {
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [conversions, setConversions] = useState<ConversionRate[]>([]);
  const [tenantBreakdown, setTenantBreakdown] = useState<TenantBreakdown[]>([]);
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

  /* ---------- Fetch pipeline distribution ---------- */
  const fetchPipeline = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (filterTenantId) params.set('tenantId', filterTenantId);

      const [pipelineRes, conversionRes, byTenantRes] = await Promise.all([
        adminApiClient.get(`/admin/pipeline?${params.toString()}`),
        adminApiClient.get(`/admin/pipeline/conversion?${params.toString()}`),
        adminApiClient.get('/admin/pipeline/by-tenant'),
      ]);

      setPipeline(pipelineRes.data?.data ?? null);
      setConversions(conversionRes.data?.data?.conversions ?? []);
      setTenantBreakdown(byTenantRes.data?.data?.tenants ?? []);
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao carregar dados do pipeline.'
        : 'Falha ao carregar dados do pipeline.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId]);

  /* ---------- Initial + filter-driven load ---------- */
  useEffect(() => {
    fetchPipeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId]);

  /* ---------- Auto-refresh every 60s ---------- */
  useEffect(() => {
    const timer = setInterval(() => {
      fetchPipeline();
    }, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId]);

  /* ---------- Derived KPIs ---------- */
  const totalLeads = pipeline?.total ?? 0;
  const getCount = (status: string) =>
    pipeline?.distribution.find((d) => d.status === status)?.count ?? 0;

  const conversing = getCount('CONVERSING');
  const qualified = getCount('QUALIFIED');
  const closedWon = getCount('CLOSED_WON');

  /* ---------- Funnel max for bar width ---------- */
  const funnelItems = pipeline
    ? FUNNEL_STATUSES.map((s) => {
        const d = pipeline.distribution.find((x) => x.status === s);
        return { status: s, count: d?.count ?? 0, percentage: d?.percentage ?? 0 };
      })
    : [];
  const maxFunnelCount = Math.max(1, ...funnelItems.map((f) => f.count));

  /* ---------- Non-funnel (exit) statuses ---------- */
  const exitStatuses = pipeline
    ? pipeline.distribution.filter((d) => !FUNNEL_STATUSES.includes(d.status) && d.count > 0)
    : [];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" aria-hidden />
            Pipeline Cross-Tenant
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Distribuição de leads, funil de conversão e análise por tenant. Atualização automática a cada 60 s.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchPipeline()}
            disabled={isLoading}
            className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total Leads</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{totalLeads.toLocaleString('pt-BR')}</span>
              </div>
              <Users className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Conversando</span>
                <span className="text-2xl font-bold font-heading font-mono text-violet-700">{conversing.toLocaleString('pt-BR')}</span>
              </div>
              <MessageCircle className="w-4 h-4 text-violet-500 opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Qualificados</span>
                <span className="text-2xl font-bold font-heading font-mono text-emerald-700">{qualified.toLocaleString('pt-BR')}</span>
              </div>
              <Target className="w-4 h-4 text-emerald-500 opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className={`bg-white shadow-sm ${closedWon > 0 ? 'border-green-300' : 'border-border'}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Fechados (Won)</span>
                <span className={`text-2xl font-bold font-heading font-mono ${closedWon > 0 ? 'text-green-700' : 'text-text'}`}>
                  {closedWon.toLocaleString('pt-BR')}
                </span>
              </div>
              <Trophy className={`w-4 h-4 ${closedWon > 0 ? 'text-green-600' : 'text-text-secondary'} opacity-80`} aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Filter bar ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold font-heading text-text">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label htmlFor="filter-tenant-pipeline" className="text-[11px] font-semibold text-text-secondary">Tenant:</label>
              <select
                id="filter-tenant-pipeline"
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

      {/* ── Loading / Error states ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16" role="status">
          <Loader2 className="w-5 h-5 animate-spin text-text-secondary" aria-label="Carregando" />
        </div>
      ) : loadError ? (
        <div className="text-center py-16" role="alert">
          <AlertCircle className="w-6 h-6 text-error-text mx-auto mb-2" aria-hidden />
          <p className="text-xs text-text-secondary">{loadError}</p>
        </div>
      ) : (
        <>
          {/* ── Funnel Visualization ── */}
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold font-heading text-text">Funil de Conversão</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Distribuição de leads pelos estágios principais do pipeline
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {funnelItems.map((item) => (
                  <div key={item.status} className="flex items-center gap-3">
                    <span className="text-[10px] font-semibold text-text-secondary w-28 text-right flex-shrink-0 uppercase tracking-wider">
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                    <div className="flex-1 h-7 bg-surface-sunken/50 rounded-md overflow-hidden relative">
                      <div
                        className={`h-full ${STATUS_COLORS[item.status] ?? 'bg-slate-400'} rounded-md transition-all duration-700 ease-out flex items-center`}
                        style={{ width: `${Math.max((item.count / maxFunnelCount) * 100, item.count > 0 ? 2 : 0)}%` }}
                      >
                        {item.count > 0 && (
                          <span className="text-white text-[10px] font-bold font-mono px-2 whitespace-nowrap">
                            {item.count.toLocaleString('pt-BR')}
                          </span>
                        )}
                      </div>
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-secondary">
                        {item.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Exit statuses (compact) */}
              {exitStatuses.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border/50">
                  <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-2">Saídas do Funil</span>
                  <div className="flex flex-wrap gap-1.5">
                    {exitStatuses.map((d) => (
                      <Badge
                        key={d.status}
                        className="bg-slate-50 text-slate-700 border border-slate-200 text-[10px] px-2 py-0.5"
                      >
                        {STATUS_LABELS[d.status] ?? d.status}{' '}
                        <span className="text-slate-500 font-mono ml-1">
                          {d.count.toLocaleString('pt-BR')} ({d.percentage.toFixed(1)}%)
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Conversion Rates ── */}
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" aria-hidden />
                Taxas de Conversão
              </CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Conversão entre os estágios chave do pipeline
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {conversions.map((conv) => {
                  const isOverall = conv.label === 'overall';
                  return (
                    <div
                      key={conv.label}
                      className={`rounded-lg border p-3 ${
                        isOverall
                          ? 'bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 col-span-2 md:col-span-1'
                          : 'bg-white border-border'
                      }`}
                    >
                      <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                        {CONVERSION_LABELS[conv.label] ?? conv.label}
                      </span>
                      <span className={`text-xl font-bold font-heading font-mono ${isOverall ? 'text-primary' : 'text-text'}`}>
                        {conv.rate.toFixed(1)}%
                      </span>
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-text-secondary font-mono">
                        <span>{conv.fromCount.toLocaleString('pt-BR')}</span>
                        <ArrowRight className="w-3 h-3 text-text-secondary/60" />
                        <span>{conv.toCount.toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ── Top Tenants Table ── */}
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold font-heading text-text">Top 10 Tenants por Volume de Leads</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Distribuição de leads por status entre os principais tenants
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantBreakdown.length === 0 ? (
                <div className="text-center py-10">
                  <Users className="w-6 h-6 text-text-secondary mx-auto mb-2" aria-hidden />
                  <p className="text-sm font-semibold text-text">Nenhum tenant com leads encontrado.</p>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Tenant</th>
                        <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Total</th>
                        <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Capturados</th>
                        <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Conversando</th>
                        <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Qualificados</th>
                        <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Fechados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenantBreakdown.map((t, idx) => (
                        <tr key={t.tenantId} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                          <td className="py-2 px-2 font-semibold text-text whitespace-nowrap">
                            <span className="text-text-secondary font-mono mr-1.5">#{idx + 1}</span>
                            {t.tenantName}
                          </td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-text">{t.total.toLocaleString('pt-BR')}</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-700">{t.captured.toLocaleString('pt-BR')}</td>
                          <td className="py-2 px-2 text-right font-mono text-violet-700">{t.conversing.toLocaleString('pt-BR')}</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{t.qualified.toLocaleString('pt-BR')}</td>
                          <td className="py-2 px-2 text-right">
                            {t.closedWon > 0 ? (
                              <Badge className="bg-green-50 text-green-700 border border-green-200 text-[9px] px-1.5 py-0 font-mono">
                                {t.closedWon.toLocaleString('pt-BR')}
                              </Badge>
                            ) : (
                              <span className="text-text-secondary font-mono">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
