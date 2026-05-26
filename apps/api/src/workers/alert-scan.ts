/**
 * Worker que dispara o alert-scanner cross-tenant.
 *
 * Rodando via scheduler cron diário às 08:00 BRT (após daily-digest 08:00).
 * Scope: global (não por tenant).
 */
import type { Job } from 'bullmq';
import { logger } from '../lib/logger.js';
import { runAlertScan } from '../lib/alert-scanner.js';

export class AlertScanWorker {
  public concurrency = 1;

  async run(job: Job): Promise<{ scanned: number; created: number; updated: number; errors: number }> {
    const startedAt = Date.now();
    try {
      const result = await runAlertScan({ autoResolve: true });
      logger.info(
        { jobId: job.id, ...result, durationMs: Date.now() - startedAt },
        'alert-scan · cycle complete',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, err }, 'alert-scan · cycle failed');
      throw err;
    }
  }
}
