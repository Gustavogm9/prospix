import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { sendNotification } from '../services/notification-service.js';
import { SendNotificationPayload, SendNotificationWorker } from './send-notification.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(),
    },
    meeting: {
      findUnique: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../services/notification-service.js', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

describe('Send Notification Worker', () => {
  const worker = new SendNotificationWorker();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch explicit notification jobs through NotificationService', async () => {
    const mockJob = {
      id: 'job-notify',
      data: {
        tenant_id: 'tenant-123',
        trace_id: 'trace-123',
        user_id: 'user-123',
        type: 'custom_notice',
        title: 'Aviso',
        body: 'Mensagem importante',
        link: 'https://app.prospix.com/notifications',
      } satisfies SendNotificationPayload,
    } as unknown as Job<SendNotificationPayload>;

    const result = await worker.process(mockJob);

    expect(result).toEqual({
      success: true,
      notified_user_id: 'user-123',
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      userId: 'user-123',
      type: 'custom_notice',
      title: 'Aviso',
      body: 'Mensagem importante',
      data: {
        lead_id: undefined,
        meeting_id: undefined,
      },
      link: 'https://app.prospix.com/notifications',
    });
  });

  it('should consume meeting reminder jobs and notify the tenant owner', async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: 'lead-123',
      tenantId: 'tenant-123',
      name: 'Ana Souza',
    } as any);

    vi.mocked(prisma.meeting.findUnique).mockResolvedValue({
      id: 'meeting-123',
      tenantId: 'tenant-123',
      scheduledFor: new Date('2026-05-23T13:00:00.000Z'),
      location: 'Google Meet',
    } as any);

    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'owner-123',
    } as any);

    const mockJob = {
      id: 'job-reminder',
      data: {
        tenant_id: 'tenant-123',
        trace_id: 'trace-123',
        lead_id: 'lead-123',
        meeting_id: 'meeting-123',
        type: 'meeting_reminder_1h',
      } satisfies SendNotificationPayload,
    } as unknown as Job<SendNotificationPayload>;

    const result = await worker.process(mockJob);

    expect(result.success).toBe(true);
    expect(result.notified_user_id).toBe('owner-123');
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-123',
        userId: 'owner-123',
        type: 'meeting_reminder_1h',
        title: 'Lembrete: reuniao em 1h',
        body: expect.stringContaining('Ana Souza'),
        data: {
          lead_id: 'lead-123',
          meeting_id: 'meeting-123',
        },
      })
    );
  });

  it('should skip owner-targeted jobs when the tenant has no owner', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    const mockJob = {
      id: 'job-no-owner',
      data: {
        tenant_id: 'tenant-123',
        trace_id: 'trace-123',
        type: 'custom_notice',
        title: 'Aviso',
        body: 'Mensagem importante',
      } satisfies SendNotificationPayload,
    } as unknown as Job<SendNotificationPayload>;

    await expect(worker.process(mockJob)).resolves.toEqual({
      success: true,
      skipped: true,
      reason: 'owner_not_found',
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('should fail reminder jobs when scoped records do not belong to the tenant', async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: 'lead-123',
      tenantId: 'other-tenant',
      name: 'Ana Souza',
    } as any);

    const mockJob = {
      id: 'job-mismatch',
      data: {
        tenant_id: 'tenant-123',
        trace_id: 'trace-123',
        lead_id: 'lead-123',
        type: 'meeting_reminder_24h',
      } satisfies SendNotificationPayload,
    } as unknown as Job<SendNotificationPayload>;

    await expect(worker.process(mockJob)).rejects.toThrow('Lead lead-123 not found or tenant mismatch');
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
