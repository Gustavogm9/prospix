import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { BillingStatus, TenantStatus, CampaignStatus, UserRole } from '@prospix/shared-types';
import { sendNotification } from '../services/notification-service.js';

export interface BillingSuspensionPayload extends BaseJobPayload {
  billing_id: string;
}

export interface BillingSuspensionResult {
  success: boolean;
  suspended: boolean;
}

export class BillingSuspensionWorker extends BaseWorker<BillingSuspensionPayload, BillingSuspensionResult> {
  name = 'billing-suspension';
  concurrency = 5;

  async process(job: Job<BillingSuspensionPayload>): Promise<BillingSuspensionResult> {
    const { tenant_id, billing_id } = job.data;

    // 1. Fetch the billing invoice
    const { data: billing, error: billingErr } = await dbAdmin
      .from('tenant_billing')
      .select('*, tenants(*)')
      .eq('id', billing_id)
      .single();

    if (billingErr || !billing) {
      logger.warn({ billing_id }, 'Billing invoice not found for suspension check');
      return { success: false, suspended: false };
    }

    // 2. Check if it's still unpaid (PENDING or OVERDUE)
    const isUnpaid = billing.status === BillingStatus.PENDING || billing.status === BillingStatus.OVERDUE;

    if (isUnpaid) {
      logger.info({ tenant_id, billing_id }, 'Unpaid invoice detected after grace period. Executing auto-suspension.');

      // Suspend Tenant
      const { error: tenantErr } = await dbAdmin
        .from('tenants')
        .update({ status: TenantStatus.SUSPENDED })
        .eq('id', tenant_id);
      if (tenantErr) throw tenantErr;

      // Pause all active campaigns
      const { error: campErr } = await dbAdmin
        .from('campaigns')
        .update({ status: CampaignStatus.PAUSED })
        .eq('tenant_id', tenant_id)
        .eq('status', CampaignStatus.ACTIVE);
      if (campErr) throw campErr;

      // Log Audit
      const { error: auditErr } = await dbAdmin
        .from('audit_log')
        .insert({
          action: 'tenant.auto_suspend_inadimplencia',
          target_type: 'tenant',
          target_id: tenant_id,
          payload: { billing_id, due_at: billing.due_at },
        });
      if (auditErr) throw auditErr;

      // Send quota warning notification to owner
      const { data: owner } = await dbAdmin
        .from('users')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('role', UserRole.OWNER)
        .is('deleted_at', null)
        .limit(1)
        .single();

      if (owner) {
        await sendNotification({
          tenantId: tenant_id,
          userId: owner.id,
          type: 'billing_suspension',
          title: '⚠️ Sua conta do Prospix foi suspensa',
          body: 'Identificamos uma fatura pendente há mais de 15 dias. O atendimento automatizado foi pausado. Regularize sua assinatura para reativar.',
          data: { billing_id, amount_cents: billing.total_cents },
        });
      }

      return { success: true, suspended: true };
    }

    logger.info({ tenant_id, billing_id }, 'Invoice was paid or cancelled. Suspension bypassed.');
    return { success: true, suspended: false };
  }
}
