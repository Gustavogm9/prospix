/**
 * Testes unitarios do DLQ fisico (AUD-P1-021).
 * Sem Redis · so logica pura de builders + allowlist + errors.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDlqEntry,
  DLQ_REPLAYABLE_WORKERS,
  DlqJobNotFoundError,
  DlqReplayNotAllowedError,
  getDlqQueueName,
  getDlqReplayJobId,
  type DlqJobSnapshot,
} from '../../src/lib/dlq.js';

describe('DLQ · naming', () => {
  it('getDlqQueueName retorna prefixo dlq-', () => {
    expect(getDlqQueueName('process-inbound')).toBe('dlq-process-inbound');
    expect(getDlqQueueName('health-check')).toBe('dlq-health-check');
  });

  it('getDlqReplayJobId retorna ID determinístico + timestamp', () => {
    const id1 = getDlqReplayJobId('source-123');
    expect(id1).toMatch(/^dlq-replay-source-123-\d+$/);
  });
});

describe('DLQ · allowlist (runbook)', () => {
  it('apenas health-check esta na allowlist por enquanto', () => {
    expect(DLQ_REPLAYABLE_WORKERS.has('health-check')).toBe(true);
    expect(DLQ_REPLAYABLE_WORKERS.has('process-inbound')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('send-messages')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('send-notification')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('schedule-meeting')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('capture-google-maps')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('enrich-leads')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('daily-digest')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('usage-aggregation')).toBe(false);
    expect(DLQ_REPLAYABLE_WORKERS.has('billing-suspension')).toBe(false);
  });
});

describe('DLQ · buildDlqEntry', () => {
  it('extrai metadados completos do job snapshot', () => {
    const job: DlqJobSnapshot = {
      name: 'send-text',
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: {
        tenant_id: '11111111-1111-1111-1111-111111111111',
        trace_id: 'trace-abc',
        recipient: '+5511999990001',
        message: 'redacted',
      },
      timestamp: 1779540000000,
    };

    const entry = buildDlqEntry(
      'send-messages',
      'queue-global-send-messages',
      'source-job-1',
      'OpenAI 5xx',
      job,
    );

    expect(entry.worker).toBe('send-messages');
    expect(entry.source_queue).toBe('queue-global-send-messages');
    expect(entry.source_job_id).toBe('source-job-1');
    expect(entry.source_job_name).toBe('send-text');
    expect(entry.tenant_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(entry.trace_id).toBe('trace-abc');
    expect(entry.attempts_made).toBe(3);
    expect(entry.attempts).toBe(3);
    expect(entry.failed_reason).toBe('OpenAI 5xx');
    expect(entry.source_payload).toEqual(job.data);
    expect(entry.source_timestamp).toBe(1779540000000);
    expect(typeof entry.enqueued_at).toBe('string');
    // ISO date
    expect(() => new Date(entry.enqueued_at).toISOString()).not.toThrow();
  });

  it('aplica defaults quando snapshot incompleto', () => {
    const job: DlqJobSnapshot = {};
    const entry = buildDlqEntry(
      'health-check',
      'queue-global-health-check',
      'job-x',
      undefined,
      job,
    );

    expect(entry.attempts_made).toBe(0);
    expect(entry.attempts).toBe(1);
    expect(entry.failed_reason).toBeUndefined();
    expect(entry.tenant_id).toBeUndefined();
    expect(entry.trace_id).toBeUndefined();
    expect(entry.source_payload).toEqual({});
  });

  it('rejeita tenant_id nao-string como undefined', () => {
    const job: DlqJobSnapshot = {
      data: { tenant_id: 12345 as unknown as string, trace_id: '' },
    };
    const entry = buildDlqEntry('send-messages', 'q', 'j', undefined, job);
    expect(entry.tenant_id).toBeUndefined();
    expect(entry.trace_id).toBeUndefined(); // string vazia rejeitada
  });
});

describe('DLQ · errors', () => {
  it('DlqReplayNotAllowedError menciona worker e runbook', () => {
    const err = new DlqReplayNotAllowedError('process-inbound');
    expect(err.message).toContain('process-inbound');
    expect(err.message).toContain('runbook');
    expect(err.name).toBe('DlqReplayNotAllowedError');
  });

  it('DlqJobNotFoundError menciona worker e id', () => {
    const err = new DlqJobNotFoundError('health-check', 'job-x');
    expect(err.message).toContain('dlq-health-check');
    expect(err.message).toContain('job-x');
    expect(err.name).toBe('DlqJobNotFoundError');
  });
});
