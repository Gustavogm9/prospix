import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { BillingStatus, TenantStatus } from '@prisma/client';
import { createTenantQueue } from '../../lib/queue.js';
import crypto from 'crypto';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // POST /v1/webhooks/asaas
  app.post('/asaas', async (req: FastifyRequest, reply: FastifyReply) => {
    // Optional: Validate Asaas token signature if configured in environment
    const token = req.headers['asaas-token'];
    if (env.ASAAS_WEBHOOK_SECRET && token !== env.ASAAS_WEBHOOK_SECRET) {
      logger.warn({ token }, 'Unauthorized Asaas Webhook Attempt');
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
      const billing = await prisma.tenantBilling.findFirst({
        where: {
          externalInvoiceId: payment.id,
        },
        include: { tenant: true },
      });

      if (billing) {
        await prisma.$transaction(async (tx) => {
          // Mark invoice as PAID
          await tx.tenantBilling.update({
            where: { id: billing.id },
            data: {
              status: BillingStatus.PAID,
              paidAt: new Date(),
              paymentMethod: payment.billingType || 'ASAAS',
              externalInvoiceId: payment.id,
            },
          });

          // Reactivate tenant if suspended
          if (billing.tenant.status === TenantStatus.SUSPENDED) {
            await tx.tenant.update({
              where: { id: billing.tenantId },
              data: { status: TenantStatus.ACTIVE },
            });

            // Log Audit
            await tx.auditLog.create({
              data: {
                action: 'tenant.auto_resume_payment',
                targetType: 'tenant',
                targetId: billing.tenantId,
                payload: { billing_id: billing.id, payment_id: payment.id },
              },
            });
          }
        });

        logger.info({ billing_id: billing.id, tenant_id: billing.tenantId }, 'Billing updated to PAID via Asaas Webhook');
      } else {
        logger.warn({ payment_id: payment.id, subscription_id: payment.subscription }, 'No matching billing record found for received payment');
      }
    }

    // 2. PAYMENT OVERDUE (vencimento do boleto/cartão)
    if (event === 'PAYMENT_OVERDUE') {
      const billing = await prisma.tenantBilling.findFirst({
        where: {
          externalInvoiceId: payment.id,
        },
      });

      if (billing) {
        await prisma.tenantBilling.update({
          where: { id: billing.id },
          data: { status: BillingStatus.OVERDUE },
        });

        logger.info({ billing_id: billing.id }, 'Billing marked as OVERDUE');

        // Schedule delayed suspension task (14 days delay to hit D+15 suspension)
        const delayMs = 14 * 24 * 60 * 60 * 1000;
        const billingQueue = createTenantQueue(billing.tenantId, 'billing-suspension');
        await billingQueue.add(
          'check-overdue-suspension',
          {
            tenant_id: billing.tenantId,
            billing_id: billing.id,
            trace_id: crypto.randomUUID(),
          },
          { delay: delayMs }
        );

        logger.info({ tenant_id: billing.tenantId, billing_id: billing.id }, 'Scheduled D+15 suspension check job');
      }
    }

    return reply.send({ success: true });
  });
};
export default webhookRoutes;
