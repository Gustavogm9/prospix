import { Result } from '@prospix/shared-types';
import { ResultHelper } from '../lib/result.js';
import { logger } from '../lib/logger.js';
import crypto from 'crypto';

export interface CheckPhoneResult {
  exists: boolean;
  jid?: string;
}

export interface SendMessageResult {
  messageId: string;
}

export interface ConnectionStateResult {
  state: 'open' | 'connecting' | 'close';
}

/**
 * Validate HMAC signature sent by Evolution API Webhooks.
 */
export function validateEvolutionWebhookSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret);
    const computed = hmac.update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'));
  } catch (_) {
    return false;
  }
}

/**
 * Legacy single helper for checkPhone.
 */
export async function checkPhone(params: {
  phone: string;
  instanceName: string;
  baseUrl: string;
  apiKey: string;
}): Promise<Result<CheckPhoneResult>> {
  const client = createEvolutionClient();
  const res = await client.checkNumbers({
    instance: params.instanceName,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    numbers: [params.phone],
  });
  if (!res.ok) return ResultHelper.failure(res.error);
  const first = res.value[0];
  if (!first) {
    return ResultHelper.failure({
      code: 'VALIDATION_ERROR',
      message: 'No result returned for phone number check',
    });
  }
  return ResultHelper.success(first);
}

/**
 * Evolution API Client Factory
 */
export function createEvolutionClient() {
  return {
    async sendText(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
      number: string;
      text: string;
    }): Promise<Result<SendMessageResult>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/message/sendText/${params.instance}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': params.apiKey,
          },
          body: JSON.stringify({
            number: params.number,
            options: { delay: 1200, presence: 'composing' },
            textMessage: { text: params.text },
          }),
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Evolution API sendText failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API sendText returned ${response.status}`,
          });
        }

        const data = (await response.json()) as any;
        const messageId = data.key?.id || data.messageId || data.id;

        if (!messageId) {
          logger.error({ responseKeys: Object.keys(data || {}) }, 'Evolution API sendText did not return a message id');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: 'Evolution API sendText did not return a message id',
          });
        }

        return ResultHelper.success({
          messageId,
        });
      } catch (err: any) {
        logger.error({ err }, 'Exception calling Evolution API sendText');
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to send message via Evolution API',
        });
      }
    },

    async checkNumbers(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
      numbers: string[];
    }): Promise<Result<CheckPhoneResult[]>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/chat/whatsappNumbers/${params.instance}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': params.apiKey,
          },
          body: JSON.stringify({ numbers: params.numbers }),
        });

        if (!response.ok) {
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API checkNumbers returned ${response.status}`,
          });
        }

        const data = (await response.json()) as any[];
        const mapped = data.map((item) => ({
          exists: item.exists ?? false,
          jid: item.jid,
        }));
        return ResultHelper.success(mapped);
      } catch (err: any) {
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to check numbers via Evolution API',
        });
      }
    },

    async getConnectionState(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
    }): Promise<Result<ConnectionStateResult>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/instance/connectionState/${params.instance}`;

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'apikey': params.apiKey,
          },
        });

        if (!response.ok) {
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API connectionState returned ${response.status}`,
          });
        }

        const data = (await response.json()) as any;
        return ResultHelper.success({
          state: data.instance?.state === 'open' ? 'open' : 'close',
        });
      } catch (err: any) {
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to get connection state via Evolution API',
        });
      }
    },

    async createInstance(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
    }): Promise<Result<{ instanceName: string; apikey: string }>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/instance/create`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': params.apiKey,
          },
          body: JSON.stringify({
            instanceName: params.instance,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Evolution API createInstance failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API createInstance returned ${response.status}: ${errTxt}`,
          });
        }

        const data = (await response.json()) as any;
        const instApiKey = data.hash?.apikey || data.instance?.apikey || params.apiKey;
        return ResultHelper.success({
          instanceName: data.instance?.instanceName || params.instance,
          apikey: instApiKey,
        });
      } catch (err: any) {
        logger.error({ err }, 'Exception calling Evolution API createInstance');
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to create instance via Evolution API',
        });
      }
    },

    async getQrCode(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
    }): Promise<Result<{ base64: string }>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/instance/connect/${params.instance}`;

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'apikey': params.apiKey,
          },
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Evolution API getQrCode failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API getQrCode returned ${response.status}`,
          });
        }

        const data = (await response.json()) as any;
        const base64 = data.base64 || data.code || data.qrcode?.base64 || data.qrcode?.code || '';
        return ResultHelper.success({ base64 });
      } catch (err: any) {
        logger.error({ err }, 'Exception calling Evolution API getQrCode');
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to get QR code via Evolution API',
        });
      }
    },

    async logoutInstance(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
    }): Promise<Result<{ success: boolean }>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/instance/logout/${params.instance}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'apikey': params.apiKey,
          },
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Evolution API logout failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API logout returned ${response.status}`,
          });
        }

        return ResultHelper.success({ success: true });
      } catch (err: any) {
        logger.error({ err }, 'Exception calling Evolution API logout');
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to logout instance via Evolution API',
        });
      }
    },

    async deleteInstance(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
    }): Promise<Result<{ success: boolean }>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/instance/delete/${params.instance}`;

      try {
        const response = await fetch(url, {
          method: 'DELETE',
          headers: {
            'apikey': params.apiKey,
          },
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Evolution API delete failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API delete returned ${response.status}`,
          });
        }

        return ResultHelper.success({ success: true });
      } catch (err: any) {
        logger.error({ err }, 'Exception calling Evolution API delete');
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to delete instance via Evolution API',
        });
      }
    },

    async setWebhook(params: {
      instance: string;
      baseUrl: string;
      apiKey: string;
      webhookUrl: string;
      secret: string;
    }): Promise<Result<{ success: boolean }>> {
      const cleanUrl = params.baseUrl.endsWith('/') ? params.baseUrl.slice(0, -1) : params.baseUrl;
      const url = `${cleanUrl}/webhook/set/${params.instance}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': params.apiKey,
          },
          body: JSON.stringify({
            enabled: true,
            url: params.webhookUrl,
            events: [
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'SEND_MESSAGE',
              'CONNECTION_UPDATE',
              'QUALITY_RATING_UPDATE'
            ],
          }),
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Evolution API setWebhook failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Evolution API setWebhook returned ${response.status}`,
          });
        }

        return ResultHelper.success({ success: true });
      } catch (err: any) {
        logger.error({ err }, 'Exception calling Evolution API setWebhook');
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to set webhook via Evolution API',
        });
      }
    },
  };
}
