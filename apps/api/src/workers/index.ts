import { redisConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createTenantQueue } from '../lib/queue.js';
import { Worker } from 'bullmq';
import { ProcessInboundWorker } from './process-inbound.js';
import { SendMessagesWorker } from './send-messages.js';
import { ScheduleMeetingWorker } from './schedule-meeting.js';
import { HealthCheckWorker } from './health-check.js';

let activeWorkers: Worker[] = [];
let healthCheckInterval: NodeJS.Timeout | null = null;

export async function startWorkers() {
  logger.info('🚀 Prospix Background Workers bootstrap initiated...');

  try {
    // 1. Fetch active tenants to spawn dynamic queues
    const tenants = await prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    logger.info({ count: tenants.length }, `🏢 Found active tenants. Initializing tenant-specific workers...`);

    // Instantiate Concrete Domain Worker Handlers
    const processInboundHandler = new ProcessInboundWorker();
    const sendMessagesHandler = new SendMessagesWorker();
    const scheduleMeetingHandler = new ScheduleMeetingWorker();
    const healthCheckHandler = new HealthCheckWorker();

    for (const tenant of tenants) {
      const tenantId = tenant.id;

      // A. Process Inbound Worker
      const inboundQueueName = `queue:tenant_${tenantId}:process-inbound`;
      const inboundWorker = new Worker(
        inboundQueueName,
        async (job) => {
          return await processInboundHandler.run(job);
        },
        {
          connection: redisConnection,
          concurrency: processInboundHandler.concurrency,
        }
      );
      activeWorkers.push(inboundWorker);

      // B. Send Messages Worker
      const sendQueueName = `queue:tenant_${tenantId}:send-messages`;
      const sendWorker = new Worker(
        sendQueueName,
        async (job) => {
          return await sendMessagesHandler.run(job);
        },
        {
          connection: redisConnection,
          concurrency: sendMessagesHandler.concurrency, // enforce strict sequential per-tenant
        }
      );
      activeWorkers.push(sendWorker);

      // C. Schedule Meeting Worker
      const meetingQueueName = `queue:tenant_${tenantId}:schedule-meeting`;
      const meetingWorker = new Worker(
        meetingQueueName,
        async (job) => {
          return await scheduleMeetingHandler.run(job);
        },
        {
          connection: redisConnection,
          concurrency: scheduleMeetingHandler.concurrency,
        }
      );
      activeWorkers.push(meetingWorker);

      // D. Health Check Worker (consumes jobs)
      const hcQueueName = `queue:tenant_${tenantId}:health-check`;
      const hcWorker = new Worker(
        hcQueueName,
        async (job) => {
          return await healthCheckHandler.run(job);
        },
        {
          connection: redisConnection,
          concurrency: healthCheckHandler.concurrency,
        }
      );
      activeWorkers.push(hcWorker);

      // Trigger initial health check immediately on startup
      const hcQueue = createTenantQueue(tenantId, 'health-check');
      await hcQueue.add('initial-check', { tenant_id: tenantId });
    }

    // 2. Setup periodic health check scheduler (Every 5 minutes)
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
    logger.info({ spawned: activeWorkers.length }, '✅ All dynamic tenant workers listening and ready');
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
