import { createDedicatedRedisConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createTenantQueue } from '../lib/queue.js';
import { Worker } from 'bullmq';
import { ProcessInboundWorker } from './process-inbound.js';
import { SendMessagesWorker } from './send-messages.js';
import { ScheduleMeetingWorker } from './schedule-meeting.js';
import { HealthCheckWorker } from './health-check.js';
import { BillingSuspensionWorker } from './billing-suspension.js';

let activeWorkers: Worker[] = [];
let healthCheckInterval: NodeJS.Timeout | null = null;

export async function startWorkers() {
  logger.info('🚀 Prospix Background Workers bootstrap initiated...');

  try {
    // Instantiate Concrete Domain Worker Handlers
    const processInboundHandler = new ProcessInboundWorker();
    const sendMessagesHandler = new SendMessagesWorker();
    const scheduleMeetingHandler = new ScheduleMeetingWorker();
    const healthCheckHandler = new HealthCheckWorker();
    const billingSuspensionHandler = new BillingSuspensionWorker();

    // 1. Initialize static, global Workers with dedicated connection sockets
    // This allows radical scalability by using exactly 5 workers instead of N * 4 workers.

    // A. Process Inbound Worker
    const inboundWorker = new Worker(
      'queue:global:process-inbound',
      async (job) => {
        return await processInboundHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: processInboundHandler.concurrency,
      }
    );
    activeWorkers.push(inboundWorker);

    // B. Send Messages Worker
    const sendWorker = new Worker(
      'queue:global:send-messages',
      async (job) => {
        return await sendMessagesHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: sendMessagesHandler.concurrency, // enforce strict sequential per-tenant WhatsApp rules
      }
    );
    activeWorkers.push(sendWorker);

    // C. Schedule Meeting Worker
    const meetingWorker = new Worker(
      'queue:global:schedule-meeting',
      async (job) => {
        return await scheduleMeetingHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: scheduleMeetingHandler.concurrency,
      }
    );
    activeWorkers.push(meetingWorker);

    // D. Health Check Worker
    const hcWorker = new Worker(
      'queue:global:health-check',
      async (job) => {
        return await healthCheckHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: healthCheckHandler.concurrency,
      }
    );
    activeWorkers.push(hcWorker);

    // E. Billing Suspension Worker (Asaas auto-suspension scheduler)
    const billingWorker = new Worker(
      'queue:global:billing-suspension',
      async (job) => {
        return await billingSuspensionHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: billingSuspensionHandler.concurrency,
      }
    );
    activeWorkers.push(billingWorker);

    // 2. Fetch active tenants to trigger initial health checks
    const tenants = await prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    logger.info({ count: tenants.length }, `🏢 Enqueuing initial health checks for active tenants...`);
    for (const tenant of tenants) {
      const hcQueue = createTenantQueue(tenant.id, 'health-check');
      await hcQueue.add('initial-check', { tenant_id: tenant.id });
    }

    // 3. Setup periodic health check scheduler (Every 5 minutes)
    healthCheckInterval = setInterval(async () => {
      try {
        const activeTenants = await prisma.tenant.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
        });

        logger.info({ count: activeTenants.length }, '🕒 Dispatching recurrent health check jobs for tenants...');
        for (const tenant of activeTenants) {
          const hcQueue = createTenantQueue(tenant.id, 'health-check');
          await hcQueue.add('recurrent-check', { tenant_id: tenant.id });
        }
      } catch (err: any) {
        logger.error({ err: err.message }, '💥 Error during recurrent health check dispatch');
      }
    }, 5 * 60 * 1000);

    // Register success log
    logger.info({ spawned: activeWorkers.length }, '✅ All static global workers listening and ready');
  } catch (err: any) {
    logger.error({ err: err.message }, '💥 Failed to bootstrap background workers');
    throw err;
  }

  // Graceful shutdown listeners
  process.on('SIGTERM', async () => {
    logger.info('🛑 SIGTERM received. Closing background workers...');
    await shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('🛑 SIGINT received. Closing background workers...');
    await shutdown();
    process.exit(0);
  });
}

async function shutdown() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  logger.info('🔌 Closing all BullMQ workers...');
  const closing = activeWorkers.map((w) => w.close());
  await Promise.all(closing);
  logger.info('✅ All workers stopped gracefully');
}

// Self-execute if run directly
const isMainModule = (process.argv[1] && import.meta.url.endsWith(process.argv[1])) || process.argv[1]?.endsWith('workers/index.ts') || process.argv[1]?.endsWith('workers/index.js');
if (isMainModule) {
  startWorkers().catch((err) => {
    logger.error({ err }, '💥 Worker crash on startup');
    process.exit(1);
  });
}

