import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
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
    const secretRecord = await prisma.tenantSecret.findUnique({
      where: { tenantId: tenant_id },
    });

    if (!decryptedSecrets?.evolutionApiKey || !secretRecord?.evolutionInstanceName || !secretRecord?.evolutionBaseUrl) {
      logger.warn({ tenant_id }, '⚠️ Evolution API not configured for active tenant. Skipping health check.');
      return { success: false, state: 'close', switchedProvider: false };
    }

    // 2. Fetch WhatsApp Connection State
    const client = createEvolutionClient();
    const stateResult = await client.getConnectionState({
      instance: secretRecord.evolutionInstanceName,
      apiKey: decryptedSecrets.evolutionApiKey,
      baseUrl: secretRecord.evolutionBaseUrl,
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
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const avgLatencyResult = await prisma.message.aggregate({
      where: {
        tenantId: tenant_id,
        createdAt: { gte: fiveMinsAgo },
        llmModel: { startsWith: 'gpt-' }, // OpenAI models
        llmLatencyMs: { not: null },
      },
      _avg: {
        llmLatencyMs: true,
      },
    });

    const avgOpenAiLatencyMs = avgLatencyResult._avg.llmLatencyMs || 0;
    let switchedProvider = false;

    if (avgOpenAiLatencyMs > 10000) { // 10 seconds average latency threshold
      logger.warn(
        { tenant_id, avgOpenAiLatencyMs },
        '⚠️ OpenAI average latency exceeded 10s. Initiating auto-healing switch to Anthropic!'
      );

      // Force system provider update to anthropic
      await prisma.tenantAIConfig.update({
        where: { tenantId: tenant_id },
        data: {
          systemProvider: 'anthropic',
        },
      });

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
