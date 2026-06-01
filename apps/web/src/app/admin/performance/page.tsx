'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge } from '@prospix/ui';
import {
  TrendingUp,
  RefreshCw,
  Loader2,
  AlertCircle,
  Users,
  Calendar,
  Target,
  DollarSign,
  MessageSquare,
  ArrowRight,
  Trophy,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface OverviewData {
  leads: {
    total: number; today: number; week: number; month: number;
    captured: number; contacted: number; conversing: number;
    qualified: number; meetingScheduled: number; closedWon: number;
  };
  meetings: { total: number; happened: number; noShow: number; closedWon: number; noShowRate: number };
  revenue: { policyValueCents: number; commissionCents: number };
  conversations: { total: number; escalated: number; escalationRate: number; avgMessages: number };
  campaigns: { active: number };
  rates: { overallConversion: number; contactRate: number; qualificationRate: number; closeRate: number };
  tenants: { active: number };
}

interface TrendRow {
  period: string;
  leadsCaptured: number;
  conversationsStarted: number;
  meetingsScheduled: number;
  meetingsClosed: number;
  totalCostCents: number;
  whatsappSent: number;
  activeTenants: number;
  conversionRate: number;
}

interface RankingRow {
  rank: number;
  tenantId: string;
  tenantName: string;
  totalLeads: number;
  closedWon: number;
  closedLost: number;
  totalMeetings: number;
  meetingsHappened: number;
  meetingsNoShow: number;
  revenueCents: number;
  commissionCents: number;
  conversionRate: number;
  noShowRate: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => n.toLocaleString('pt-BR');
const fmtBRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const FUNNEL_STAGES = [
  { key: 'captured', label: 'Capturados', color: 'bg-blue-500' },
  { key: 'contacted', label: 'Contatados', color: 'bg-sky-500' },
  { key: 'conversing', label: 'Conversando', color: 'bg-cyan-500' },
  { key: 'qualified', label: 'Qualificados', color: 'bg-teal-500' },
  { key: 'meetingScheduled', label: 'Reunião Agendada', color: 'bg-emerald-500' },
  { key: 'closedWon', label: 'Fechados (Won)', color: 'bg-green-600' },
] as const;

const CONVERSION_STEPS = [
  { from: 'Capturado', to: 'Contatado', key: 'contactRate' },
  { from: 'Conversando', to: 'Qualificado', key: 'qualificationRate' },
  { from: 'Reunião', to: 'Fechado', key: 'closeRate' },
  { from: 'Capturado', to: 'Fechado', key: 'overallConversion' },
] as const;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Performance() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState('');
  const [sortBy, setSortBy] = useState<'leads' | 'closedWon' | 'revenue' | 'conversion'>('leads');
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    adminApiClient.get('/admin/tenants')
      .then((res) => {
        const list = (res.data?.data ?? []) as Array<{ id: string; name: string }>;
        setTenants(list.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const tenantParam = filterTenantId ? `?tenantId=${filterTenantId}` : '';
      const [overviewRes, trendsRes, rankingRes] = await Promise.all([
        adminApiClient.get(`/admin/performance/overview${tenantParam}`),
        adminApiClient.get(`/admin/performance/trends${tenantParam}`),
        adminApiClient.get(`/admin/performance/ranking?sortBy=${sortBy}&limit=10`),
      ]);
      setOverview(overviewRes.data?.data ?? null);
      setTrends(trendsRes.data?.data?.trends ?? []);
      setRanking(rankingRes.data?.data?.ranking ?? []);
    } catch {
      setLoadError('Falha ao carregar dados de performance.');
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId, sortBy]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const t = setInterval(fetchAll, 120_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  if (isLoading && !overview) {
    return (
      <div className="flex items-center justify-center py-20" role="status">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" aria-label="Carregando" />
      </div>
    );
  }

  if (loadError && !overview) {
    return (
      <div className="text-center py-20" role="alert">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="text-sm text-text-secondary">{loadError}</p>
        <Button onClick={fetchAll} className="mt-4 text-xs">Tentar novamente</Button>
      </div>
    );
  }

  const o = overview!;
  const maxFunnel = Math.max(...FUNNEL_STAGES.map((s) => (o.leads as any)[s.key] ?? 0), 1);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" aria-hidden />
            Performance Cross-Tenant
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Visão unificada de KPIs, funil de conversão, tendências e ranking de tenants. Atualização a cada 2 min.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={fetchAll}
            disabled={isLoading}
            className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </Button>
        </div>
      </div>

      {/* ── KPI Cards Row 1 — Volume ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <KPICard icon={Users} label="Total Leads" value={fmt(o.leads.total)} sub={`+${fmt(o.leads.today)} hoje · +${fmt(o.leads.week)} (7d)`} />
        <KPICard icon={Calendar} label="Reuniões" value={fmt(o.meetings.total)} sub={`${fmt(o.meetings.happened)} realizadas · ${fmt(o.meetings.noShow)} no-show`} />
        <KPICard icon={Target} label="Fechados (Won)" value={fmt(o.leads.closedWon)} accent="text-emerald-600" />
        <KPICard icon={DollarSign} label="Receita Projetada" value={fmtBRL(o.revenue.policyValueCents)} sub={`Comissão: ${fmtBRL(o.revenue.commissionCents)}`} accent="text-emerald-600" />
        <KPICard icon={MessageSquare} label="Conversas IA" value={fmt(o.conversations.total)} sub={`${fmt(o.conversations.escalated)} escaladas (${fmtPct(o.conversations.escalationRate)})`} />
      </div>

      {/* ── KPI Cards Row 2 — Rates ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CONVERSION_STEPS.map((step) => {
          const rate = (o.rates as any)[step.key] ?? 0;
          const isOverall = step.key === 'overallConversion';
          return (
            <Card key={step.key} className={`border-border shadow-sm ${isOverall ? 'bg-emerald-50 border-emerald-200' : 'bg-white'}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
                  <span>{step.from}</span>
                  <ArrowRight className="w-3 h-3" aria-hidden />
                  <span>{step.to}</span>
                </div>
                <span className={`text-2xl font-bold font-heading font-mono ${isOverall ? 'text-emerald-700' : rate >= 20 ? 'text-emerald-600' : rate >= 10 ? 'text-amber-600' : 'text-red-500'}`}>
                  {fmtPct(rate)}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Filters ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="py-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label htmlFor="perf-tenant" className="text-[11px] font-semibold text-text-secondary">Tenant:</label>
              <select
                id="perf-tenant"
                value={filterTenantId}
                onChange={(e) => setFilterTenantId(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 h-8 bg-white text-text focus:ring-1 focus:ring-primary/30 focus:border-primary outline-none"
              >
                <option value="">Todos</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text-secondary">Tenants ativos:</label>
              <Badge className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] px-2">{o.tenants.active}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text-secondary">Campanhas ativas:</label>
              <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] px-2">{o.campaigns.active}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text-secondary">Média msgs/conversa:</label>
              <Badge className="bg-violet-50 text-violet-700 border border-violet-200 text-[10px] px-2">{o.conversations.avgMessages}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Funnel Visualization ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Funil de Conversão</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Distribuição de leads pelos estágios principais do funil — {fmt(o.leads.total)} leads total
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {FUNNEL_STAGES.map((stage, idx) => {
              const count = (o.leads as any)[stage.key] ?? 0;
              const pct = o.leads.total > 0 ? (count / o.leads.total) * 100 : 0;
              const barWidth = maxFunnel > 0 ? (count / maxFunnel) * 100 : 0;
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <span className="w-[140px] text-xs text-text-secondary font-medium shrink-0 text-right">
                    {stage.label}
                  </span>
                  <div className="flex-1 h-8 bg-surface-sunken/40 rounded-lg overflow-hidden relative">
                    <div
                      className={`h-full ${stage.color} rounded-lg transition-all duration-700 ease-out`}
                      style={{ width: `${Math.max(barWidth, 1)}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-3">
                      <span className={`text-xs font-bold font-mono ${barWidth > 30 ? 'text-white' : 'text-text'}`}>
                        {fmt(count)}
                      </span>
                      <span className={`text-[10px] ml-1.5 ${barWidth > 30 ? 'text-white/70' : 'text-text-secondary'}`}>
                        ({pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                  {idx > 0 && (
                    <div className="w-[60px] text-right shrink-0">
                      <span className="text-[10px] font-mono text-text-secondary">
                        {(() => {
                          const prev = (o.leads as any)[FUNNEL_STAGES[idx - 1]!.key] ?? 0;
                          return prev > 0 ? `${((count / prev) * 100).toFixed(0)}%` : '—';
                        })()}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* No-show highlight */}
          <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-4">
            <Badge className={`text-xs px-2.5 py-1 border ${o.meetings.noShowRate > 15 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
              Taxa No-Show: {fmtPct(o.meetings.noShowRate)}
            </Badge>
            <Badge className={`text-xs px-2.5 py-1 border ${o.conversations.escalationRate > 20 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
              Taxa Escalação IA: {fmtPct(o.conversations.escalationRate)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* ── Trends (TenantUsage monthly) ── */}
      {trends.length > 0 && (
        <Card className="bg-white border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-heading text-text">Tendências Mensais</CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Últimos {trends.length} meses — dados do TenantUsage (agregado cross-tenant)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Período</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Leads</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Conversas</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Reuniões</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Fechados</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Conversão</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">WhatsApp</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Custo Total</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Tenants</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.map((row, idx) => {
                    const prev = idx > 0 ? trends[idx - 1] : null;
                    return (
                      <tr key={row.period} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                        <td className="py-2 px-2 font-semibold text-text whitespace-nowrap">{row.period}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">
                          {fmt(row.leadsCaptured)}
                          {prev && <TrendArrow current={row.leadsCaptured} previous={prev.leadsCaptured} />}
                        </td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{fmt(row.conversationsStarted)}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{fmt(row.meetingsScheduled)}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{fmt(row.meetingsClosed)}</td>
                        <td className="py-2 px-2 font-mono text-right whitespace-nowrap">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${row.conversionRate >= 5 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : row.conversionRate >= 2 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                            {fmtPct(row.conversionRate)}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-text-secondary font-mono text-right whitespace-nowrap">{fmt(row.whatsappSent)}</td>
                        <td className="py-2 px-2 text-text font-mono text-right whitespace-nowrap">{fmtBRL(row.totalCostCents)}</td>
                        <td className="py-2 px-2 text-text-secondary font-mono text-right whitespace-nowrap">{row.activeTenants}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tenant Ranking ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" aria-hidden />
                Ranking de Tenants
              </CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Top 10 tenants ativos ordenados por performance
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="rank-sort" className="text-[11px] font-semibold text-text-secondary">Ordenar por:</label>
              <select
                id="rank-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="text-xs border border-border rounded-lg px-2.5 h-8 bg-white text-text focus:ring-1 focus:ring-primary/30 focus:border-primary outline-none"
              >
                <option value="leads">Total Leads</option>
                <option value="closedWon">Fechados</option>
                <option value="revenue">Receita</option>
                <option value="conversion">Conversão</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {ranking.length === 0 ? (
            <p className="text-center text-xs text-text-secondary py-8">Nenhum tenant com leads encontrado.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-center py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider w-8">#</th>
                    <th className="text-left py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Tenant</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Leads</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Fechados</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Conversão</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Reuniões</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">No-Show</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Receita</th>
                    <th className="text-right py-2 px-2 text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r) => (
                    <tr key={r.tenantId} className="border-b border-border/50 hover:bg-surface-sunken/30 transition-colors">
                      <td className="py-2.5 px-2 text-center">
                        {r.rank <= 3 ? (
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                            r.rank === 1 ? 'bg-amber-100 text-amber-700' :
                            r.rank === 2 ? 'bg-slate-100 text-slate-600' :
                            'bg-orange-100 text-orange-600'
                          }`}>{r.rank}</span>
                        ) : (
                          <span className="text-text-secondary font-mono">{r.rank}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-semibold text-text whitespace-nowrap">{r.tenantName}</td>
                      <td className="py-2.5 px-2 text-text font-mono text-right whitespace-nowrap">{fmt(r.totalLeads)}</td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <span className="text-emerald-600 font-mono font-bold">{fmt(r.closedWon)}</span>
                        {r.closedLost > 0 && <span className="text-red-400 font-mono ml-1 text-[10px]">/{fmt(r.closedLost)}</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <Badge className={`text-[9px] px-1.5 py-0 border ${
                          r.conversionRate >= 5 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          r.conversionRate >= 2 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-red-50 text-red-600 border-red-200'
                        }`}>{fmtPct(r.conversionRate)}</Badge>
                      </td>
                      <td className="py-2.5 px-2 text-text font-mono text-right whitespace-nowrap">{fmt(r.totalMeetings)}</td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <Badge className={`text-[9px] px-1.5 py-0 border ${
                          r.noShowRate > 20 ? 'bg-red-50 text-red-700 border-red-200' :
                          r.noShowRate > 10 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>{fmtPct(r.noShowRate)}</Badge>
                      </td>
                      <td className="py-2.5 px-2 text-text font-mono text-right whitespace-nowrap">{fmtBRL(r.revenueCents)}</td>
                      <td className="py-2.5 px-2 text-emerald-600 font-mono text-right whitespace-nowrap">{fmtBRL(r.commissionCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function KPICard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: typeof Users; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <Card className="bg-white border-border shadow-sm">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">{label}</span>
            <span className={`text-2xl font-bold font-heading font-mono ${accent ?? 'text-text'}`}>{value}</span>
            {sub && <p className="text-[10px] text-text-secondary mt-0.5 leading-tight">{sub}</p>}
          </div>
          <Icon className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}

function TrendArrow({ current, previous }: { current: number; previous: number }) {
  if (current === previous) return null;
  const up = current > previous;
  return up
    ? <ChevronUp className="w-3 h-3 text-emerald-500 inline-block ml-0.5" aria-label="subiu" />
    : <ChevronDown className="w-3 h-3 text-red-400 inline-block ml-0.5" aria-label="desceu" />;
}
