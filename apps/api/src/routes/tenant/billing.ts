import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { BillingStatus, TenantPlan } from '@prospix/shared-types';
import { getDb } from '../../lib/db.js';

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
  period_month: string;
  mrr_cents: number;
  excess_cents: number;
  total_cents: number;
  status: BillingStatus;
  paid_at: string | null;
  due_at: string;
  invoice_url: string | null;
  payment_method: string | null;
  external_invoice_id: string | null;
}) => ({
  id: billing.id,
  periodMonth: billing.period_month.slice(0, 10),
  mrrCents: billing.mrr_cents,
  excessCents: billing.excess_cents,
  totalCents: billing.total_cents,
  status: billing.status,
  paidAt: billing.paid_at || null,
  dueAt: billing.due_at,
  invoiceUrl: billing.invoice_url,
  paymentMethod: billing.payment_method,
  externalInvoiceId: billing.external_invoice_id,
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
    const db = getDb(req);
    const periodMonth = startOfMonth();
    const periodMonthISO = periodMonth.toISOString();

    const [tenantRes, usageRes, invoicesRes] = await Promise.all([
      db.from('tenants')
        .select('id, name, plan, mrr_cents, status')
        .eq('id', tenantId)
        .is('deleted_at', null)
        .single(),
      db.from('tenant_usage')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period_month', periodMonthISO)
        .maybeSingle(),
      db.from('tenant_billing')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('due_at', { ascending: false })
        .limit(12),
    ]);

    if (tenantRes.error || !tenantRes.data) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    const tenant = tenantRes.data;
    const currentUsage = usageRes.data;
    const invoices = invoicesRes.data || [];

    const currentInvoice =
      invoices.find((invoice) => invoice.period_month === periodMonthISO) ||
      invoices.find((invoice) => invoice.status === BillingStatus.PENDING || invoice.status === BillingStatus.OVERDUE) ||
      invoices[0] ||
      null;

    return reply.send({
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          planName: PLAN_LABELS[tenant.plan as TenantPlan],
          mrrCents: tenant.mrr_cents,
          status: tenant.status,
        },
        usage: {
          periodMonth: periodMonth.toISOString().slice(0, 10),
          llmTokensInput: Number(currentUsage?.llm_tokens_input || 0),
          llmTokensOutput: Number(currentUsage?.llm_tokens_output || 0),
          llmCostCents: currentUsage?.llm_cost_cents || 0,
          whatsappMessagesSent: currentUsage?.whatsapp_messages_sent || 0,
          whatsappCostCents: currentUsage?.whatsapp_cost_cents || 0,
          googleMapsCalls: currentUsage?.google_maps_calls || 0,
          googleMapsCostCents: currentUsage?.google_maps_cost_cents || 0,
          conversationsStarted: currentUsage?.conversations_started || 0,
          meetingsScheduled: currentUsage?.meetings_scheduled || 0,
        },
        currentInvoice: currentInvoice ? serializeBilling(currentInvoice) : null,
        invoices: invoices.map(serializeBilling),
      },
    });
  });
};

export default billingRoutes;
