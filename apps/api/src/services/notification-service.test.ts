import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendNotification } from './notification-service.js';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

const mockSendText = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 'msg-abc' } });

vi.mock('../integrations/evolution.js', () => ({
  createEvolutionClient: vi.fn(() => ({
    sendText: mockSendText,
  })),
}));

vi.mock('../tenant/secrets-vault.js', () => ({
  getDecryptedSecrets: vi.fn().mockResolvedValue({
    evolutionApiKey: 'mock-key',
    evolutionInstanceName: 'mock-instance',
    evolutionBaseUrl: 'https://evo.example.com',
  }),
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
    resetDb();
  });

  it('should dispatch In-App and Email notifications by default when no preference is set', async () => {
    setTableResult('users', {
      data: {
        id: 'user-123',
        name: 'João Owner',
        email: 'joao@example.com',
        whatsapp: '5511999999999',
      },
      error: null,
    });

    setTableResult('notification_preferences', {
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

    setTableResult('notifications', {
      data: { id: 'notif-1' },
      error: null,
    });

    setTableResult('tenant_secrets', {
      data: null,
      error: null,
    });

    await sendNotification({
      tenantId: 'tenant-123',
      userId: 'user-123',
      type: 'meeting_scheduled',
      title: 'Reunião Agendada',
      body: 'Sua reunião foi marcada com sucesso.',
    });

    // Verify dbAdmin.from('notifications') was called (In-App)
    expect(dbAdmin.from).toHaveBeenCalledWith('notifications');

    // Email should be sent via fetch
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
      })
    );

    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('should dispatch WhatsApp notifications if explicitly enabled in preferences', async () => {
    setTableResult('users', {
      data: {
        id: 'user-123',
        name: 'João Owner',
        email: 'joao@example.com',
        whatsapp: '5511999999999',
      },
      error: null,
    });

    setTableResult('notification_preferences', {
      data: {
        user_id: 'user-123',
        event_type: 'meeting_scheduled',
        channels: ['PUSH', 'WHATSAPP'],
        enabled: true,
      },
      error: null,
    });

    setTableResult('notifications', {
      data: { id: 'notif-2' },
      error: null,
    });

    setTableResult('tenant_secrets', {
      data: {
        evolution_instance_name: 'mock-instance',
        evolution_base_url: 'https://evo.example.com',
      },
      error: null,
    });

    await sendNotification({
      tenantId: 'tenant-123',
      userId: 'user-123',
      type: 'meeting_scheduled',
      title: 'Reunião Agendada',
      body: 'Sua reunião foi marcada com sucesso.',
    });

    expect(dbAdmin.from).toHaveBeenCalledWith('notifications');
    expect(mockFetch).not.toHaveBeenCalled(); // Email disabled

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5511999999999',
        text: expect.stringContaining('Reunião Agendada'),
      })
    );
  });
});
