import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { createEvolutionClient } from '../integrations/evolution.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { BaseJobPayload } from '@prospix/shared-types';

export interface HealthCheckPayload extends BaseJobPayload {
  check_type?: string;
}

export interface HealthCheckResult {
  success: boolean;
  state: 'open' | 'connecting' | 'close';
  switchedProvider: boolean;
  avgOpenAiLatencyMs?: number;
}

export class HealthCheckWorker extends BaseWorker<HealthCheckPayload, HealthCheckResult> {
  name = 'health-check';
  concurrency = 5;

  async process(job: Job<HealthCheckPayload>): Promise<HealthCheckResult> {
    const { tenant_id } = job.data;

    // 1. Fetch tenant secret configuration
    const decryptedSecrets = await getDecryptedSecrets(tenant_id);
    const { data: secretRecord } = await dbAdmin
      .from('tenant_secrets')
      .select('*')
      .eq('tenant_id', tenant_id)
      .single();

    if (!decryptedSecrets?.evolutionApiKey || !secretRecord?.evolution_instance_name || !secretRecord?.evolution_base_url) {
      logger.warn({ tenant_id }, '⚠️ Evolution API not configured for active tenant. Skipping health check.');
      return { success: false, state: 'close', switchedProvider: false };
    }

    // 2. Fetch WhatsApp Connection State
    const client = createEvolutionClient();
    const stateResult = await client.getConnectionState({
      instance: secretRecord.evolution_instance_name,
      apiKey: decryptedSecrets.evolutionApiKey,
      baseUrl: secretRecord.evolution_base_url,
    });

    let connectionState: 'open' | 'connecting' | 'close' = 'close';
    if (stateResult.ok) {
      connectionState = stateResult.value.state;
    }

    const stateCacheKey = `whatsapp:state:${tenant_id}`;
    const offlineTimestampKey = `whatsapp:offline-start:${tenant_id}`;

    await redis.set(stateCacheKey, connectionState);

    if (connectionState !== 'open') {
      // Instance is offline
      const offlineStart = await redis.get(offlineTimestampKey);
      if (!offlineStart) {
        // Start offline timer
        await redis.set(offlineTimestampKey, Date.now().toString());
      } else {
        const offlineDurationMs = Date.now() - parseInt(offlineStart, 10);
        const offlineDurationMins = offlineDurationMs / (60 * 1000);

        if (offlineDurationMins >= 10) {
          logger.error(
            { tenant_id, duration_minutes: Math.round(offlineDurationMins) },
            `🚨 CRITICAL ALERT: Tenant WhatsApp instance has been offline for ${Math.round(offlineDurationMins)} minutes!`
          );
          // Here, you would trigger SMS, Email or Sentry alert escalation
        }
      }
    } else {
      // Instance is online, clear offline timer
      await redis.del(offlineTimestampKey);
    }

    // 3. Monitor OpenAI Latency in last 5 minutes (Auto-healing)
    // Supabase doesn't have aggregate, so we fetch recent messages and compute avg manually
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const { data: recentMessages } = await dbAdmin
      .from('messages')
      .select('llm_latency_ms')
      .eq('tenant_id', tenant_id)
      .gte('created_at', fiveMinsAgo.toISOString())
      .ilike('llm_model', 'gpt-%')
      .not('llm_latency_ms', 'is', null);

    let avgOpenAiLatencyMs = 0;
    if (recentMessages && recentMessages.length > 0) {
      const totalLatency = recentMessages.reduce((sum: number, m: any) => sum + (m.llm_latency_ms || 0), 0);
      avgOpenAiLatencyMs = totalLatency / recentMessages.length;
    }

    let switchedProvider = false;

    if (avgOpenAiLatencyMs > 10000) { // 10 seconds average latency threshold
      logger.warn(
        { tenant_id, avgOpenAiLatencyMs },
        '⚠️ OpenAI average latency exceeded 10s. Initiating auto-healing switch to Anthropic!'
      );

      // Force system provider update to anthropic
      const { error: updateErr } = await dbAdmin
        .from('tenant_ai_configs')
        .update({
          system_provider: 'anthropic',
        })
        .eq('tenant_id', tenant_id);

      if (updateErr) throw updateErr;

      // Clear cached AI config so AIRouter reads the updated one instantly
      const cacheKey = `tenant-ai-config:${tenant_id}`;
      await redis.del(cacheKey);
      
      switchedProvider = true;
    }

    return {
      success: stateResult.ok,
      state: connectionState,
      switchedProvider,
      avgOpenAiLatencyMs: avgOpenAiLatencyMs > 0 ? avgOpenAiLatencyMs : undefined,
    };
  }
}
