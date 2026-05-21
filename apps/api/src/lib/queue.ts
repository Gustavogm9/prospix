import { Queue, QueueOptions } from 'bullmq';
import { redisConnection } from './redis.js';

/**
 * Generates a global static queue name for a worker.
 * Format: queue:global:<worker_name>
 */
export function getTenantQueueName(_tenantId: string, workerName: string): string {
  return `queue:global:${workerName}`;
}

/**
 * Factory to create a global, static BullMQ Queue (backward compatible signature).
 * Configured with exponential backoff retry and DLQ-ready policies.
 */
export function createTenantQueue<TPayload = any>(
  tenantId: string,
  workerName: string,
  options?: Omit<QueueOptions, 'connection'>
): Queue<TPayload> {
  const queueName = getTenantQueueName(tenantId, workerName);
  
  return new Queue<TPayload>(queueName, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000, // starts at 1s, then 2s, 4s...
      },
      removeOnComplete: true,
      removeOnFail: false, // keep failed jobs for DLQ inspection
      ...options?.defaultJobOptions,
    },
    ...options,
  });
}

