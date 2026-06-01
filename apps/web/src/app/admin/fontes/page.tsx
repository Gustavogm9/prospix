'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@prospix/ui';
import { MapPin, RefreshCw, Loader2, AlertCircle, TrendingUp, Layers, Award, BarChart3 } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface SourceBreakdown {
  source: string;
  count: number;
  percentage: number;
  convertedCount: number;
  conversionRate: number;
}

interface LeadSourcesData {
  total: number;
  breakdown: SourceBreakdown[];
}

/* ------------------------------------------------------------------ */
/* Source labels (pt-BR) + bar colors                                   */
/* ------------------------------------------------------------------ */

const SOURCE_LABELS: Record<string, string> = {
  GOOGLE_MAPS: 'Google Maps',
  RECEITA_FEDERAL: 'Receita Federal',
  CRM_SP: 'CRM-SP',
  OAB_SP: 'OAB-SP',
  CRO_SP: 'CRO-SP',
  LINKEDIN: 'LinkedIn',
  REFERRAL: 'Indicação',
  LANDING_PAGE: 'Landing Page',
  MANUAL: 'Manual',
  IMPORTED: 'Importado',
};

const SOURCE_COLORS: Record<string, string> = {
  GOOGLE_MAPS: 'bg-blue-500',
  RECEITA_FEDERAL: 'bg-emerald-500',
  CRM_SP: 'bg-violet-500',
  OAB_SP: 'bg-amber-500',
  CRO_SP: 'bg-rose-500',
  LINKEDIN: 'bg-sky-500',
  REFERRAL: 'bg-indigo-500',
  LANDING_PAGE: 'bg-teal-500',
  MANUAL: 'bg-slate-500',
  IMPORTED: 'bg-orange-500',
};

const SOURCE_BADGE_STYLES: Record<string, string> = {
  GOOGLE_MAPS: 'bg-blue-50 text-blue-700 border-blue-200',
  RECEITA_FEDERAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CRM_SP: 'bg-violet-50 text-violet-700 border-violet-200',
  OAB_SP: 'bg-amber-50 text-amber-700 border-amber-200',
  CRO_SP: 'bg-rose-50 text-rose-700 border-rose-200',
  LINKEDIN: 'bg-sky-50 text-sky-700 border-sky-200',
  REFERRAL: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  LANDING_PAGE: 'bg-teal-50 text-teal-700 border-teal-200',
  MANUAL: 'bg-slate-50 text-slate-700 border-slate-200',
  IMPORTED: 'bg-orange-50 text-orange-700 border-orange-200',
};

export default function LeadSourcesMonitor() {
  const [data, setData] = useState<LeadSourcesData | null>(null);
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

  /* ---------- Fetch lead sources ---------- */
  const fetchSources = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (filterTenantId) params.set('tenantId', filterTenantId);

      const response = await adminApiClient.get(`/admin/lead-sources?${params.toString()}`);
      setData(response.data?.data ?? null);
    } catch {
      setLoadError('Falha ao carregar fontes de leads.');
    } finally {
      setIsLoading(false);
    }
  }, [filterTenantId]);

  /* ---------- Initial + filter-driven load ---------- */
  useEffect(() => {
    fetchSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTenantId]);

  /* ---------- Auto-refresh every 60s ---------- */
  useEffect(() => {
    const timer = setInterval(fetchSources, 60_000);
    return () => clearInterval(timer);
  }, [fetchSources]);

  /* ---------- Computed KPIs ---------- */
  const activeSources = data?.breakdown.length ?? 0;
  const largestSource = data?.breakdown[0];
  const bestConversion = data?.breakdown.reduce<SourceBreakdown | null>(
    (best, s) => (s.conversionRate > (best?.conversionRate ?? 0) ? s : best),
    null,
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" aria-hidden />
            Fontes de Leads
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Distribuição de leads por fonte cross-tenant. Atualização automática a cada 60 s.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={fetchSources}
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
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Total Leads</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{data?.total.toLocaleString('pt-BR') ?? '—'}</span>
              </div>
              <BarChart3 className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Fontes Ativas</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">{activeSources || '—'}</span>
              </div>
              <Layers className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Maior Fonte</span>
                <span className="text-lg font-bold font-heading text-text truncate block max-w-[140px]">
                  {largestSource ? SOURCE_LABELS[largestSource.source] ?? largestSource.source : '—'}
                </span>
              </div>
              <Award className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Maior Taxa Conversão</span>
                <span className="text-2xl font-bold font-heading font-mono text-text">
                  {bestConversion ? `${bestConversion.conversionRate}%` : '—'}
                </span>
                {bestConversion && (
                  <span className="text-[10px] text-text-secondary block">
                    {SOURCE_LABELS[bestConversion.source] ?? bestConversion.source}
                  </span>
                )}
              </div>
              <TrendingUp className="w-4 h-4 text-text-secondary opacity-80" aria-hidden />
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

      {/* ── Source breakdown ── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Distribuição por fonte</CardTitle>
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
          ) : !data || data.breakdown.length === 0 ? (
            <div className="text-center py-10">
              <MapPin className="w-6 h-6 text-text-secondary mx-auto mb-2" aria-hidden />
              <p className="text-sm font-semibold text-text">Nenhuma fonte encontrada.</p>
              <p className="text-[11px] text-text-secondary mt-1">Ajuste os filtros ou aguarde novos leads.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.breakdown.map((s) => (
                <div key={s.source} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] px-2 py-0.5 border ${SOURCE_BADGE_STYLES[s.source] ?? 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                        {SOURCE_LABELS[s.source] ?? s.source}
                      </Badge>
                      <span className="text-xs font-mono text-text-secondary">
                        {s.count.toLocaleString('pt-BR')} leads
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-text-secondary">
                        <span className="font-semibold text-text">{s.convertedCount}</span> convertidos
                      </span>
                      <span className="font-mono font-semibold text-text">{s.conversionRate}%</span>
                      <span className="font-mono text-text-secondary">{s.percentage}%</span>
                    </div>
                  </div>
                  <div className="w-full bg-surface-sunken rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-out ${SOURCE_COLORS[s.source] ?? 'bg-slate-400'}`}
                      style={{ width: `${Math.max(s.percentage, 1)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
