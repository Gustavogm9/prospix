import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyDigestWorker } from './daily-digest.js';
import { prisma } from '../lib/prisma.js';
import { Job } from 'bullmq';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    tenant: {
      findMany: vi.fn(),
    },
    meeting: {
      findMany: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

const mockSendText = vi.fn().mockResolvedValue({ ok: true, value: { messageId: 'msg-123' } });

vi.mock('../integrations/evolution.js', () => ({
  createEvolutionClient: vi.fn(() => ({
    sendText: mockSendText,
  })),
}));

describe('Daily Digest Worker', () => {
  const worker = new DailyDigestWorker();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should compile operational digest and send to owner successfully', async () => {
    vi.mocked(prisma.tenant.findMany).mockResolvedValue([
      {
        id: 'tenant-123',
        name: 'Giovane Seguros',
        status: 'ACTIVE',
      },
    ] as any);

    vi.mocked(prisma.meeting.findMany).mockResolvedValue([
      {
        id: 'meet-1',
        scheduledFor: new Date(),
        location: 'Zoom',
        lead: { name: 'João Silva' },
      },
    ] as any);

    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Amanda Santos',
        fitScore: 9.0,
      },
    ] as any);

    vi.mocked(prisma.lead.count).mockResolvedValue(4);

    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'owner-abc',
      whatsapp: '5511999999999',
      role: 'OWNER',
    } as any);

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
    expect(prisma.tenant.findMany).toHaveBeenCalledWith({
      where: { id: 'tenant-123', status: 'ACTIVE', deletedAt: null },
    });

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5511999999999',
        text: expect.stringContaining('PROSPIX DIGEST MATINAL'),
      })
    );
  });
});
