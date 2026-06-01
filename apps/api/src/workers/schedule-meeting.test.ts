import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleMeetingWorker, ScheduleMeetingPayload } from './schedule-meeting.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { listEvents, createEvent } from '../integrations/google-calendar.js';
import { Job } from 'bullmq';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

// Mock Secrets Vault
vi.mock('../tenant/secrets-vault.js', () => ({
  getDecryptedSecrets: vi.fn(),
}));

// Mock Google Calendar integration
vi.mock('../integrations/google-calendar.js', () => ({
  listEvents: vi.fn(),
  createEvent: vi.fn(),
}));

// Mock Queue helper
vi.mock('../lib/queue.js', () => ({
  getTenantQueueName: vi.fn((t: string, w: string) => `queue:${t}:${w}`),
  createTenantQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({}),
  })),
}));

describe('Schedule Meeting Worker', () => {
  const worker = new ScheduleMeetingWorker();

  const mockJob = {
    id: 'job-123',
    data: {
      tenant_id: 'tenant-001',
      trace_id: 'trace-abc',
      lead_id: 'lead-001',
      scheduled_for: '2026-05-22T10:00:00.000Z',
      duration: 30,
      location: 'Zoom',
    } as ScheduleMeetingPayload,
  } as unknown as Job<ScheduleMeetingPayload>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it('should schedule meeting successfully when there are no conflicts', async () => {
    setTableResult('leads', {
      data: {
        id: 'lead-001',
        tenant_id: 'tenant-001',
        name: 'João Silva',
        email: 'joao@example.com',
        whatsapp: '5511999999999',
      },
      error: null,
    });

    setTableResult('tenant_secrets', {
      data: {
        tenant_id: 'tenant-001',
        google_calendar_id: 'primary',
      },
      error: null,
    });

    setTableResult('meetings', {
      data: {
        id: 'meeting-001',
        tenant_id: 'tenant-001',
        lead_id: 'lead-001',
        google_event_id: 'google-evt-123',
        scheduled_for: new Date('2026-05-22T10:00:00.000Z').toISOString(),
      },
      error: null,
    });

    setTableResult('lead_events', { data: {}, error: null });

    vi.mocked(getDecryptedSecrets).mockResolvedValue({
      evolutionBaseUrl: null,
      evolutionInstanceName: null,
      googleOauthRefresh: 'mock-refresh-token',
      evolutionApiKey: null,
      googleMapsApiKey: null,
      openaiApiKey: null,
      anthropicApiKey: null,
      googleAiApiKey: null,
      twilioAccountSid: null,
      twilioAuthToken: null,
    } as any);

    vi.mocked(listEvents).mockResolvedValue({
      ok: true,
      value: [], // No existing meetings
    });

    vi.mocked(createEvent).mockResolvedValue({
      ok: true,
      value: { id: 'google-evt-123' },
    });

    const result = await worker.process(mockJob);

    expect(result.success).toBe(true);
    expect(result.meeting_id).toBe('meeting-001');
    expect(result.google_event_id).toBe('google-evt-123');

    expect(listEvents).toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalled();
    expect(dbAdmin.from).toHaveBeenCalledWith('meetings');
    expect(dbAdmin.from).toHaveBeenCalledWith('leads');
  });

  it('should detect conflict and propose 2 alternatives', async () => {
    setTableResult('leads', {
      data: {
        id: 'lead-001',
        tenant_id: 'tenant-001',
        name: 'João Silva',
        email: 'joao@example.com',
      },
      error: null,
    });

    setTableResult('tenant_secrets', {
      data: {
        tenant_id: 'tenant-001',
        google_calendar_id: 'primary',
      },
      error: null,
    });

    vi.mocked(getDecryptedSecrets).mockResolvedValue({
      googleOauthRefresh: 'mock-refresh-token',
    } as any);

    // List event returns a conflicting meeting (10:00 to 10:30)
    vi.mocked(listEvents).mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'existing-evt-1',
          summary: 'Existing meeting',
          start: { dateTime: '2026-05-22T10:00:00.000Z' },
          end: { dateTime: '2026-05-22T10:30:00.000Z' },
        },
      ],
    });

    const result = await worker.process(mockJob);

    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.alternatives).toBeDefined();
    expect(result.alternatives).toHaveLength(2);
    // Verify alternatives are outside conflict window
    expect(new Date(result.alternatives![0] as string).getTime()).toBeGreaterThan(new Date('2026-05-22T10:30:00.000Z').getTime());
  });
});
