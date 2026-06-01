import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job } from 'bullmq';
import { sendNotification } from '../services/notification-service.js';
import { SendNotificationPayload, SendNotificationWorker } from './send-notification.js';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

vi.mock('../services/notification-service.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({ id: 'notif-123' }),
}));

describe('Send Notification Worker', () => {
  const worker = new SendNotificationWorker();

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
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
      } satisfies SendNotificationPayload,
    } as unknown as Job<SendNotificationPayload>;

    const result = await worker.process(mockJob);

    expect(result.sent).toBe(true);
    expect(result.notification_id).toBe('notif-123');
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-123',
        userId: 'user-123',
        type: 'custom_notice',
        title: 'Aviso',
        body: 'Mensagem importante',
      })
    );
  });

  it('should consume meeting reminder jobs and resolve owner user', async () => {
    setTableResult('users', {
      data: { id: 'owner-123' },
      error: null,
    });

    setTableResult('meetings', {
      data: {
        id: 'meeting-123',
        tenant_id: 'tenant-123',
        scheduled_for: new Date('2026-05-23T13:00:00.000Z').toISOString(),
        location: 'Google Meet',
        leads: { name: 'Ana Souza' },
      },
      error: null,
    });

    const mockJob = {
      id: 'job-reminder',
      data: {
        tenant_id: 'tenant-123',
        trace_id: 'trace-123',
        meeting_id: 'meeting-123',
        type: 'meeting_reminder_1h',
      } satisfies SendNotificationPayload,
    } as unknown as Job<SendNotificationPayload>;

    const result = await worker.process(mockJob);

    expect(result.sent).toBe(true);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-123',
        userId: 'owner-123',
        type: 'meeting_reminder_1h',
        title: expect.stringContaining('1 hora'),
      })
    );
  });

  it('should skip notification if no owner found and no user_id provided', async () => {
    setTableResult('users', {
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

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

    const result = await worker.process(mockJob);

    expect(result.sent).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
