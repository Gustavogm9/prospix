import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyDigestWorker } from './daily-digest.js';
import { Job } from 'bullmq';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

const mockSendText = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 'msg-123' } });

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

describe('Daily Digest Worker', () => {
  const worker = new DailyDigestWorker();

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it('should compile operational digest and send to owner successfully', async () => {
    setTableResult('tenants', {
      data: [
        {
          id: 'tenant-123',
          name: 'Giovane Seguros',
          status: 'ACTIVE',
        },
      ],
      error: null,
    });

    setTableResult('meetings', {
      data: [
        {
          id: 'meet-1',
          scheduled_for: new Date().toISOString(),
          location: 'Zoom',
          leads: { name: 'João Silva' },
        },
      ],
      error: null,
    });

    setTableResult('leads', {
      data: [
        {
          id: 'lead-1',
          name: 'Amanda Santos',
          fit_score: 9.0,
        },
      ],
      error: null,
      count: 4,
    });

    setTableResult('users', {
      data: {
        id: 'owner-abc',
        whatsapp: '5511999999999',
        role: 'OWNER',
      },
      error: null,
    });

    setTableResult('tenant_secrets', {
      data: {
        evolution_instance_name: 'mock-instance',
        evolution_base_url: 'https://evo.example.com',
      },
      error: null,
    });

    const mockJob = {
      id: 'job-digest',
      data: {
        tenant_id: 'tenant-123',
        trace_id: 'trace-123',
      },
    } as unknown as Job;

    const result = await worker.process(mockJob);

    expect(result.success).toBe(true);
    expect(result.digests_sent).toBe(1);
    expect(dbAdmin.from).toHaveBeenCalledWith('tenants');

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5511999999999',
        text: expect.stringContaining('PROSPIX DIGEST MATINAL'),
      })
    );
  });
});
