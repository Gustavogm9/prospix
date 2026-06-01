import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { BillingStatus, TenantStatus } from '@prospix/shared-types';
import { createTenantQueue } from '../../lib/queue.js';
import crypto from 'crypto';

function createExternalEventJobId(provider: string, ...parts: Array<string | null | undefined>): string {
  const hash = crypto
    .createHash('sha256')
    .update(parts.filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 32);

  return `external-${provider}-${hash}`;
}

function getHeaderValue(value: FastifyRequest['headers'][string]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // POST /v1/webhooks/asaas
  app.post('/asaas', async (req: FastifyRequest, reply: FastifyReply) => {
    // Prefer the documented header while accepting the legacy name during transition.
    const token =
      getHeaderValue(req.headers['asaas-access-token']) ??
      getHeaderValue(req.headers['asaas-token']);

    if (!token || token !== env.ASAAS_WEBHOOK_SECRET) {
      logger.warn({ hasToken: Boolean(token) }, 'Unauthorized Asaas Webhook Attempt');
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid Asaas token' });
    }

    const body = req.body as any;
    const event = body.event;
    const payment = body.payment;

    logger.info({ event, payment_id: payment?.id }, 'Received Asaas Webhook');

    if (!payment) {
      return reply.code(400).send({ error: 'Validation Error', message: 'Missing payment details' });
    }

    // 1. PAYMENT RECEIVED / CONFIRMED
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const { data: billing } = await dbAdmin
        .from('tenant_billing')
        .select('*, tenants(*)')
        .eq('external_invoice_id', payment.id)
        .limit(1)
        .single();

      if (billing) {
        // Mark invoice as PAID
        const { error: billingErr } = await dbAdmin
          .from('tenant_billing')
          .update({
            status: BillingStatus.PAID,
            paid_at: new Date().toISOString(),
            payment_method: payment.billingType || 'ASAAS',
            external_invoice_id: payment.id,
          })
          .eq('id', billing.id);
        if (billingErr) throw billingErr;

        // Reactivate tenant if suspended
        const tenant = billing.tenants as any;
        if (tenant?.status === TenantStatus.SUSPENDED) {
          const { error: tenantErr } = await dbAdmin
            .from('tenants')
            .update({ status: TenantStatus.ACTIVE })
            .eq('id', billing.tenant_id);
          if (tenantErr) throw tenantErr;

          // Log Audit
          const { error: auditErr } = await dbAdmin
            .from('audit_log')
            .insert({
              action: 'tenant.auto_resume_payment',
              target_type: 'tenant',
              target_id: billing.tenant_id,
              payload: { billing_id: billing.id, payment_id: payment.id },
            });
          if (auditErr) throw auditErr;
        }

        logger.info({ billing_id: billing.id, tenant_id: billing.tenant_id }, 'Billing updated to PAID via Asaas Webhook');
      } else {
        logger.warn({ payment_id: payment.id, subscription_id: payment.subscription }, 'No matching billing record found for received payment');
      }
    }

    // 2. PAYMENT OVERDUE (vencimento do boleto/cartão)
    if (event === 'PAYMENT_OVERDUE') {
      const { data: billing } = await dbAdmin
        .from('tenant_billing')
        .select('*')
        .eq('external_invoice_id', payment.id)
        .limit(1)
        .single();

      if (billing) {
        const { error: updateErr } = await dbAdmin
          .from('tenant_billing')
          .update({ status: BillingStatus.OVERDUE })
          .eq('id', billing.id);
        if (updateErr) throw updateErr;

        logger.info({ billing_id: billing.id }, 'Billing marked as OVERDUE');

        // Schedule delayed suspension task (14 days delay to hit D+15 suspension)
        const delayMs = 14 * 24 * 60 * 60 * 1000;
        const billingQueue = createTenantQueue(billing.tenant_id, 'billing-suspension');
        await billingQueue.add(
          'check-overdue-suspension',
          {
            tenant_id: billing.tenant_id,
            billing_id: billing.id,
            trace_id: crypto.randomUUID(),
          },
          {
            delay: delayMs,
            jobId: createExternalEventJobId('asaas', billing.tenant_id, event, payment.id),
          }
        );

        logger.info({ tenant_id: billing.tenant_id, billing_id: billing.id }, 'Scheduled D+15 suspension check job');
      }
    }

    return reply.send({ success: true });
  });
};

export default webhookRoutes;
