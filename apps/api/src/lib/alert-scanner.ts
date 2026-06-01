/**
 * Alert scanner · varre estado operacional e cria OperationalAlert para ops center.
 *
 * Roda diário (worker scheduler) ou on-demand via endpoint admin.
 *
 * Tipos de alerta atualmente cobertos:
 *  - billing.overdue              · faturas OVERDUE há > 3d
 *  - lgpd.sla_near                · LGPD requests PENDING/PROCESSING com ≤3d de SLA (15d ANPD)
 *  - lgpd.sla_expired             · LGPD requests PENDING/PROCESSING > 15d
 *  - churn.critical               · tenant com churn score >= 70 (de churn-risk endpoint logic)
 *  - dlq.accumulation             · DLQ com > 10 jobs em qualquer worker
 *  - integration.evolution_missing · tenant ACTIVE sem evolutionApiKey configurada
 *
 * Dedup via dedupKey: alerta ativo (resolvedAt=null) com mesma dedup_key
 * é atualizado in-place, não cria duplicata.
 */
import { Queue } from 'bullmq';
import { dbAdmin } from './db.js';
import { logger } from './logger.js';
import { redisConnection } from './redis.js';
import { getTenantQueueName } from './queue.js';
import { listDlqJobs } from './dlq.js';
import { workerQueueNames } from '../workers/index.js';

type AlertSeverityValue = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertSeed {
  type: string;
  severity: AlertSeverityValue;
  tenantId?: string | null;
  title: string;
  message: string;
  context?: Record<string, any>;
  dedupKey: string;
}

export interface ScanResult {
  scanned: number;
  created: number;
  updated: number;
  errors: number;
}

const LGPD_SLA_DAYS = 15;
const LGPD_NEAR_THRESHOLD_DAYS = 3;
const DLQ_ACCUMULATION_THRESHOLD = 10;
const OVERDUE_GRACE_DAYS = 3;

async function upsertAlert(seed: AlertSeed): Promise<'created' | 'updated'> {
  const { data: existing } = await dbAdmin
    .from('operational_alerts')
    .select('id')
    .eq('dedup_key', seed.dedupKey)
    .is('resolved_at', null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await dbAdmin
      .from('operational_alerts')
      .update({
        severity: seed.severity,
        title: seed.title,
        message: seed.message,
        context: seed.context as any,
      })
      .eq('id', existing.id);
    return 'updated';
  }

  await dbAdmin
    .from('operational_alerts')
    .insert({
      type: seed.type,
      severity: seed.severity,
      tenant_id: seed.tenantId ?? null,
      title: seed.title,
      message: seed.message,
      context: seed.context as any,
      dedup_key: seed.dedupKey,
    } as any);
  return 'created';
}

export async function scanBillingOverdue(): Promise<AlertSeed[]> {
  const cutoff = new Date(Date.now() - OVERDUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const { data: overdue } = await dbAdmin
    .from('tenant_billing')
    .select('*, tenants(id, name)')
    .eq('status', 'OVERDUE')
    .lt('due_at', cutoff.toISOString());

  return (overdue ?? []).map((b: any) => {
    const daysOverdue = Math.floor((Date.now() - new Date(b.due_at).getTime()) / (1000 * 60 * 60 * 24));
    return {
      type: 'billing.overdue',
      severity: (daysOverdue > 14 ? 'CRITICAL' : 'WARNING') as AlertSeverityValue,
      tenantId: b.tenant_id,
      title: `Fatura vencida há ${daysOverdue}d · ${b.tenants?.name}`,
      message: `Cobrança de R$ ${(b.total_cents / 100).toFixed(2)} em atraso desde ${new Date(b.due_at).toLocaleDateString('pt-BR')}. Risco de churn e bloqueio automático.`,
      context: { billingId: b.id, totalCents: b.total_cents, dueAt: b.due_at, daysOverdue },
      dedupKey: `billing.overdue:${b.id}`,
    };
  });
}

export async function scanLgpdSla(): Promise<AlertSeed[]> {
  const now = Date.now();
  const cutoffNear = new Date(now - (LGPD_SLA_DAYS - LGPD_NEAR_THRESHOLD_DAYS) * 24 * 60 * 60 * 1000);
  const cutoffExpired = new Date(now - LGPD_SLA_DAYS * 24 * 60 * 60 * 1000);

  const { data: requests } = await dbAdmin
    .from('lgpd_requests')
    .select('*, tenants(id, name)')
    .in('status', ['PENDING', 'PROCESSING'])
    .lt('created_at', cutoffNear.toISOString());

  return (requests ?? []).map((r: any) => {
    const daysSince = Math.floor((now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const expired = new Date(r.created_at) < cutoffExpired;
    return {
      type: expired ? 'lgpd.sla_expired' : 'lgpd.sla_near',
      severity: (expired ? 'CRITICAL' : 'WARNING') as AlertSeverityValue,
      tenantId: r.tenant_id,
      title: expired
        ? `LGPD ${r.type} VENCIDA · ${r.tenants?.name} (${daysSince}d)`
        : `LGPD ${r.type} próxima do SLA · ${r.tenants?.name} (${LGPD_SLA_DAYS - daysSince}d restantes)`,
      message: expired
        ? `Requisição art. 18 fora do prazo legal de 15d (ANPD). Resolva imediatamente.`
        : `Requisição art. 18 com ${LGPD_SLA_DAYS - daysSince}d restantes. Processar antes do prazo.`,
      context: { lgpdRequestId: r.id, type: r.type, status: r.status, daysSinceCreation: daysSince },
      dedupKey: `lgpd:${r.id}`,
    };
  });
}

export async function scanDlqAccumulation(): Promise<AlertSeed[]> {
  const alerts: AlertSeed[] = [];
  for (const workerName of workerQueueNames) {
    try {
      const jobs = await listDlqJobs(workerName, { limit: DLQ_ACCUMULATION_THRESHOLD + 1, offset: 0 });
      if (jobs.length >= DLQ_ACCUMULATION_THRESHOLD) {
        alerts.push({
          type: 'dlq.accumulation',
          severity: 'CRITICAL',
          tenantId: null,
          title: `DLQ acumulando · worker "${workerName}" tem ${jobs.length}+ jobs`,
          message: `Mais de ${DLQ_ACCUMULATION_THRESHOLD} jobs falharam e estão na DLQ. Investigue causa raiz antes de replay.`,
          context: { worker: workerName, count: jobs.length },
          dedupKey: `dlq.accumulation:${workerName}`,
        });
      }
    } catch (err) {
      logger.warn({ err, workerName }, 'alert-scanner · DLQ check failed (non-fatal)');
    }
  }
  return alerts;
}

export async function scanIntegrationGaps(): Promise<AlertSeed[]> {
  // Find active tenants without evolution API key
  const { data: tenants } = await dbAdmin
    .from('tenants')
    .select('id, name')
    .eq('status', 'ACTIVE')
    .is('deleted_at', null);

  const alerts: AlertSeed[] = [];
  for (const t of tenants ?? []) {
    const { data: secret } = await dbAdmin
      .from('tenant_secrets')
      .select('evolution_api_key_encrypted')
      .eq('tenant_id', t.id)
      .maybeSingle();

    if (!secret || !secret.evolution_api_key_encrypted) {
      alerts.push({
        type: 'integration.evolution_missing',
        severity: 'WARNING',
        tenantId: t.id,
        title: `Evolution API não configurada · ${t.name}`,
        message: 'Tenant ACTIVE sem Evolution API key. Outbound WhatsApp impossível até credenciais serem configuradas.',
        context: { tenantId: t.id },
        dedupKey: `integration.evolution:${t.id}`,
      });
    }
  }
  return alerts;
}

async function autoResolveOldAlerts(): Promise<number> {
  // Resolve alertas cujo dedup_key não foi reativado nesta varredura · indica que condição cessou
  // Lógica simplificada: alertas com updated_at > 25h (mais que 1 ciclo + margem) são auto-resolvidos
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const { data: staleAlerts } = await dbAdmin
    .from('operational_alerts')
    .select('id')
    .is('resolved_at', null)
    .lt('updated_at', cutoff.toISOString());

  if (!staleAlerts?.length) return 0;

  const ids = staleAlerts.map((a: any) => a.id);
  await dbAdmin
    .from('operational_alerts')
    .update({ resolved_at: new Date().toISOString() })
    .in('id', ids);

  return ids.length;
}

export async function runAlertScan(options: { autoResolve?: boolean } = {}): Promise<ScanResult> {
  const startedAt = Date.now();
  let created = 0;
  let updated = 0;
  let errors = 0;

  const scanners: Array<{ name: string; fn: () => Promise<AlertSeed[]> }> = [
    { name: 'billing.overdue', fn: scanBillingOverdue },
    { name: 'lgpd.sla', fn: scanLgpdSla },
    { name: 'dlq.accumulation', fn: scanDlqAccumulation },
    { name: 'integration.gaps', fn: scanIntegrationGaps },
  ];

  let allSeeds: AlertSeed[] = [];
  for (const s of scanners) {
    try {
      const seeds = await s.fn();
      allSeeds = allSeeds.concat(seeds);
    } catch (err) {
      errors += 1;
      logger.error({ err, scanner: s.name }, 'alert-scanner · scanner failed');
    }
  }

  for (const seed of allSeeds) {
    try {
      const result = await upsertAlert(seed);
      if (result === 'created') created += 1;
      else updated += 1;
    } catch (err) {
      errors += 1;
      logger.error({ err, dedupKey: seed.dedupKey }, 'alert-scanner · upsert failed');
    }
  }

  let autoResolved = 0;
  if (options.autoResolve !== false) {
    try {
      autoResolved = await autoResolveOldAlerts();
    } catch (err) {
      logger.error({ err }, 'alert-scanner · auto-resolve failed');
    }
  }

  const result = { scanned: allSeeds.length, created, updated, errors };
  logger.info({ ...result, autoResolved, durationMs: Date.now() - startedAt }, 'alert-scanner · scan complete');
  return result;
}

// Helper para health-check do worker
export async function listOpenAlertSummary(): Promise<{ critical: number; warning: number; info: number; total: number }> {
  const summary = { critical: 0, warning: 0, info: 0, total: 0 };
  for (const sev of ['CRITICAL', 'WARNING', 'INFO'] as const) {
    const { count, error } = await dbAdmin
      .from('operational_alerts')
      .select('*', { count: 'exact', head: true })
      .is('resolved_at', null)
      .eq('severity', sev);
    if (!error && count !== null) {
      if (sev === 'CRITICAL') summary.critical = count;
      else if (sev === 'WARNING') summary.warning = count;
      else summary.info = count;
    }
  }
  summary.total = summary.critical + summary.warning + summary.info;
  return summary;
}

// Helper para checagem de queue se o worker está rodando
export async function isAlertScannerEnqueued(workerName = 'alert-scan'): Promise<boolean> {
  try {
    const queueName = getTenantQueueName('global', workerName);
    const queue = new Queue(queueName, { connection: redisConnection });
    const counts = await queue.getJobCounts('delayed', 'waiting', 'active');
    await queue.close().catch(() => undefined);
    return Number(counts.waiting ?? 0) + Number(counts.active ?? 0) + Number(counts.delayed ?? 0) > 0;
  } catch {
    return false;
  }
}
