import { Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';

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
      // 1. Inject context in DB transaction client
      await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      
      // 2. Delegate to actual processing logic
      const result = await this.process(job);
      
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
    } finally {
      // Reset tenant_id just in case
      try {
        await prisma.$executeRaw`SELECT set_config('app.tenant_id', '', true)`;
      } catch (_) {
        // Ignore reset failures
      }
    }
  }
}
