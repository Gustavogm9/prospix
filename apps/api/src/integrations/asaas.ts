import { Result } from '@prospix/shared-types';
import { ResultHelper } from '../lib/result.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export interface AsaasCustomer {
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
}

export interface AsaasSubscription {
  id: string;
  value: number;
  cycle: 'MONTHLY' | 'YEARLY';
  status: string;
}

export interface AsaasPayment {
  id: string;
  status: string;
  value: number;
}

export function createAsaasClient() {
  const apiKey = env.ASAAS_API_KEY;
  const baseUrl = env.ASAAS_BASE_URL.endsWith('/') ? env.ASAAS_BASE_URL.slice(0, -1) : env.ASAAS_BASE_URL;

  const headers = {
    'Content-Type': 'application/json',
    'access_token': apiKey,
  };

  return {
    async createCustomer(params: {
      name: string;
      email: string;
      cpfCnpj: string;
      whatsapp?: string;
    }): Promise<Result<AsaasCustomer>> {
      try {
        const response = await fetch(`${baseUrl}/customers`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: params.name,
            email: params.email,
            cpfCnpj: params.cpfCnpj,
            mobilePhone: params.whatsapp,
          }),
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Asaas createCustomer failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Asaas returned ${response.status}: ${errTxt}`,
          });
        }

        const data = (await response.json()) as any;
        return ResultHelper.success({
          id: data.id,
          name: data.name,
          email: data.email,
          cpfCnpj: data.cpfCnpj,
        });
      } catch (err: any) {
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to communicate with Asaas',
        });
      }
    },

    async createSubscription(params: {
      customerId: string;
      value: number;
      nextDueDate: string; // YYYY-MM-DD
    }): Promise<Result<AsaasSubscription>> {
      try {
        const response = await fetch(`${baseUrl}/subscriptions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            customer: params.customerId,
            billingType: 'CREDIT_CARD',
            value: params.value,
            nextDueDate: params.nextDueDate,
            cycle: 'MONTHLY',
          }),
        });

        if (!response.ok) {
          const errTxt = await response.text();
          logger.error({ status: response.status, body: errTxt }, 'Asaas createSubscription failed');
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Asaas returned ${response.status}: ${errTxt}`,
          });
        }

        const data = (await response.json()) as any;
        return ResultHelper.success({
          id: data.id,
          value: data.value,
          cycle: data.cycle,
          status: data.status,
        });
      } catch (err: any) {
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to communicate with Asaas',
        });
      }
    },

    async updateSubscription(
      subscriptionId: string,
      params: { value: number }
    ): Promise<Result<AsaasSubscription>> {
      try {
        const response = await fetch(`${baseUrl}/subscriptions/${subscriptionId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            value: params.value,
          }),
        });

        if (!response.ok) {
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Asaas updateSubscription returned ${response.status}`,
          });
        }

        const data = (await response.json()) as any;
        return ResultHelper.success({
          id: data.id,
          value: data.value,
          cycle: data.cycle,
          status: data.status,
        });
      } catch (err: any) {
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to communicate with Asaas',
        });
      }
    },

    async cancelSubscription(subscriptionId: string): Promise<Result<{ success: boolean }>> {
      try {
        const response = await fetch(`${baseUrl}/subscriptions/${subscriptionId}`, {
          method: 'DELETE',
          headers,
        });

        if (!response.ok) {
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Asaas cancelSubscription returned ${response.status}`,
          });
        }

        return ResultHelper.success({ success: true });
      } catch (err: any) {
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to communicate with Asaas',
        });
      }
    },

    async getPaymentStatus(paymentId: string): Promise<Result<AsaasPayment>> {
      try {
        const response = await fetch(`${baseUrl}/payments/${paymentId}`, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          return ResultHelper.failure({
            code: 'EXTERNAL_SERVICE_DOWN',
            message: `Asaas getPaymentStatus returned ${response.status}`,
          });
        }

        const data = (await response.json()) as any;
        return ResultHelper.success({
          id: data.id,
          status: data.status,
          value: data.value,
        });
      } catch (err: any) {
        return ResultHelper.failure({
          code: 'EXTERNAL_SERVICE_DOWN',
          message: err.message || 'Failed to communicate with Asaas',
        });
      }
    },
  };
}
