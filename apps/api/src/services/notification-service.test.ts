import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendNotification } from './notification-service.js';
import { prisma } from '../lib/prisma.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
    },
    notification: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

const mockSendText = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 'msg-abc' } });

vi.mock('../integrations/evolution.js', () => ({
  createEvolutionClient: vi.fn(() => ({
    sendText: mockSendText,
  })),
}));

// Mock global fetch for Resend email service
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  text: async () => 'Success',
});
global.fetch = mockFetch;

describe('Notification Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch In-App and Email notifications by default when no preference is set', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-123',
      name: 'João Owner',
      email: 'joao@example.com',
      whatsapp: '5511999999999',
    } as any);

    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue(null);

    await sendNotification({
      tenantId: 'tenant-123',
      userId: 'user-123',
      type: 'meeting_scheduled',
      title: 'Reunião Agendada',
      body: 'Sua reunião foi marcada com sucesso.',
    });

    expect(prisma.notification.create).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
      })
    );

    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('should dispatch WhatsApp notifications if explicitly enabled in preferences', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-123',
      name: 'João Owner',
      email: 'joao@example.com',
      whatsapp: '5511999999999',
    } as any);

    vi.mocked(prisma.notificationPreference.findUnique).mockResolvedValue({
      userId: 'user-123',
      eventType: 'meeting_scheduled',
      channels: ['PUSH', 'WHATSAPP'],
      enabled: true,
    } as any);

    await sendNotification({
      tenantId: 'tenant-123',
      userId: 'user-123',
      type: 'meeting_scheduled',
      title: 'Reunião Agendada',
      body: 'Sua reunião foi marcada com sucesso.',
    });

    expect(prisma.notification.create).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled(); // Email disabled

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5511999999999',
        text: expect.stringContaining('Reunião Agendada'),
      })
    );
  });
});
