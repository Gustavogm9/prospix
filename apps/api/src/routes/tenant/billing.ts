import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { BillingStatus, TenantPlan } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const PLAN_LABELS: Record<TenantPlan, string> = {
  STARTER: 'Starter',
  STANDARD: 'Standard',
  PREMIUM: 'Premium',
};

const startOfMonth = (date = new Date()) => {
  const month = new Date(date);
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  return month;
};

const serializeBilling = (billing: {
  id: string;
  periodMonth: Date;
  mrrCents: number;
  excessCents: number;
  totalCents: number;
  status: BillingStatus;
  paidAt: Date | null;
  dueAt: Date;
  invoiceUrl: string | null;
  paymentMethod: string | null;
  externalInvoiceId: string | null;
}) => ({
  id: billing.id,
  periodMonth: billing.periodMonth.toISOString().slice(0, 10),
  mrrCents: billing.mrrCents,
  excessCents: billing.excessCents,
  totalCents: billing.totalCents,
  status: billing.status,
  paidAt: billing.paidAt?.toISOString() || null,
  dueAt: billing.dueAt.toISOString(),
  invoiceUrl: billing.invoiceUrl,
  paymentMethod: billing.paymentMethod,
  externalInvoiceId: billing.externalInvoiceId,
});

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }
  });

  // GET /v1/tenant/billing - Current billing, invoices and usage for this tenant
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const periodMonth = startOfMonth();

    const [tenant, currentUsage, invoices] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          plan: true,
          mrrCents: true,
          status: true,
        },
      }),
      prisma.tenantUsage.findUnique({
        where: {
          tenantId_periodMonth: {
            tenantId,
            periodMonth,
          },
        },
      }),
      prisma.tenantBilling.findMany({
        where: { tenantId },
        orderBy: { dueAt: 'desc' },
        take: 12,
      }),
    ]);

    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    const currentInvoice =
      invoices.find((invoice) => invoice.periodMonth.getTime() === periodMonth.getTime()) ||
      invoices.find((invoice) => invoice.status === BillingStatus.PENDING || invoice.status === BillingStatus.OVERDUE) ||
      invoices[0] ||
      null;

    return reply.send({
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          planName: PLAN_LABELS[tenant.plan],
          mrrCents: tenant.mrrCents,
          status: tenant.status,
        },
        usage: {
          periodMonth: periodMonth.toISOString().slice(0, 10),
          llmTokensInput: Number(currentUsage?.llmTokensInput || 0),
          llmTokensOutput: Number(currentUsage?.llmTokensOutput || 0),
          llmCostCents: currentUsage?.llmCostCents || 0,
          whatsappMessagesSent: currentUsage?.whatsappMessagesSent || 0,
          whatsappCostCents: currentUsage?.whatsappCostCents || 0,
          googleMapsCalls: currentUsage?.googleMapsCalls || 0,
          googleMapsCostCents: currentUsage?.googleMapsCostCents || 0,
          conversationsStarted: currentUsage?.conversationsStarted || 0,
          meetingsScheduled: currentUsage?.meetingsScheduled || 0,
        },
        currentInvoice: currentInvoice ? serializeBilling(currentInvoice) : null,
        invoices: invoices.map(serializeBilling),
      },
    });
  });
};

export default billingRoutes;
