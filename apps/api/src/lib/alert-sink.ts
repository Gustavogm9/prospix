/**
 * Alert sink · roteia eventos `alert:true severity:critical` para Sentry + Slack.
 * Resolve a pendencia operacional do AUD-P1-021 + LGPD CHURNING.
 *
 * Config-time:
 *  - `SENTRY_DSN` ausente -> Sentry desativado (no-op)
 *  - `SLACK_ALERT_WEBHOOK_URL` ausente -> Slack desativado (no-op)
 *
 * Eventos elegiveis (qualquer log fields que contenham `alert: true`):
 *  - `queue:dlq-enqueued` (severity: critical, action: manual-dlq-triage)
 *  - `queue:dlq-replay-blocked-by-allowlist`
 *  - `lgpd-worker: DELETE_TENANT_DATA · tenant marked CHURNING (7d grace)`
 *
 * Estrategia: nao usa pino transport (complexo cross-platform).
 * Em vez disso, helper `notifyCriticalAlert(fields, msg)` e chamado
 * explicitamente nos pontos relevantes.
 */
import * as Sentry from '@sentry/node';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let sentryInitialized = false;
let slackEnabled = false;

export function initAlertSinks(): void {
  if (env.SENTRY_DSN && !sentryInitialized) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0, // no APM by default · only errors/messages
    });
    sentryInitialized = true;
    logger.info({ sentry_dsn_prefix: env.SENTRY_DSN.slice(0, 20) }, 'alert-sink: Sentry initialized');
  }

  if (env.SLACK_ALERT_WEBHOOK_URL) {
    slackEnabled = true;
    logger.info('alert-sink: Slack webhook configured');
  }

  if (!sentryInitialized && !slackEnabled) {
    const message = 'alert-sink: no SENTRY_DSN nor SLACK_ALERT_WEBHOOK_URL configured · critical alerts will only go to stdout logs';
    if (typeof logger.warn === 'function') {
      logger.warn(message);
    } else {
      logger.info(message);
    }
  }
}

export interface CriticalAlertFields {
  event_name: string;
  severity: 'critical' | 'high';
  action_required?: string;
  tenant_id?: string;
  trace_id?: string;
  runbook?: string;
  [key: string]: unknown;
}

/**
 * Dispara alerta para Sentry + Slack quando configurado.
 * Nao bloqueia o fluxo · falha de envio e logada mas nao propagada.
 */
export async function notifyCriticalAlert(fields: CriticalAlertFields, message: string): Promise<void> {
  const promises: Promise<unknown>[] = [];

  if (sentryInitialized) {
    promises.push(
      Promise.resolve().then(() => {
        Sentry.captureMessage(message, {
          level: fields.severity === 'critical' ? 'fatal' : 'error',
          tags: {
            event_name: fields.event_name,
            severity: fields.severity,
            tenant_id: fields.tenant_id ?? 'unknown',
            action_required: fields.action_required ?? 'none',
          },
          contexts: {
            alert: {
              ...fields,
            },
          },
        });
      }).catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? { message: err.message } : err },
          'alert-sink: Sentry capture failed',
        );
      }),
    );
  }

  if (slackEnabled && env.SLACK_ALERT_WEBHOOK_URL) {
    promises.push(
      fetch(env.SLACK_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSlackPayload(fields, message)),
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.text();
            logger.error({ status: response.status, body }, 'alert-sink: Slack webhook responded non-2xx');
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? { message: err.message } : err },
            'alert-sink: Slack webhook fetch failed',
          );
        }),
    );
  }

  // Aguarda em paralelo mas com timeout · alerta nao pode bloquear flow critico
  await Promise.race([
    Promise.all(promises),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

function buildSlackPayload(fields: CriticalAlertFields, message: string): Record<string, unknown> {
  const emoji = fields.severity === 'critical' ? '🚨' : '⚠️';
  const color = fields.severity === 'critical' ? 'danger' : 'warning';

  const fieldsList: { title: string; value: string; short: boolean }[] = [
    { title: 'Event', value: fields.event_name, short: true },
    { title: 'Severity', value: fields.severity.toUpperCase(), short: true },
  ];

  if (fields.tenant_id) fieldsList.push({ title: 'Tenant', value: fields.tenant_id, short: true });
  if (fields.trace_id) fieldsList.push({ title: 'Trace', value: fields.trace_id, short: true });
  if (fields.action_required) fieldsList.push({ title: 'Action', value: fields.action_required, short: false });
  if (fields.runbook) fieldsList.push({ title: 'Runbook', value: fields.runbook, short: false });

  return {
    attachments: [
      {
        color,
        title: `${emoji} Prospix · ${message}`,
        fields: fieldsList,
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

/**
 * Status helpers para tests e healthcheck.
 */
export function getAlertSinkStatus(): { sentry: boolean; slack: boolean } {
  return { sentry: sentryInitialized, slack: slackEnabled };
}
