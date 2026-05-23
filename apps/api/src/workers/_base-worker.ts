import { Job } from 'bullmq';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { tenantContextStorage } from '../lib/tenant-context-storage.js';

export abstract class BaseWorker<TPayload extends BaseJobPayload, TResult> {
  abstract name: string;
  abstract concurrency: number;
  
  /**
   * Abstract process function to be implemented by subclass.
   */
  abstract process(job: Job<TPayload>): Promise<TResult>;

  /**
   * Main entry point for job execution.
   * Auto-injects tenant_id RLS context before run and logs trace.
   */
  async run(job: Job<TPayload>): Promise<TResult> {
    const tenantId = job.data?.tenant_id;
    if (!tenantId) {
      const errorMsg = 'Missing tenant_id in job payload';
      logger.error({ worker: this.name, job_id: job.id }, errorMsg);
      throw new Error(errorMsg);
    }

    const start = Date.now();
    logger.info(
      {
        worker: this.name,
        tenant_id: tenantId,
        job_id: job.id,
        trace_id: job.data.trace_id,
      },
      'job:start'
    );

    try {
      // 1. Wrap process execution inside the tenantContextStorage context.
      // The Prisma Client query extension detects this tenantId for tenant-scoped queries.
      const result = await tenantContextStorage.run({ tenantId, bypassRls: false }, async () => {
        return await this.process(job);
      });
      
      const durationMs = Date.now() - start;
      logger.info(
        {
          worker: this.name,
          tenant_id: tenantId,
          job_id: job.id,
          duration_ms: durationMs,
        },
        'job:done'
      );
      
      return result;
    } catch (err) {
      logger.error(
        {
          worker: this.name,
          tenant_id: tenantId,
          job_id: job.id,
          err,
        },
        'job:fail'
      );
      throw err;
    }
  }
}
