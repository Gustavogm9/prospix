'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Badge, Button, toast } from '@prospix/ui';
import { Activity, AlertCircle, CheckCircle2, RefreshCw, Loader2, Inbox, AlertTriangle, Zap } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface QueueSnapshot {
  worker: string;
  queueName: string;
  counts: QueueCounts;
  dlq: { waiting: number; replayable: boolean };
}

interface ObservabilityPayload {
  generatedAt: string;
  durationMs: number;
  totals: { waiting: number; active: number; failed: number; dlq: number };
  queues: QueueSnapshot[];
  alertSinks: { sentry: boolean; slack: boolean };
}

function formatRelative(iso: string): string {
  try {
    const date = new Date(iso);
    const diffSec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (diffSec < 5) return 'agora';
    if (diffSec < 60) return `há ${diffSec}s`;
    if (diffSec < 3600) return `há ${Math.round(diffSec / 60)}min`;
    return date.toLocaleTimeString('pt-BR');
  } catch {
    return iso;
  }
}

export default function Observability() {
  const [data, setData] = useState<ObservabilityPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchSnapshot = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const start = Date.now();

      // Since BullMQ is being removed, build an observability snapshot
      // from operational_alerts and system state
      const [alertsRes, recentAlertsRes] = await Promise.all([
        supabaseAdmin
          .from('operational_alerts')
          .select('id, severity, resolved_at, ack_at, created_at')
          .order('created_at', { ascending: false })
          .limit(500),
        supabaseAdmin
          .from('operational_alerts')
          .select('id, severity, resolved_at, ack_at, title, tenant_id, tenants(name), created_at')
          .is('resolved_at', null)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      const allAlerts = alertsRes.data ?? [];
      const unresolvedAlerts = recentAlertsRes.data ?? [];

      // Categorize alerts into synthetic queue-like buckets
      const critical = unresolvedAlerts.filter((a: any) => a.severity === 'CRITICAL');
      const warning = unresolvedAlerts.filter((a: any) => a.severity === 'WARNING');
      const info = unresolvedAlerts.filter((a: any) => a.severity === 'INFO');
      const acknowledged = unresolvedAlerts.filter((a: any) => a.ack_at != null);
      const resolvedRecent = allAlerts.filter((a: any) => a.resolved_at != null);

      // Build synthetic queue snapshots from alert categories
      const queues: QueueSnapshot[] = [];
      if (critical.length > 0 || warning.length > 0 || info.length > 0) {
        queues.push({
          worker: 'alert-processor',
          queueName: 'operational_alerts',
          counts: {
            waiting: unresolvedAlerts.filter((a: any) => !a.ack_at).length,
            active: acknowledged.length,
            completed: resolvedRecent.length,
            failed: critical.length,
            delayed: 0,
          },
          dlq: { waiting: critical.filter((a: any) => !a.ack_at).length, replayable: false },
        });
      }

      // Check for sentry/slack env vars presence (best-effort client-side)
      const hasSentry = typeof process !== 'undefined' && !!process.env.NEXT_PUBLIC_SENTRY_DSN;
      const hasSlack = false; // Slack webhook is server-side only

      const durationMs = Date.now() - start;

      setData({
        generatedAt: new Date().toISOString(),
        durationMs,
        totals: {
          waiting: unresolvedAlerts.filter((a: any) => !a.ack_at).length,
          active: acknowledged.length,
          failed: critical.length,
          dlq: critical.filter((a: any) => !a.ack_at).length,
        },
        queues,
        alertSinks: { sentry: hasSentry, slack: hasSlack },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar observabilidade.';
      setLoadError(message);
      if (!silent) toast.error('Erro de observabilidade', message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSnapshot();
    const interval = setInterval(() => fetchSnapshot(true), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" aria-label="Carregando observabilidade" />
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <Card className="bg-white border-error/30 shadow-sm" data-testid="observability-error-state">
        <CardContent className="py-10 text-center">
          <AlertCircle className="w-8 h-8 text-error-text mx-auto mb-2" aria-hidden />
          <p className="text-sm text-text font-semibold">Não foi possível carregar a observabilidade</p>
          <p className="text-xs text-text-secondary mt-1">{loadError}</p>
          <Button
            onClick={() => fetchSnapshot()}
            className="mt-4 bg-primary hover:bg-primary-hover text-white text-xs px-4 h-9 rounded-lg"
          >
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 animate-fadeIn" data-testid="observability-loaded">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" aria-hidden />
            Observabilidade
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Snapshot atualizado {formatRelative(data.generatedAt)} · refresh automático a cada 30s · {data.durationMs}ms
          </p>
        </div>
        <Button
          onClick={() => fetchSnapshot()}
          disabled={isRefreshing}
          className="bg-surface hover:bg-surface-sunken text-text border border-border font-medium px-3 py-2 rounded-xl text-xs flex items-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Aguardando</span>
                <span className="text-2xl font-bold font-heading text-text font-mono">{data.totals.waiting}</span>
              </div>
              <Inbox className="w-4 h-4 text-text-secondary" aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Em execução</span>
                <span className="text-2xl font-bold font-heading text-text font-mono">{data.totals.active}</span>
              </div>
              <Zap className="w-4 h-4 text-primary" aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="pt-5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Falhas</span>
                <span className={`text-2xl font-bold font-heading font-mono ${data.totals.failed > 0 ? 'text-error-text' : 'text-text'}`}>{data.totals.failed}</span>
              </div>
              <AlertTriangle className={`w-4 h-4 ${data.totals.failed > 0 ? 'text-error-text' : 'text-text-secondary'}`} aria-hidden />
            </div>
          </CardContent>
        </Card>
        <Card className={`bg-white border shadow-sm ${data.totals.dlq > 0 ? 'border-amber-400' : 'border-border'}`}>
          <CardContent className="pt-5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">DLQ</span>
                <span className={`text-2xl font-bold font-heading font-mono ${data.totals.dlq > 0 ? 'text-amber-700' : 'text-text'}`}>{data.totals.dlq}</span>
              </div>
              <AlertCircle className={`w-4 h-4 ${data.totals.dlq > 0 ? 'text-amber-600' : 'text-text-secondary'}`} aria-hidden />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Canais de alerta</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Sinks configurados que recebem eventos críticos (DLQ, churn, falhas exauridas).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 pt-2">
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${data.alertSinks.sentry ? 'bg-success-soft border-success/30' : 'bg-surface-sunken border-border'}`}
            aria-label={data.alertSinks.sentry ? 'Sentry ativo' : 'Sentry desativado'}
          >
            {data.alertSinks.sentry ? <CheckCircle2 className="w-4 h-4 text-success-text" aria-hidden /> : <AlertCircle className="w-4 h-4 text-text-secondary" aria-hidden />}
            <span className="text-xs font-semibold text-text">Sentry</span>
            <Badge className={`text-[9px] px-1.5 py-0 ${data.alertSinks.sentry ? 'bg-success-soft text-success-text border border-success/20' : 'bg-surface-sunken text-text-secondary border border-border/60'}`}>
              {data.alertSinks.sentry ? 'Ativo' : 'Sem DSN'}
            </Badge>
          </div>
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${data.alertSinks.slack ? 'bg-success-soft border-success/30' : 'bg-surface-sunken border-border'}`}
            aria-label={data.alertSinks.slack ? 'Slack ativo' : 'Slack desativado'}
          >
            {data.alertSinks.slack ? <CheckCircle2 className="w-4 h-4 text-success-text" aria-hidden /> : <AlertCircle className="w-4 h-4 text-text-secondary" aria-hidden />}
            <span className="text-xs font-semibold text-text">Slack</span>
            <Badge className={`text-[9px] px-1.5 py-0 ${data.alertSinks.slack ? 'bg-success-soft text-success-text border border-success/20' : 'bg-surface-sunken text-text-secondary border border-border/60'}`}>
              {data.alertSinks.slack ? 'Ativo' : 'Sem webhook'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Alertas Operacionais (substitui filas BullMQ)</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Visão baseada em alertas operacionais do banco de dados. BullMQ foi removido.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] text-text-secondary font-semibold uppercase tracking-wider">
                  <th className="text-left py-2 px-2">Worker</th>
                  <th className="text-right py-2 px-2">Aguardando</th>
                  <th className="text-right py-2 px-2">Ativo</th>
                  <th className="text-right py-2 px-2">Concluído</th>
                  <th className="text-right py-2 px-2">Falhas</th>
                  <th className="text-right py-2 px-2">DLQ</th>
                  <th className="text-center py-2 px-2">Replay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.queues.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-text-secondary">
                      Nenhum alerta operacional pendente — sistema saudável ✓
                    </td>
                  </tr>
                ) : (
                  data.queues.map((q) => {
                    const hasFailures = q.counts.failed > 0;
                    const hasDlq = q.dlq.waiting > 0;
                    return (
                      <tr key={q.worker} className="hover:bg-surface-sunken/40 transition-colors">
                        <td className="py-2 px-2 font-mono text-text">{q.worker}</td>
                        <td className="py-2 px-2 text-right font-mono text-text-secondary">{q.counts.waiting}</td>
                        <td className="py-2 px-2 text-right font-mono text-text-secondary">{q.counts.active}</td>
                        <td className="py-2 px-2 text-right font-mono text-text-secondary">{q.counts.completed}</td>
                        <td className={`py-2 px-2 text-right font-mono ${hasFailures ? 'text-error-text font-semibold' : 'text-text-secondary'}`}>{q.counts.failed}</td>
                        <td className={`py-2 px-2 text-right font-mono ${hasDlq ? 'text-amber-700 font-semibold' : 'text-text-secondary'}`}>{q.dlq.waiting}</td>
                        <td className="py-2 px-2 text-center">
                          {q.dlq.replayable ? (
                            <Badge className="bg-success-soft text-success-text border border-success/20 text-[9px] px-1.5 py-0">Sim</Badge>
                          ) : (
                            <Badge className="bg-surface-sunken text-text-secondary border border-border/60 text-[9px] px-1.5 py-0">Não</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
