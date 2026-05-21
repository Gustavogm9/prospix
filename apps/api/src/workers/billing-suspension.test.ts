import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingSuspensionWorker } from './billing-suspension.js';
import { prisma } from '../lib/prisma.js';
import { sendNotification } from '../services/notification-service.js';
import { Job } from 'bullmq';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    tenantBilling: {
      findUnique: vi.fn(),
    },
    tenant: {
      update: vi.fn(),
    },
    campaign: {
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn(prisma)),
  },
}));

vi.mock('../services/notification-service.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
}));

describe('Billing Suspension Worker', () => {
  const worker = new BillingSuspensionWorker();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should suspend tenant when invoice is still unpaid after grace period', async () => {
    // Mock Overdue Invoice
    vi.mocked(prisma.tenantBilling.findUnique).mockResolvedValue({
      id: 'billing-123',
      tenantId: 'tenant-xyz',
      status: 'OVERDUE',
      totalCents: 15000,
      dueAt: new Date(),
      tenant: {
        id: 'tenant-xyz',
        status: 'ACTIVE',
      },
    } as any);

    // Mock Owner User
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'owner-abc',
      role: 'OWNER',
    } as any);

    const mockJob = {
      id: 'job-suspension',
      data: {
        tenant_id: 'tenant-xyz',
        billing_id: 'billing-123',
      },
    } as unknown as Job;

    const result = await worker.process(mockJob);

    expect(result.success).toBe(true);
    expect(result.suspended).toBe(true);

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-xyz' },
        data: { status: 'SUSPENDED' },
      })
    );

    expect(prisma.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-xyz', status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      })
    );

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-xyz',
        userId: 'owner-abc',
        type: 'billing_suspension',
      })
    );
  });

  it('should bypass suspension if invoice is already paid', async () => {
    // Mock PAID Invoice
    vi.mocked(prisma.tenantBilling.findUnique).mockResolvedValue({
      id: 'billing-123',
      tenantId: 'tenant-xyz',
      status: 'PAID',
    } as any);

    const mockJob = {
      id: 'job-suspension',
      data: {
        tenant_id: 'tenant-xyz',
        billing_id: 'billing-123',
      },
    } as unknown as Job;

    const result = await worker.process(mockJob);

    expect(result.success).toBe(true);
    expect(result.suspended).toBe(false);

    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(prisma.campaign.updateMany).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
