import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { AIProvider } from '@prospix/shared-types';
import { z } from 'zod';
import { getDb, dbAdmin } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { encryptSecret, getDecryptedSecrets } from '../../tenant/secrets-vault.js';
import crypto from 'crypto';
import { createEvolutionClient } from '../../integrations/evolution.js';

const WHATSAPP_STATUS_UNAVAILABLE = 'CONNECTION_STATE_UNAVAILABLE';
const WHATSAPP_QR_UNAVAILABLE = 'QR_CODE_UNAVAILABLE';
const WHATSAPP_INTEGRATION_ERROR_MESSAGE = 'Failed to process WhatsApp integration request';

const ensureOwnerCanManageCredentials = (req: FastifyRequest, reply: FastifyReply) => {
  if (req.role !== 'OWNER' && req.role !== 'GUILDS_ADMIN') {
    reply.code(403).send({ error: 'Forbidden', message: 'Only tenant owners can manage integration credentials' });
    return false;
  }

  return true;
};

const credentialStateFromSecret = (secret: {
  ai_provider: string;
  evolution_base_url: string | null;
  evolution_instance_name: string | null;
  evolution_api_key_encrypted: string | null;
  evolution_webhook_secret: string | null;
  google_calendar_id: string | null;
  google_oauth_refresh_encrypted: string | null;
  google_oauth_scope: string | null;
  google_maps_api_key_encrypted: string | null;
  openai_api_key_encrypted: string | null;
  anthropic_api_key_encrypted: string | null;
  google_ai_api_key_encrypted: string | null;
  updated_at: string;
} | null) => ({
  aiProvider: secret?.ai_provider || AIProvider.GUILDS_SHARED,
  keys: {
    openai: { configured: Boolean(secret?.openai_api_key_encrypted) },
    anthropic: { configured: Boolean(secret?.anthropic_api_key_encrypted) },
    googleAi: { configured: Boolean(secret?.google_ai_api_key_encrypted) },
    googleMaps: { configured: Boolean(secret?.google_maps_api_key_encrypted) },
    evolution: { configured: Boolean(secret?.evolution_api_key_encrypted) },
  },
  whatsapp: {
    baseUrlConfigured: Boolean(secret?.evolution_base_url),
    instanceConfigured: Boolean(secret?.evolution_instance_name),
    webhookConfigured: Boolean(secret?.evolution_webhook_secret),
  },
  google: {
    calendarConnected: Boolean(secret?.google_oauth_refresh_encrypted),
    calendarId: secret?.google_calendar_id || null,
    oauthScope: secret?.google_oauth_scope || null,
  },
  updatedAt: secret?.updated_at || null,
});

const credentialsSchema = z.object({
  aiProvider: z.nativeEnum(AIProvider).optional(),
  openaiApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  anthropicApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  googleAiApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  googleMapsApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  evolutionApiKey: z.string().trim().min(1).max(500).nullable().optional(),
  evolutionBaseUrl: z.string().trim().url().max(500).nullable().optional(),
});

export const integrationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/tenant/integrations/credentials - Safe credential status for Settings
  app.get('/credentials', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }

    const db = getDb(req);
    const { data: secret } = await db
      .from('tenant_secrets')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle();

    return reply.send({ data: credentialStateFromSecret(secret) });
  });

  // PATCH /v1/tenant/integrations/credentials - Store tenant credentials encrypted
  app.patch('/credentials', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }

    if (!ensureOwnerCanManageCredentials(req, reply)) {
      return;
    }

    const parseRes = credentialsSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const encryptOrClear = async (value: string | null | undefined) => {
      if (value === undefined) return undefined;
      if (value === null || value.trim() === '') return null;
      return encryptSecret(value.trim());
    };

    const payload = parseRes.data;
    const updateData: Record<string, unknown> = {};
    const encryptedOpenAI = await encryptOrClear(payload.openaiApiKey);
    const encryptedAnthropic = await encryptOrClear(payload.anthropicApiKey);
    const encryptedGoogleAi = await encryptOrClear(payload.googleAiApiKey);
    const encryptedGoogleMaps = await encryptOrClear(payload.googleMapsApiKey);
    const encryptedEvolution = await encryptOrClear(payload.evolutionApiKey);

    if (payload.aiProvider !== undefined) updateData.ai_provider = payload.aiProvider;
    if (payload.evolutionBaseUrl !== undefined) updateData.evolution_base_url = payload.evolutionBaseUrl || null;
    if (encryptedOpenAI !== undefined) updateData.openai_api_key_encrypted = encryptedOpenAI;
    if (encryptedAnthropic !== undefined) updateData.anthropic_api_key_encrypted = encryptedAnthropic;
    if (encryptedGoogleAi !== undefined) updateData.google_ai_api_key_encrypted = encryptedGoogleAi;
    if (encryptedGoogleMaps !== undefined) updateData.google_maps_api_key_encrypted = encryptedGoogleMaps;
    if (encryptedEvolution !== undefined) updateData.evolution_api_key_encrypted = encryptedEvolution;

    const hasTenantOwnedKey = Boolean(
      updateData.openai_api_key_encrypted ||
      updateData.anthropic_api_key_encrypted ||
      updateData.google_ai_api_key_encrypted ||
      updateData.google_maps_api_key_encrypted ||
      updateData.evolution_api_key_encrypted
    );

    if (payload.aiProvider === undefined && hasTenantOwnedKey) {
      updateData.ai_provider = AIProvider.TENANT_OWN;
    }

    // Use dbAdmin for upsert on tenant_secrets (service-role needed for sensitive data)
    const { data: secret, error } = await dbAdmin
      .from('tenant_secrets')
      .upsert({
        tenant_id: req.tenantId,
        updated_at: new Date().toISOString(),
        ...updateData,
      }, { onConflict: 'tenant_id' })
      .select()
      .single();

    if (error) throw error;

    logger.info({ tenantId: req.tenantId, userId: req.userId }, 'Tenant credentials updated from Settings');
    return reply.send({ data: credentialStateFromSecret(secret) });
  });

  // GET /v1/tenant/integrations/google/oauth - Generate Google Calendar consent URL
  app.get('/google/oauth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }

    const tenantId = req.tenantId;

    // Generate CSRF state
    const state = crypto.randomBytes(16).toString('hex');
    
    // Store CSRF state in Redis for 10 minutes
    await redis.set(`google:oauth:${state}`, tenantId, 'EX', 600);

    const redirectUri = `${env.API_URL}/v1/tenant/integrations/google/callback`;
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' ');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state: state,
    }).toString();

    logger.info({ tenantId, state }, 'Generated Google OAuth consent URL');
    return reply.send({ auth_url: authUrl });
  });

  // GET /v1/tenant/integrations/google/callback - Process Google Calendar OAuth callback
  app.get('/google/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    if (error) {
      logger.error({ error }, 'Google OAuth Callback returned error');
      return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=error`);
    }

    if (!code || !state) {
      logger.warn('Google OAuth Callback missing code or state');
      return reply.code(400).send({ error: 'Bad Request', message: 'Missing oauth code or state' });
    }

    // 1. Verify CSRF State
    const tenantId = await redis.get(`google:oauth:${state}`);
    if (!tenantId) {
      logger.warn({ state }, 'Google OAuth Callback state expired or invalid');
      return reply.code(400).send({ error: 'CSRF_FAILED', message: 'OAuth state is invalid or has expired' });
    }

    // Delete state to prevent replay attack
    await redis.del(`google:oauth:${state}`);

    // 2. Exchange authorization code for tokens
    try {
      const redirectUri = `${env.API_URL}/v1/tenant/integrations/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          code: code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        logger.error({ status: tokenRes.status, body: errorText }, 'Google Token Exchange failed');
        return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=token_exchange_failed`);
      }

      const tokenData = (await tokenRes.json()) as { refresh_token?: string; access_token: string };

      if (!tokenData.refresh_token) {
        logger.warn({ tenantId }, 'Google OAuth Callback did not return refresh token');
        // If Google didn't return a refresh token, check if we already have one
        const { data: existingSecret } = await dbAdmin
          .from('tenant_secrets')
          .select('google_oauth_refresh_encrypted')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (existingSecret?.google_oauth_refresh_encrypted) {
          logger.info({ tenantId }, 'Google OAuth Callback: Using pre-existing refresh token');
          return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=success`);
        }

        return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=missing_refresh_token`);
      }

      // 3. Encrypt & Save refresh token
      const encrypted = await encryptSecret(tokenData.refresh_token);

      await dbAdmin
        .from('tenant_secrets')
        .upsert({
          tenant_id: tenantId,
          google_oauth_refresh_encrypted: encrypted,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id' });

      logger.info({ tenantId }, 'Google Calendar OAuth integration configured successfully');
      
      // Redirect to tenant frontend dashboard success page
      return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=success`);
    } catch (err) {
      logger.error({ err, tenantId }, 'Error configuring Google Calendar integration');
      return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=server_error`);
    }
  });

  // 🔹 WhatsApp (Evolution API) 🔹
  
  // GET /v1/tenant/integrations/whatsapp/status - Check WhatsApp connection status
  app.get('/whatsapp/status', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }

    const tenantId = req.tenantId;

    try {
      const { data: secretRecord } = await dbAdmin
        .from('tenant_secrets')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!secretRecord || !secretRecord.evolution_instance_name) {
        return reply.send({
          status: 'disconnected',
          configured: false,
          instanceName: null,
        });
      }

      const instanceName = secretRecord.evolution_instance_name;
      const baseUrl = secretRecord.evolution_base_url || env.EVOLUTION_BASE_URL;
      
      let apiKey = env.EVOLUTION_GUILDS_API_KEY;
      if (secretRecord.evolution_api_key_encrypted) {
        const decrypted = await getDecryptedSecrets(tenantId);
        if (decrypted && decrypted.evolutionApiKey) {
          apiKey = decrypted.evolutionApiKey;
        }
      }

      const evoClient = createEvolutionClient();
      const stateRes = await evoClient.getConnectionState({
        instance: instanceName,
        baseUrl,
        apiKey,
      });

      if (!stateRes.ok) {
        logger.warn({ tenantId, instanceName, error: stateRes.error }, 'Failed to get WhatsApp connection state');
        return reply.send({
          status: 'disconnected',
          configured: true,
          instanceName,
          error: WHATSAPP_STATUS_UNAVAILABLE,
        });
      }

      return reply.send({
        status: stateRes.value.state === 'open' ? 'connected' : 'disconnected',
        configured: true,
        instanceName,
      });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Error getting WhatsApp connection status');
      return reply.code(500).send({ error: 'InternalServerError', message: WHATSAPP_INTEGRATION_ERROR_MESSAGE });
    }
  });

  // POST /v1/tenant/integrations/whatsapp/connect - Create instance & fetch QR Code
  app.post('/whatsapp/connect', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }

    const tenantId = req.tenantId;

    try {
      const { data: tenant, error: tenantErr } = await dbAdmin
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle();

      if (tenantErr) throw tenantErr;

      if (!tenant) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tenant not found' });
      }

      let { data: secretRecord } = await dbAdmin
        .from('tenant_secrets')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      const cleanSlug = tenant.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
      const defaultInstanceName = `tenant_${cleanSlug}`;

      if (!secretRecord) {
        const { data: created, error: createErr } = await dbAdmin
          .from('tenant_secrets')
          .insert({
            tenant_id: tenantId,
            evolution_instance_name: defaultInstanceName,
            evolution_webhook_secret: crypto.randomBytes(16).toString('hex'),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (createErr) throw createErr;
        secretRecord = created;
      } else if (!secretRecord.evolution_instance_name) {
        const { data: updated, error: updateErr } = await dbAdmin
          .from('tenant_secrets')
          .update({
            evolution_instance_name: defaultInstanceName,
            evolution_webhook_secret: secretRecord.evolution_webhook_secret || crypto.randomBytes(16).toString('hex'),
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenantId)
          .select()
          .single();
        if (updateErr) throw updateErr;
        secretRecord = updated;
      }

      const instanceName = secretRecord!.evolution_instance_name!;
      const baseUrl = secretRecord!.evolution_base_url || env.EVOLUTION_BASE_URL;
      let apiKey = env.EVOLUTION_GUILDS_API_KEY;

      if (secretRecord!.evolution_api_key_encrypted) {
        const decrypted = await getDecryptedSecrets(tenantId);
        if (decrypted && decrypted.evolutionApiKey) {
          apiKey = decrypted.evolutionApiKey;
        }
      }

      const evoClient = createEvolutionClient();

      logger.info({ tenantId, instanceName }, 'Creating/verifying WhatsApp instance on Evolution API');
      const createRes = await evoClient.createInstance({
        instance: instanceName,
        baseUrl,
        apiKey,
      });

      if (!createRes.ok) {
        logger.info({ tenantId, instanceName, error: createRes.error }, 'Instance create returned error, checking if instance already exists');
      } else {
        const newApiKey = createRes.value.apikey;
        if (newApiKey && newApiKey !== apiKey && newApiKey !== env.EVOLUTION_GUILDS_API_KEY) {
          const encryptedKey = await encryptSecret(newApiKey);
          await dbAdmin
            .from('tenant_secrets')
            .update({ evolution_api_key_encrypted: encryptedKey, updated_at: new Date().toISOString() })
            .eq('tenant_id', tenantId);
          apiKey = newApiKey;
        }
      }

      const webhookSecret = secretRecord!.evolution_webhook_secret || crypto.randomBytes(16).toString('hex');
      if (!secretRecord!.evolution_webhook_secret) {
        await dbAdmin
          .from('tenant_secrets')
          .update({ evolution_webhook_secret: webhookSecret, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId);
      }

      const webhookUrl = `${env.API_URL}/v1/webhooks/evolution`;
      logger.info({ tenantId, webhookUrl }, 'Configuring webhook URL on Evolution API');
      
      const webhookRes = await evoClient.setWebhook({
        instance: instanceName,
        baseUrl,
        apiKey,
        webhookUrl,
        secret: webhookSecret,
      });

      if (!webhookRes.ok) {
        logger.warn({ tenantId, error: webhookRes.error }, 'Failed to configure webhook on Evolution API');
      }

      logger.info({ tenantId, instanceName }, 'Fetching WhatsApp pairing QR Code');
      const qrRes = await evoClient.getQrCode({
        instance: instanceName,
        baseUrl,
        apiKey,
      });

      if (!qrRes.ok) {
        logger.warn({ tenantId, instanceName, error: qrRes.error }, 'Failed to retrieve WhatsApp pairing QR Code');
        return reply.code(500).send({
          error: 'EXTERNAL_SERVICE_ERROR',
          message: 'Failed to retrieve WhatsApp pairing QR Code from Evolution API',
          details: WHATSAPP_QR_UNAVAILABLE,
        });
      }

      return reply.send({
        instanceName,
        qrcode: qrRes.value.base64,
      });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Error connecting WhatsApp integration');
      return reply.code(500).send({ error: 'InternalServerError', message: WHATSAPP_INTEGRATION_ERROR_MESSAGE });
    }
  });

  // POST /v1/tenant/integrations/whatsapp/disconnect - Disconnect session
  app.post('/whatsapp/disconnect', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }

    const tenantId = req.tenantId;

    try {
      const { data: secretRecord } = await dbAdmin
        .from('tenant_secrets')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!secretRecord || !secretRecord.evolution_instance_name) {
        return reply.code(400).send({ error: 'BadRequest', message: 'WhatsApp integration is not configured' });
      }

      const instanceName = secretRecord.evolution_instance_name;
      const baseUrl = secretRecord.evolution_base_url || env.EVOLUTION_BASE_URL;
      let apiKey = env.EVOLUTION_GUILDS_API_KEY;

      if (secretRecord.evolution_api_key_encrypted) {
        const decrypted = await getDecryptedSecrets(tenantId);
        if (decrypted && decrypted.evolutionApiKey) {
          apiKey = decrypted.evolutionApiKey;
        }
      }

      const evoClient = createEvolutionClient();

      logger.info({ tenantId, instanceName }, 'Logging out WhatsApp instance on Evolution API');
      const logoutRes = await evoClient.logoutInstance({
        instance: instanceName,
        baseUrl,
        apiKey,
      });

      if (!logoutRes.ok) {
        logger.warn({ tenantId, error: logoutRes.error }, 'Logout returned error, attempting deletion next');
      }

      logger.info({ tenantId, instanceName }, 'Deleting WhatsApp instance on Evolution API');
      const deleteRes = await evoClient.deleteInstance({
        instance: instanceName,
        baseUrl,
        apiKey,
      });

      if (!deleteRes.ok) {
        logger.error({ tenantId, error: deleteRes.error }, 'Failed to delete instance from Evolution API');
      }

      await dbAdmin
        .from('tenant_secrets')
        .update({
          evolution_api_key_encrypted: null,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId);

      return reply.send({ success: true, message: 'WhatsApp session disconnected successfully' });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Error disconnecting WhatsApp integration');
      return reply.code(500).send({ error: 'InternalServerError', message: WHATSAPP_INTEGRATION_ERROR_MESSAGE });
    }
  });
};

export default integrationsRoutes;
