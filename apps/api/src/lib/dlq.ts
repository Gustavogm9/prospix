/**
 * Dead Letter Queue (DLQ) fisica + replay controlado.
 *
 * Resolve AUD-P1-021 (DLQ nominal -> fisica).
 *
 * Cada worker `worker_name` ganha uma fila DLQ paralela `dlq-<worker_name>`.
 * Quando um job esgota tentativas (`failed-exhausted`), e enfileirado na DLQ
 * com snapshot completo: payload original, tenant_id, trace_id, failed_reason,
 * attempts_made, source_job_id, enqueued_at.
 *
 * Replay e SEMPRE manual e respeita allowlist do
 * docs/auditoria/runbook-dlq-replay.md. Workers sem prova de idempotencia
 * retornam 403 em tentativa de replay.
 */
import { Queue, type Job } from 'bullmq';
import { logger } from './logger.js';
import { createTenantQueue, getTenantQueueName } from './queue.js';
import { redisConnection } from './redis.js';

// ── Constantes ──────────────────────────────────────────────────────────────

/**
 * Workers que tem replay automatizado aprovado.
 * Fonte: docs/auditoria/runbook-dlq-replay.md.
 *
 * Para adicionar um worker aqui:
 *  1. Provar idempotencia em teste Redis/Postgres reais
 *  2. Atualizar o runbook com a evidencia
 *  3. Mover linha do worker para esta lista
 *  4. Atualizar `AUD-P1-021` na matriz de achados
 */
export const DLQ_REPLAYABLE_WORKERS = new Set<string>([
  'health-check',
]);

/** TTL maximo de um job na DLQ antes de ser purgado automaticamente. */
export const DLQ_RETENTION_DAYS = 30;

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface DlqEntry {
  worker: string;
  source_job_id: string;
  source_job_name?: string;
  source_queue: string;
  tenant_id?: string;
  trace_id?: string;
  attempts_made: number;
  attempts: number;
  failed_reason?: string;
  source_payload: Record<string, unknown>;
  source_timestamp?: number;
  enqueued_at: string;
}

export interface DlqJobSnapshot {
  name?: string;
  attemptsMade?: number;
  opts?: { attempts?: number };
  data?: Record<string, unknown> & { tenant_id?: unknown; trace_id?: unknown };
  timestamp?: number;
}

// ── Naming ──────────────────────────────────────────────────────────────────

export function getDlqQueueName(workerName: string): string {
  return `dlq-${workerName}`;
}

export function getDlqReplayJobId(sourceJobId: string): string {
  return `dlq-replay-${sourceJobId}-${Date.now()}`;
}

// ── Builders ────────────────────────────────────────────────────────────────

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function buildDlqEntry(
  workerName: string,
  sourceQueueName: string,
  sourceJobId: string,
  failedReason: string | undefined,
  job: DlqJobSnapshot,
): DlqEntry {
  return {
    worker: workerName,
    source_job_id: sourceJobId,
    source_job_name: job.name,
    source_queue: sourceQueueName,
    tenant_id: asString(job.data?.tenant_id),
    trace_id: asString(job.data?.trace_id),
    attempts_made: job.attemptsMade ?? 0,
    attempts: job.opts?.attempts ?? 1,
    failed_reason: failedReason,
    source_payload: asObject(job.data),
    source_timestamp: job.timestamp,
    enqueued_at: new Date().toISOString(),
  };
}

// ── DLQ enqueue ─────────────────────────────────────────────────────────────

/**
 * Enfileira um job esgotado na DLQ fisica.
 * Idempotente por `source_job_id` (mesma falha duas vezes nao duplica).
 */
export async function enqueueToDlq(workerName: string, entry: DlqEntry): Promise<void> {
  const dlqName = getDlqQueueName(workerName);
  const dlq = new Queue(dlqName, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: false,
      removeOnFail: false,
      // Garante retencao maxima · DLQ pode ser purgada por endpoint admin
    },
  });

  try {
    await dlq.add('dlq-entry', entry, {
      // Job ID deterministico evita duplicacao se observer dispara 2x
      jobId: entry.source_job_id,
    });
    logger.error(
      {
        queue: dlqName,
        worker: workerName,
        source_job_id: entry.source_job_id,
        source_job_name: entry.source_job_name,
        tenant_id: entry.tenant_id,
        trace_id: entry.trace_id,
        attempts_made: entry.attempts_made,
        attempts: entry.attempts,
        failed_reason: entry.failed_reason,
        runbook: 'docs/auditoria/runbook-dlq-replay.md',
      },
      'queue:dlq-enqueued',
    );
  } finally {
    await dlq.close();
  }
}

// ── DLQ listagem ────────────────────────────────────────────────────────────

export interface DlqListOptions {
  limit?: number;
  offset?: number;
  tenantId?: string;
}

export interface DlqJobView {
  dlq_job_id: string;
  entry: DlqEntry;
  attempts_on_dlq: number;
  replayed_at?: string;
  replayable: boolean;
  replayable_reason?: string;
}

export async function listDlqJobs(
  workerName: string,
  options: DlqListOptions = {},
): Promise<DlqJobView[]> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;
  const dlqName = getDlqQueueName(workerName);
  const dlq = new Queue(dlqName, { connection: redisConnection });

  try {
    // BullMQ getJobs retorna em ordem; queremos os "waiting" (nao processados)
    // e "delayed" como pendentes; "completed" como ja replayed/cleared.
    const jobs = await dlq.getJobs(['waiting', 'delayed', 'paused', 'completed'], offset, offset + limit - 1, false);
    const replayable = DLQ_REPLAYABLE_WORKERS.has(workerName);

    return jobs
      .filter((job): job is Job => job !== null && job.id !== undefined)
      .filter((job) => {
        if (!options.tenantId) return true;
        const entry = job.data as DlqEntry;
        return entry.tenant_id === options.tenantId;
      })
      .map((job) => {
        const entry = job.data as DlqEntry;
        return {
          dlq_job_id: String(job.id),
          entry,
          attempts_on_dlq: job.attemptsMade,
          replayed_at:
            job.returnvalue && typeof job.returnvalue === 'object' && 'replayed_at' in job.returnvalue
              ? String((job.returnvalue as Record<string, unknown>).replayed_at)
              : undefined,
          replayable,
          replayable_reason: replayable
            ? undefined
            : `worker '${workerName}' nao esta na DLQ_REPLAYABLE_WORKERS allowlist; ver docs/auditoria/runbook-dlq-replay.md`,
        };
      });
  } finally {
    await dlq.close();
  }
}

// ── DLQ replay ──────────────────────────────────────────────────────────────

export class DlqReplayNotAllowedError extends Error {
  constructor(public readonly workerName: string) {
    super(
      `Replay nao permitido para worker '${workerName}'. ` +
        `Esta fora da DLQ_REPLAYABLE_WORKERS allowlist. ` +
        `Ver docs/auditoria/runbook-dlq-replay.md.`,
    );
    this.name = 'DlqReplayNotAllowedError';
  }
}

export class DlqJobNotFoundError extends Error {
  constructor(workerName: string, dlqJobId: string) {
    super(`DLQ job '${dlqJobId}' nao encontrado na fila dlq-${workerName}`);
    this.name = 'DlqJobNotFoundError';
  }
}

export interface DlqReplayOptions {
  /** Se true, valida que job pode ser replayed mas NAO reenfileira. */
  dryRun?: boolean;
  /** Usuario admin que aprovou o replay. */
  approvedBy?: string;
  /** Motivo registrado em audit log. */
  reason?: string;
}

export interface DlqReplayResult {
  ok: true;
  worker: string;
  dlq_job_id: string;
  source_job_id: string;
  replayed_into: string;
  new_job_id: string;
  dry_run: boolean;
  approved_by?: string;
  reason?: string;
  replayed_at: string;
}

/**
 * Replay manual de um job da DLQ.
 *
 * Regras:
 *  1. Worker DEVE estar em DLQ_REPLAYABLE_WORKERS (senao lanca DlqReplayNotAllowedError)
 *  2. Job DEVE existir na DLQ (senao lanca DlqJobNotFoundError)
 *  3. Reenfileira na fila original com o source_payload + replay_metadata
 *  4. Marca DLQ job como 'completed' com return value contendo timestamp + replay_into
 *  5. Loga 'queue:dlq-replayed' com approvedBy + reason
 *
 * Em dry-run: apenas valida (passos 1-2), NAO toca em fila nem marca o job.
 */
export async function replayDlqJob(
  workerName: string,
  dlqJobId: string,
  options: DlqReplayOptions = {},
): Promise<DlqReplayResult> {
  if (!DLQ_REPLAYABLE_WORKERS.has(workerName)) {
    throw new DlqReplayNotAllowedError(workerName);
  }

  const dlqName = getDlqQueueName(workerName);
  const dlq = new Queue(dlqName, { connection: redisConnection });

  try {
    const job = await dlq.getJob(dlqJobId);
    if (!job) {
      throw new DlqJobNotFoundError(workerName, dlqJobId);
    }

    const entry = job.data as DlqEntry;
    const replayedAt = new Date().toISOString();

    if (options.dryRun) {
      logger.info(
        {
          queue: dlqName,
          worker: workerName,
          dlq_job_id: dlqJobId,
          source_job_id: entry.source_job_id,
          dry_run: true,
          approved_by: options.approvedBy,
          reason: options.reason,
        },
        'queue:dlq-replay-dry-run',
      );

      return {
        ok: true,
        worker: workerName,
        dlq_job_id: dlqJobId,
        source_job_id: entry.source_job_id,
        replayed_into: entry.source_queue,
        new_job_id: 'dry-run',
        dry_run: true,
        approved_by: options.approvedBy,
        reason: options.reason,
        replayed_at: replayedAt,
      };
    }

    // Reenfileira na fila original via createTenantQueue
    // (todas as filas atuais sao queue-global-<worker>, mas a API mantem assinatura tenant-aware)
    const targetTenantId = entry.tenant_id ?? 'global';
    const targetQueue = createTenantQueue(targetTenantId, workerName);

    const replayJobId = getDlqReplayJobId(entry.source_job_id);
    const payloadWithReplayMetadata = {
      ...entry.source_payload,
      _replay_metadata: {
        replayed_from_dlq: dlqJobId,
        original_source_job_id: entry.source_job_id,
        replayed_at: replayedAt,
        approved_by: options.approvedBy,
        reason: options.reason,
      },
    };

    try {
      await targetQueue.add(entry.source_job_name ?? 'dlq-replay', payloadWithReplayMetadata, {
        jobId: replayJobId,
      });
    } finally {
      await targetQueue.close();
    }

    // Marca o DLQ job como completed (preserva historico mas tira da lista de pendentes)
    await job.moveToCompleted(
      { replayed_at: replayedAt, replayed_into: entry.source_queue, new_job_id: replayJobId },
      'manual-replay',
      false,
    );

    logger.info(
      {
        queue: dlqName,
        worker: workerName,
        dlq_job_id: dlqJobId,
        source_job_id: entry.source_job_id,
        new_job_id: replayJobId,
        replayed_into: entry.source_queue,
        approved_by: options.approvedBy,
        reason: options.reason,
      },
      'queue:dlq-replayed',
    );

    return {
      ok: true,
      worker: workerName,
      dlq_job_id: dlqJobId,
      source_job_id: entry.source_job_id,
      replayed_into: entry.source_queue,
      new_job_id: replayJobId,
      dry_run: false,
      approved_by: options.approvedBy,
      reason: options.reason,
      replayed_at: replayedAt,
    };
  } finally {
    await dlq.close();
  }
}

// ── DLQ purge ───────────────────────────────────────────────────────────────

/**
 * Remove um job da DLQ sem replay (caso ja resolvido fora da plataforma).
 * Sempre permitido (independente de allowlist), mas exige `approvedBy` + `reason`.
 */
export async function purgeDlqJob(
  workerName: string,
  dlqJobId: string,
  approvedBy: string,
  reason: string,
): Promise<{ ok: true; purged_at: string }> {
  const dlqName = getDlqQueueName(workerName);
  const dlq = new Queue(dlqName, { connection: redisConnection });

  try {
    const job = await dlq.getJob(dlqJobId);
    if (!job) {
      throw new DlqJobNotFoundError(workerName, dlqJobId);
    }

    const entry = job.data as DlqEntry;
    const purgedAt = new Date().toISOString();
    await job.remove();

    logger.warn(
      {
        queue: dlqName,
        worker: workerName,
        dlq_job_id: dlqJobId,
        source_job_id: entry.source_job_id,
        tenant_id: entry.tenant_id,
        approved_by: approvedBy,
        reason,
        purged_at: purgedAt,
      },
      'queue:dlq-purged',
    );

    return { ok: true, purged_at: purgedAt };
  } finally {
    await dlq.close();
  }
}

// ── Helper consumido por queue.ts observer ──────────────────────────────────

/**
 * Helper consumido por `observeQueueFailures()` em `queue.ts`.
 * Recebe o snapshot do job esgotado e enfileira na DLQ.
 * Idempotente.
 */
export async function handleFailedExhausted(
  workerName: string,
  sourceJobId: string,
  failedReason: string | undefined,
  job: DlqJobSnapshot,
): Promise<void> {
  const sourceQueueName = getTenantQueueName('global', workerName);
  const entry = buildDlqEntry(workerName, sourceQueueName, sourceJobId, failedReason, job);
  await enqueueToDlq(workerName, entry);
}
