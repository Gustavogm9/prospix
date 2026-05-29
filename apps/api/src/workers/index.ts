import { createDedicatedRedisConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createTenantQueue, getTenantQueueName, observeQueueFailures, upsertTenantJobScheduler, syncCampaignCaptureSchedule } from '../lib/queue.js';
import type { QueueFailureObserver, TenantJobSchedule } from '../lib/queue.js';
import { Worker } from 'bullmq';
import { ProcessInboundWorker } from './process-inbound.js';
import { SendMessagesWorker } from './send-messages.js';
import { ScheduleMeetingWorker } from './schedule-meeting.js';
import { HealthCheckWorker } from './health-check.js';
import { BillingSuspensionWorker } from './billing-suspension.js';
import { CaptureGoogleMapsWorker } from './capture-google-maps.js';
import { EnrichLeadsWorker } from './enrich-leads.js';
import { DailyDigestWorker } from './daily-digest.js';
import { UsageAggregationWorker } from './usage-aggregation.js';
import { SendNotificationWorker } from './send-notification.js';
import { ProcessLgpdRequestWorker } from './process-lgpd-request.js';
import { AlertScanWorker } from './alert-scan.js';

let activeWorkers: Worker[] = [];
let activeQueueObservers: QueueFailureObserver[] = [];
let healthCheckInterval: NodeJS.Timeout | null = null;

export const workerQueueNames = [
  'process-inbound',
  'send-messages',
  'send-notification',
  'schedule-meeting',
  'health-check',
  'billing-suspension',
  'capture-google-maps',
  'enrich-leads',
  'daily-digest',
  'usage-aggregation',
  'process-lgpd-request',
  'alert-scan',
];

const SCHEDULER_TIMEZONE = 'America/Sao_Paulo';

type SchedulerPayload = {
  tenant_id: string;
  trace_id: string;
  run_all_tenants?: boolean;
};

export function buildTenantScheduledJobs(tenantId: string): TenantJobSchedule<SchedulerPayload>[] {
  return [
    {
      workerName: 'daily-digest',
      schedulerId: `daily-digest:${tenantId}`,
      jobName: 'daily-digest',
      pattern: '0 8 * * *',
      timezone: SCHEDULER_TIMEZONE,
      data: {
        tenant_id: tenantId,
        trace_id: `scheduler:daily-digest:${tenantId}`,
      },
    },
    {
      workerName: 'usage-aggregation',
      schedulerId: `usage-aggregation:${tenantId}`,
      jobName: 'usage-aggregation',
      pattern: '0 * * * *',
      timezone: SCHEDULER_TIMEZONE,
      data: {
        tenant_id: tenantId,
        trace_id: `scheduler:usage-aggregation:${tenantId}`,
        run_all_tenants: false,
      },
    },
  ];
}

export async function scheduleRecurringTenantJobs(tenants: Array<{ id: string }>): Promise<void> {
  for (const tenant of tenants) {
    const schedules = buildTenantScheduledJobs(tenant.id);

    for (const schedule of schedules) {
      await upsertTenantJobScheduler(tenant.id, schedule);
    }
  }
}

export async function startWorkers() {
  logger.info('🚀 Prospix Background Workers bootstrap initiated...');

  try {
    // Instantiate Concrete Domain Worker Handlers
    const processInboundHandler = new ProcessInboundWorker();
    const sendMessagesHandler = new SendMessagesWorker();
    const sendNotificationHandler = new SendNotificationWorker();
    const scheduleMeetingHandler = new ScheduleMeetingWorker();
    const healthCheckHandler = new HealthCheckWorker();
    const billingSuspensionHandler = new BillingSuspensionWorker();
    const captureGoogleMapsHandler = new CaptureGoogleMapsWorker();
    const enrichLeadsHandler = new EnrichLeadsWorker();
    const dailyDigestHandler = new DailyDigestWorker();
    const usageAggregationHandler = new UsageAggregationWorker();
    const lgpdRequestHandler = new ProcessLgpdRequestWorker();
    const alertScanHandler = new AlertScanWorker();

    activeQueueObservers = workerQueueNames.map((workerName) => observeQueueFailures(workerName));

    // 1. Initialize static, global Workers with dedicated connection sockets
    // This allows radical scalability by using one global worker per queue instead of N tenant workers.

    // A. Process Inbound Worker
    const inboundWorker = new Worker(
      getTenantQueueName('global', 'process-inbound'),
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
      getTenantQueueName('global', 'send-messages'),
      async (job) => {
        return await sendMessagesHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: sendMessagesHandler.concurrency, // enforce strict sequential per-tenant WhatsApp rules
      }
    );
    activeWorkers.push(sendWorker);

    // C. Send Notification Worker
    const notificationWorker = new Worker(
      getTenantQueueName('global', 'send-notification'),
      async (job) => {
        return await sendNotificationHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: sendNotificationHandler.concurrency,
      }
    );
    activeWorkers.push(notificationWorker);

    // D. Schedule Meeting Worker
    const meetingWorker = new Worker(
      getTenantQueueName('global', 'schedule-meeting'),
      async (job) => {
        return await scheduleMeetingHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: scheduleMeetingHandler.concurrency,
      }
    );
    activeWorkers.push(meetingWorker);

    // E. Health Check Worker
    const hcWorker = new Worker(
      getTenantQueueName('global', 'health-check'),
      async (job) => {
        return await healthCheckHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: healthCheckHandler.concurrency,
      }
    );
    activeWorkers.push(hcWorker);

    // F. Billing Suspension Worker (Asaas auto-suspension scheduler)
    const billingWorker = new Worker(
      getTenantQueueName('global', 'billing-suspension'),
      async (job) => {
        return await billingSuspensionHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: billingSuspensionHandler.concurrency,
      }
    );
    activeWorkers.push(billingWorker);

    // G. Capture Google Maps Worker
    const captureWorker = new Worker(
      getTenantQueueName('global', 'capture-google-maps'),
      async (job) => {
        return await captureGoogleMapsHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: captureGoogleMapsHandler.concurrency,
      }
    );
    activeWorkers.push(captureWorker);

    // H. Enrich Leads Worker
    const enrichWorker = new Worker(
      getTenantQueueName('global', 'enrich-leads'),
      async (job) => {
        return await enrichLeadsHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: enrichLeadsHandler.concurrency,
      }
    );
    activeWorkers.push(enrichWorker);

    // I. Daily Digest Worker
    const digestWorker = new Worker(
      getTenantQueueName('global', 'daily-digest'),
      async (job) => {
        return await dailyDigestHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: dailyDigestHandler.concurrency,
      }
    );
    activeWorkers.push(digestWorker);

    // J. Usage Aggregation Worker
    const usageWorker = new Worker(
      getTenantQueueName('global', 'usage-aggregation'),
      async (job) => {
        return await usageAggregationHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: usageAggregationHandler.concurrency,
      }
    );
    activeWorkers.push(usageWorker);

    // K. Process LGPD Request Worker (AUD-P2-033)
    const lgpdWorker = new Worker(
      getTenantQueueName('global', 'process-lgpd-request'),
      async (job) => {
        return await lgpdRequestHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: lgpdRequestHandler.concurrency,
      }
    );
    activeWorkers.push(lgpdWorker);

    // L. Alert Scan Worker (admin ops · daily cross-tenant scan)
    const alertScanWorker = new Worker(
      getTenantQueueName('global', 'alert-scan'),
      async (job) => {
        return await alertScanHandler.run(job);
      },
      {
        connection: createDedicatedRedisConnection(),
        concurrency: alertScanHandler.concurrency,
      }
    );
    activeWorkers.push(alertScanWorker);

    // 2. Fetch active tenants to trigger initial health checks
    const tenants = await prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    logger.info({ count: tenants.length }, `🏢 Enqueuing initial health checks for active tenants...`);
    await scheduleRecurringTenantJobs(tenants);

    // Schedule capture crons for all existing active campaigns with cities
    const activeCampaigns = await prisma.campaign.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, tenantId: true, cities: true },
    });

    const campaignsWithCities = activeCampaigns.filter(c => c.cities && c.cities.length > 0);
    logger.info({ count: campaignsWithCities.length }, '🗺️ Scheduling capture crons for active campaigns...');
    for (const campaign of campaignsWithCities) {
      await syncCampaignCaptureSchedule(campaign.tenantId, campaign.id, 'ACTIVE', campaign.cities);
    }

    // Global scheduler · alert-scan diário 08:15 BRT (após daily-digest 08:00 settle)
    await upsertTenantJobScheduler('global', {
      workerName: 'alert-scan',
      schedulerId: 'alert-scan:global',
      jobName: 'alert-scan',
      pattern: '15 8 * * *',
      timezone: SCHEDULER_TIMEZONE,
      data: { trace_id: 'scheduler:alert-scan:global', run_all_tenants: true } as never,
    });
    logger.info({ pattern: '15 8 * * *', tz: SCHEDULER_TIMEZONE }, '🚨 Alert scanner scheduled daily');

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
  const closingWorkers = activeWorkers.map((w) => w.close());
  const closingObservers = activeQueueObservers.map((observer) => observer.close());
  await Promise.all([...closingWorkers, ...closingObservers]);
  activeWorkers = [];
  activeQueueObservers = [];
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
