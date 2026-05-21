import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleMeetingWorker, ScheduleMeetingPayload } from './schedule-meeting.js';
import { prisma } from '../lib/prisma.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { listEvents, createEvent } from '../integrations/google-calendar.js';
import { Job } from 'bullmq';

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(1),
    lead: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    meeting: {
      create: vi.fn(),
    },
    leadEvent: {
      create: vi.fn(),
    },
    tenantSecret: {
      findUnique: vi.fn(),
    },
  },
}));

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
  getTenantQueueName: vi.fn((t, w) => `queue:${t}:${w}`),
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
  });

  it('should schedule meeting successfully when there are no conflicts', async () => {
    // Setup Mock Returns
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: 'lead-001',
      tenantId: 'tenant-001',
      name: 'João Silva',
      email: 'joao@example.com',
      whatsapp: '5511999999999',
    } as any);

    vi.mocked(prisma.tenantSecret.findUnique).mockResolvedValue({
      tenantId: 'tenant-001',
      googleCalendarId: 'primary',
    } as any);

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
    });

    vi.mocked(listEvents).mockResolvedValue({
      ok: true,
      value: [], // No existing meetings
    });

    vi.mocked(createEvent).mockResolvedValue({
      ok: true,
      value: { id: 'google-evt-123' },
    });

    vi.mocked(prisma.meeting.create).mockResolvedValue({
      id: 'meeting-001',
      tenantId: 'tenant-001',
      leadId: 'lead-001',
      googleEventId: 'google-evt-123',
      scheduledFor: new Date('2026-05-22T10:00:00.000Z'),
    } as any);

    const result = await worker.process(mockJob);

    expect(result.success).toBe(true);
    expect(result.meeting_id).toBe('meeting-001');
    expect(result.google_event_id).toBe('google-evt-123');

    expect(listEvents).toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalled();
    expect(prisma.meeting.create).toHaveBeenCalled();
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-001' },
      data: { status: 'MEETING_SCHEDULED' },
    });
  });

  it('should detect conflict and propose 2 alternatives', async () => {
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: 'lead-001',
      tenantId: 'tenant-001',
      name: 'João Silva',
      email: 'joao@example.com',
    } as any);

    vi.mocked(prisma.tenantSecret.findUnique).mockResolvedValue({
      tenantId: 'tenant-001',
      googleCalendarId: 'primary',
    } as any);

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
