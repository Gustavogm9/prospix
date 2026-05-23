import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { encryptSecret, getDecryptedSecrets } from '../../tenant/secrets-vault.js';
import crypto from 'crypto';
import { createEvolutionClient } from '../../integrations/evolution.js';

const WHATSAPP_STATUS_UNAVAILABLE = 'CONNECTION_STATE_UNAVAILABLE';
const WHATSAPP_QR_UNAVAILABLE = 'QR_CODE_UNAVAILABLE';
const WHATSAPP_INTEGRATION_ERROR_MESSAGE = 'Failed to process WhatsApp integration request';

export const integrationsRoutes: FastifyPluginAsync = async (app) => {
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
        const existingSecret = await prisma.tenantSecret.findUnique({
          where: { tenantId },
        });

        if (existingSecret?.googleOauthRefreshEncrypted) {
          logger.info({ tenantId }, 'Google OAuth Callback: Using pre-existing refresh token');
          return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=success`);
        }

        return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=missing_refresh_token`);
      }

      // 3. Encrypt & Save refresh token
      const encrypted = await encryptSecret(tokenData.refresh_token);

      await prisma.tenantSecret.upsert({
        where: { tenantId },
        create: {
          tenantId,
          googleOauthRefreshEncrypted: encrypted,
        },
        update: {
          googleOauthRefreshEncrypted: encrypted,
        },
      });

      logger.info({ tenantId }, 'Google Calendar OAuth integration configured successfully');
      
      // Redirect to tenant frontend dashboard success page
      return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=success`);
    } catch (err) {
      logger.error({ err, tenantId }, 'Error configuring Google Calendar integration');
      return reply.redirect(`${env.APP_URL}/dashboard/integrations?google=server_error`);
    }
  });

  // ── WhatsApp (Evolution API) ────────────────────────────────────────────────
  
  // GET /v1/tenant/integrations/whatsapp/status - Check WhatsApp connection status
  app.get('/whatsapp/status', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }

    const tenantId = req.tenantId;

    try {
      const secretRecord = await prisma.tenantSecret.findUnique({
        where: { tenantId },
      });

      if (!secretRecord || !secretRecord.evolutionInstanceName) {
        return reply.send({
          status: 'disconnected',
          configured: false,
          instanceName: null,
        });
      }

      const instanceName = secretRecord.evolutionInstanceName;
      const baseUrl = secretRecord.evolutionBaseUrl || env.EVOLUTION_BASE_URL;
      
      let apiKey = env.EVOLUTION_GUILDS_API_KEY;
      if (secretRecord.evolutionApiKeyEncrypted) {
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
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tenant not found' });
      }

      let secretRecord = await prisma.tenantSecret.findUnique({
        where: { tenantId },
      });

      const cleanSlug = tenant.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
      const defaultInstanceName = `tenant_${cleanSlug}`;

      if (!secretRecord) {
        secretRecord = await prisma.tenantSecret.create({
          data: {
            tenantId,
            evolutionInstanceName: defaultInstanceName,
            evolutionWebhookSecret: crypto.randomBytes(16).toString('hex'),
          },
        });
      } else if (!secretRecord.evolutionInstanceName) {
        secretRecord = await prisma.tenantSecret.update({
          where: { tenantId },
          data: {
            evolutionInstanceName: defaultInstanceName,
            evolutionWebhookSecret: secretRecord.evolutionWebhookSecret || crypto.randomBytes(16).toString('hex'),
          },
        });
      }

      const instanceName = secretRecord.evolutionInstanceName!;
      const baseUrl = secretRecord.evolutionBaseUrl || env.EVOLUTION_BASE_URL;
      let apiKey = env.EVOLUTION_GUILDS_API_KEY;

      if (secretRecord.evolutionApiKeyEncrypted) {
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
          await prisma.tenantSecret.update({
            where: { tenantId },
            data: { evolutionApiKeyEncrypted: encryptedKey },
          });
          apiKey = newApiKey;
        }
      }

      const webhookSecret = secretRecord.evolutionWebhookSecret || crypto.randomBytes(16).toString('hex');
      if (!secretRecord.evolutionWebhookSecret) {
        await prisma.tenantSecret.update({
          where: { tenantId },
          data: { evolutionWebhookSecret: webhookSecret },
        });
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
      const secretRecord = await prisma.tenantSecret.findUnique({
        where: { tenantId },
      });

      if (!secretRecord || !secretRecord.evolutionInstanceName) {
        return reply.code(400).send({ error: 'BadRequest', message: 'WhatsApp integration is not configured' });
      }

      const instanceName = secretRecord.evolutionInstanceName;
      const baseUrl = secretRecord.evolutionBaseUrl || env.EVOLUTION_BASE_URL;
      let apiKey = env.EVOLUTION_GUILDS_API_KEY;

      if (secretRecord.evolutionApiKeyEncrypted) {
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

      await prisma.tenantSecret.update({
        where: { tenantId },
        data: {
          evolutionApiKeyEncrypted: null,
        },
      });

      return reply.send({ success: true, message: 'WhatsApp session disconnected successfully' });
    } catch (err: any) {
      logger.error({ err, tenantId }, 'Error disconnecting WhatsApp integration');
      return reply.code(500).send({ error: 'InternalServerError', message: WHATSAPP_INTEGRATION_ERROR_MESSAGE });
    }
  });
};

export default integrationsRoutes;
