import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { redis } from '../lib/redis.js';
import { UserRole } from '@prisma/client';
import { sendNotification } from '../services/notification-service.js';

export interface UsageAggregationPayload extends BaseJobPayload {
  // Opcional se for rodar para um tenant específico, senão roda para todos
  run_all_tenants?: boolean;
}

export interface UsageAggregationResult {
  success: boolean;
  tenants_processed: number;
}

export class UsageAggregationWorker extends BaseWorker<UsageAggregationPayload, UsageAggregationResult> {
  name = 'usage-aggregation';
  concurrency = 1;

  async process(_job: Job<UsageAggregationPayload>): Promise<UsageAggregationResult> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // If a specific tenant is specified, we might bypass and run only for that, 
    // but the cron aggregates for everyone.
    const tenants = await prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
      },
    });

    logger.info({ count: tenants.length }, 'Aggregating usage for active tenants');

    for (const tenant of tenants) {
      try {
        // 1. Aggregate Messages costs for the current month
        const msgAggregation = await prisma.message.aggregate({
          where: {
            tenantId: tenant.id,
            createdAt: { gte: startOfMonth },
          },
          _sum: {
            llmTokensInput: true,
            llmTokensOutput: true,
            llmCostCents: true,
          },
        });

        const inputTokens = msgAggregation._sum.llmTokensInput || BigInt(0);
        const outputTokens = msgAggregation._sum.llmTokensOutput || BigInt(0);
        const costCents = msgAggregation._sum.llmCostCents || 0;

        // Count operational metrics
        const leadsCaptured = await prisma.lead.count({
          where: { tenantId: tenant.id, createdAt: { gte: startOfMonth } },
        });

        const conversations = await prisma.conversation.count({
          where: { tenantId: tenant.id, startedAt: { gte: startOfMonth } },
        });

        const meetings = await prisma.meeting.count({
          where: { tenantId: tenant.id, createdAt: { gte: startOfMonth } },
        });

        // 2. Upsert TenantUsage
        await prisma.tenantUsage.upsert({
          where: {
            tenantId_periodMonth: {
              tenantId: tenant.id,
              periodMonth: startOfMonth,
            },
          },
          create: {
            tenantId: tenant.id,
            periodMonth: startOfMonth,
            llmTokensInput: inputTokens,
            llmTokensOutput: outputTokens,
            llmCostCents: costCents,
            leadsCapturedCount: leadsCaptured,
            conversationsStarted: conversations,
            meetingsScheduled: meetings,
          },
          update: {
            llmTokensInput: inputTokens,
            llmTokensOutput: outputTokens,
            llmCostCents: costCents,
            leadsCapturedCount: leadsCaptured,
            conversationsStarted: conversations,
            meetingsScheduled: meetings,
          },
        });

        // 3. Threshold check & notification triggering
        let limitCents = 15000; // STANDARD ($150)
        if (tenant.plan === 'STARTER') limitCents = 5000; // STARTER ($50)
        if (tenant.plan === 'PREMIUM') limitCents = 50000; // PREMIUM ($500)

        const percentUsed = (costCents / limitCents) * 100;
        const currentMonthKey = `${startOfMonth.getFullYear()}-${startOfMonth.getMonth() + 1}`;

        const checkAndAlert = async (threshold: number, alertName: string, title: string, body: string) => {
          if (percentUsed >= threshold) {
            const redisKey = `quota_alert:${tenant.id}:${currentMonthKey}:${threshold}`;
            const alreadySent = await redis.get(redisKey);

            if (!alreadySent) {
              // Find tenant owner to send the notification
              const owner = await prisma.user.findFirst({
                where: { tenantId: tenant.id, role: UserRole.OWNER, deletedAt: null },
              });

              if (owner) {
                await sendNotification({
                  tenantId: tenant.id,
                  userId: owner.id,
                  type: `ai_quota_${alertName}`,
                  title,
                  body,
                  data: {
                    percent_used: percentUsed.toFixed(1),
                    current_cost_cents: costCents,
                    limit_cents: limitCents,
                  },
                });

                // Set key to prevent duplicate alert this month
                await redis.set(redisKey, 'sent', 'EX', 30 * 24 * 60 * 60); // 30 days
                logger.info({ tenant_id: tenant.id, threshold }, `Quota alert ${threshold}% sent successfully`);
              }
            }
          }
        };

        await checkAndAlert(
          100,
          '100',
          '🚨 Limite de Franquia de IA atingido!',
          'Seu tenant atingiu 100% da franquia de IA deste mês. Compre créditos adicionais para evitar pausas no atendimento automatizado.'
        );

        await checkAndAlert(
          90,
          '90',
          '⚠️ Atenção: Franquia de IA em 90%',
          'Você consumiu 90% da sua franquia mensal de tokens de IA. Considere fazer upgrade de plano em breve para evitar interrupções.'
        );

        await checkAndAlert(
          70,
          '70',
          '📊 Franquia de IA em 70%',
          'Você consumiu 70% da sua franquia de tokens de IA deste mês. O uso está normal, mas acompanhe seu consumo no dashboard.'
        );

      } catch (err) {
        logger.error({ tenant_id: tenant.id, err }, 'Failed to aggregate usage for tenant');
      }
    }

    return {
      success: true,
      tenants_processed: tenants.length,
    };
  }
}
