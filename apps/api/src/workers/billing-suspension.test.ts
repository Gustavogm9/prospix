import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingSuspensionWorker } from './billing-suspension.js';
import { sendNotification } from '../services/notification-service.js';
import { Job } from 'bullmq';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

vi.mock('../services/notification-service.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({}),
}));

describe('Billing Suspension Worker', () => {
  const worker = new BillingSuspensionWorker();

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it('should suspend tenant when invoice is still unpaid after grace period', async () => {
    // Mock Overdue Invoice with tenant join
    setTableResult('tenant_billing', {
      data: {
        id: 'billing-123',
        tenant_id: 'tenant-xyz',
        status: 'OVERDUE',
        total_cents: 15000,
        due_at: new Date().toISOString(),
        tenants: {
          id: 'tenant-xyz',
          status: 'ACTIVE',
        },
      },
      error: null,
    });

    // Mock Owner User
    setTableResult('users', {
      data: { id: 'owner-abc', role: 'OWNER' },
      error: null,
    });

    // Mock other tables
    setTableResult('tenants', { data: {}, error: null });
    setTableResult('campaigns', { data: {}, error: null });
    setTableResult('audit_log', { data: {}, error: null });

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
    setTableResult('tenant_billing', {
      data: {
        id: 'billing-123',
        tenant_id: 'tenant-xyz',
        status: 'PAID',
      },
      error: null,
    });

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
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
