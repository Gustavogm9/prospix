/**
 * Testes de alert-sink (AUD-P1-021 + LGPD config-time).
 * Mocka @sentry/node + fetch (Slack).
 * Sem mock global de env (evita leak entre tests paralelos).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentryCaptureMessage = vi.fn();
const sentryInit = vi.fn();

vi.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => sentryInit(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
}));

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

// Seta env vars ANTES de importar
process.env.SENTRY_DSN = 'https://mock@sentry.io/123';
process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/services/MOCK';

const { initAlertSinks, notifyCriticalAlert, getAlertSinkStatus } = await import(
  '../../src/lib/alert-sink.js'
);

describe('alert-sink', () => {
  beforeEach(() => {
    sentryCaptureMessage.mockReset();
    sentryInit.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    // Stub fetch APENAS durante este describe · restore no afterEach
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initAlertSinks inicializa Sentry quando SENTRY_DSN setado', () => {
    initAlertSinks();
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://mock@sentry.io/123', tracesSampleRate: 0 }),
    );
  });

  it('getAlertSinkStatus reporta sentry + slack ativos', () => {
    initAlertSinks();
    const status = getAlertSinkStatus();
    expect(status.sentry).toBe(true);
    expect(status.slack).toBe(true);
  });

  it('notifyCriticalAlert · dispatcha Sentry captureMessage + Slack webhook', async () => {
    initAlertSinks();
    await notifyCriticalAlert(
      {
        event_name: 'queue:dlq-enqueued',
        severity: 'critical',
        action_required: 'manual-dlq-triage',
        tenant_id: '11111111-1111-1111-1111-111111111111',
        trace_id: 'trace-abc',
      },
      'DLQ enqueue event',
    );

    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      'DLQ enqueue event',
      expect.objectContaining({
        level: 'fatal',
        tags: expect.objectContaining({
          event_name: 'queue:dlq-enqueued',
          severity: 'critical',
          tenant_id: '11111111-1111-1111-1111-111111111111',
        }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hooks.slack.com/services/MOCK');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].color).toBe('danger');
    expect(body.attachments[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Event', value: 'queue:dlq-enqueued' }),
        expect.objectContaining({ title: 'Severity', value: 'CRITICAL' }),
      ]),
    );
  });

  it('Slack falha · nao propaga erro · loga warning silencioso', async () => {
    initAlertSinks();
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await expect(
      notifyCriticalAlert({ event_name: 'queue:dlq-enqueued', severity: 'critical' }, 'msg'),
    ).resolves.toBeUndefined();
  });

  it('severity high · usa Sentry level "error" e Slack color "warning"', async () => {
    initAlertSinks();
    await notifyCriticalAlert(
      { event_name: 'lgpd:tenant-churning', severity: 'high' },
      'High severity event',
    );

    expect(sentryCaptureMessage).toHaveBeenCalledWith(
      'High severity event',
      expect.objectContaining({ level: 'error' }),
    );

    const slackCall = fetchMock.mock.calls[0]!;
    const body = JSON.parse(slackCall[1].body);
    expect(body.attachments[0].color).toBe('warning');
  });
});
