import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { BillingStatus, TenantStatus, CampaignStatus, UserRole } from '@prisma/client';
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
    const billing = await prisma.tenantBilling.findUnique({
      where: { id: billing_id },
      include: { tenant: true },
    });

    if (!billing) {
      logger.warn({ billing_id }, 'Billing invoice not found for suspension check');
      return { success: false, suspended: false };
    }

    // 2. Check if it's still unpaid (PENDING or OVERDUE)
    const isUnpaid = billing.status === BillingStatus.PENDING || billing.status === BillingStatus.OVERDUE;

    if (isUnpaid) {
      logger.info({ tenant_id, billing_id }, 'Unpaid invoice detected after grace period. Executing auto-suspension.');

      await prisma.$transaction(async (tx) => {
        // Suspend Tenant
        await tx.tenant.update({
          where: { id: tenant_id },
          data: { status: TenantStatus.SUSPENDED },
        });

        // Pause all active campaigns
        await tx.campaign.updateMany({
          where: { tenantId: tenant_id, status: CampaignStatus.ACTIVE },
          data: { status: CampaignStatus.PAUSED },
        });

        // Log Audit
        await tx.auditLog.create({
          data: {
            action: 'tenant.auto_suspend_inadimplencia',
            targetType: 'tenant',
            targetId: tenant_id,
            payload: { billing_id, due_at: billing.dueAt },
          },
        });
      });

      // Send quota warning notification to owner
      const owner = await prisma.user.findFirst({
        where: { tenantId: tenant_id, role: UserRole.OWNER, deletedAt: null },
      });

      if (owner) {
        await sendNotification({
          tenantId: tenant_id,
          userId: owner.id,
          type: 'billing_suspension',
          title: '🚨 Sua conta do Prospix foi suspensa',
          body: 'Identificamos uma fatura pendente há mais de 15 dias. O atendimento automatizado foi pausado. Regularize sua assinatura para reativar.',
          data: { billing_id, amount_cents: billing.totalCents },
        });
      }

      return { success: true, suspended: true };
    }

    logger.info({ tenant_id, billing_id }, 'Invoice was paid or cancelled. Suspension bypassed.');
    return { success: true, suspended: false };
  }
}
