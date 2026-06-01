import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { redis } from '../lib/redis.js';
import { UserRole } from '@prospix/shared-types';
import { sendNotification } from '../services/notification-service.js';
import { getAIPlanLimitCents } from '../ai/quota.js';

export interface UsageAggregationPayload extends BaseJobPayload {
  // Kept for producer compatibility; scheduled jobs run tenant-scoped.
  run_all_tenants?: boolean;
}

export interface UsageAggregationResult {
  success: boolean;
  tenants_processed: number;
}

export class UsageAggregationWorker extends BaseWorker<UsageAggregationPayload, UsageAggregationResult> {
  name = 'usage-aggregation';
  concurrency = 1;

  async process(job: Job<UsageAggregationPayload>): Promise<UsageAggregationResult> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Scheduled jobs are tenant-scoped
    const { data: tenants, error: tenantErr } = await dbAdmin
      .from('tenants')
      .select('*')
      .eq('id', job.data.tenant_id)
      .eq('status', 'ACTIVE')
      .is('deleted_at', null);

    if (tenantErr) throw tenantErr;

    logger.info({ count: tenants?.length }, 'Aggregating usage for active tenants');

    for (const tenant of tenants || []) {
      try {
        // 1. Aggregate Messages costs for the current month
        // Supabase doesn't have aggregate, so we fetch and sum manually
        const { data: messages } = await dbAdmin
          .from('messages')
          .select('llm_tokens_input, llm_tokens_output, llm_cost_cents')
          .eq('tenant_id', tenant.id)
          .gte('created_at', startOfMonth.toISOString());

        let inputTokens = 0;
        let outputTokens = 0;
        let costCents = 0;

        if (messages) {
          for (const msg of messages) {
            inputTokens += Number(msg.llm_tokens_input || 0);
            outputTokens += Number(msg.llm_tokens_output || 0);
            costCents += Number(msg.llm_cost_cents || 0);
          }
        }

        // Count operational metrics
        const { count: leadsCaptured } = await dbAdmin
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('created_at', startOfMonth.toISOString());

        const { count: conversations } = await dbAdmin
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('started_at', startOfMonth.toISOString());

        const { count: meetings } = await dbAdmin
          .from('meetings')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('created_at', startOfMonth.toISOString());

        // 2. Upsert TenantUsage
        const { data: existingUsage } = await dbAdmin
          .from('tenant_usage')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('period_month', startOfMonth.toISOString())
          .single();

        const usageData = {
          llm_tokens_input: inputTokens,
          llm_tokens_output: outputTokens,
          llm_cost_cents: costCents,
          leads_captured_count: leadsCaptured || 0,
          conversations_started: conversations || 0,
          meetings_scheduled: meetings || 0,
        };

        if (existingUsage) {
          await dbAdmin
            .from('tenant_usage')
            .update(usageData)
            .eq('tenant_id', tenant.id)
            .eq('period_month', startOfMonth.toISOString());
        } else {
          await dbAdmin
            .from('tenant_usage')
            .insert({
              tenant_id: tenant.id,
              period_month: startOfMonth.toISOString(),
              ...usageData,
            } as any);
        }

        // 3. Threshold check & notification triggering
        const limitCents = getAIPlanLimitCents(tenant.plan);
        const percentUsed = (costCents / limitCents) * 100;
        const currentMonthKey = `${startOfMonth.getFullYear()}-${startOfMonth.getMonth() + 1}`;

        const checkAndAlert = async (threshold: number, alertName: string, title: string, body: string) => {
          if (percentUsed >= threshold) {
            const redisKey = `quota_alert:${tenant.id}:${currentMonthKey}:${threshold}`;
            const alreadySent = await redis.get(redisKey);

            if (!alreadySent) {
              // Find tenant owner to send the notification
              const { data: owner } = await dbAdmin
                .from('users')
                .select('id')
                .eq('tenant_id', tenant.id)
                .eq('role', UserRole.OWNER)
                .is('deleted_at', null)
                .limit(1)
                .single();

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
      tenants_processed: tenants?.length || 0,
    };
  }
}
