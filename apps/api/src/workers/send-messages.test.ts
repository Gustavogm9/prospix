import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Job } from 'bullmq';
import { LeadStatus } from '@prisma/client';
import { SendMessagesPayload, SendMessagesWorker } from './send-messages.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { createEvolutionClient } from '../integrations/evolution.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { redactPhoneForLog } from './send-messages.js';

const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const createTenantQueueMock = vi.hoisted(() => vi.fn(() => ({ add: queueAddMock })));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    message: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    optout: {
      findFirst: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    tenantSecret: {
      findUnique: vi.fn(),
    },
    campaign: {
      updateMany: vi.fn(),
    },
    pendingOutbound: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    eval: vi.fn(),
  },
}));

vi.mock('../lib/queue.js', () => ({
  createTenantQueue: createTenantQueueMock,
}));

const mockSendText = vi.fn();
const mockGetConnectionState = vi.fn();

vi.mock('../integrations/evolution.js', () => ({
  createEvolutionClient: vi.fn(() => ({
    getConnectionState: mockGetConnectionState,
    sendText: mockSendText,
  })),
}));

vi.mock('../tenant/secrets-vault.js', () => ({
  getDecryptedSecrets: vi.fn(),
}));

describe('Send Messages Worker', () => {
  const worker = new SendMessagesWorker();

  const baseJob = {
    id: 'job-send-1',
    data: {
      tenant_id: 'tenant-001',
      trace_id: 'trace-001',
      conversation_id: 'conversation-001',
      message_id: 'message-001',
    } as SendMessagesPayload,
  } as unknown as Job<SendMessagesPayload>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 10, 0, 0));
    vi.clearAllMocks();

    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.incr).mockResolvedValue(1);
    vi.mocked(redis.expire).mockResolvedValue(1);
    vi.mocked(redis.eval).mockResolvedValue(1);

    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      id: 'message-001',
      tenantId: 'tenant-001',
      content: 'Mensagem de teste',
      conversation: {
        id: 'conversation-001',
        lead: {
          id: 'lead-001',
          whatsapp: '5511999999999',
          status: LeadStatus.OPTED_OUT,
        },
      },
    } as any);

    vi.mocked(prisma.message.update).mockResolvedValue({} as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: 'tenant-001',
      whatsappWarmupDay: 1,
    } as any);
    vi.mocked(prisma.tenantSecret.findUnique).mockResolvedValue({
      tenantId: 'tenant-001',
      evolutionInstanceName: 'instance-001',
      evolutionBaseUrl: 'https://evolution.example.test',
    } as any);
    vi.mocked(getDecryptedSecrets).mockResolvedValue({
      evolutionApiKey: 'secret-api-key',
    } as any);
    mockGetConnectionState.mockResolvedValue({ ok: true, value: { state: 'open' } });
    mockSendText.mockResolvedValue({ ok: true, value: { messageId: 'wa-message-001' } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks regular sends to opted-out leads', async () => {
    vi.mocked(prisma.optout.findFirst).mockResolvedValue({ id: 'optout-001' } as any);

    const result = await worker.process(baseJob);

    expect(result).toEqual({ sent: false, postponed: false, reason: 'lead_opted_out' });
    expect(mockSendText).not.toHaveBeenCalled();
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'message-001' },
      data: {
        deliveryStatus: 'FAILED',
        failedReason: 'lead_opted_out',
      },
    });
  });

  it('reschedules lock conflicts with deterministic retry job ids', async () => {
    vi.mocked(redis.set).mockResolvedValueOnce(null);

    const result = await worker.process(baseJob);

    expect(result).toEqual({ sent: false, postponed: true, reason: 'rescheduled_delay_3000_ms' });
    expect(createTenantQueueMock).toHaveBeenCalledWith('tenant-001', 'send-messages');
    expect(queueAddMock).toHaveBeenCalledWith(
      'send-whatsapp',
      baseJob.data,
      expect.objectContaining({
        delay: 3000,
        jobId: expect.stringMatching(/^send-whatsapp-tenant-001-message-001-retry-\d+$/),
      })
    );
    const options = queueAddMock.mock.calls[0]?.[2] as { jobId?: string } | undefined;
    expect(options?.jobId).not.toContain(':');
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it('redacts phone numbers for delivery logs', () => {
    expect(redactPhoneForLog('5511999999999')).toBe('***9999');
    expect(redactPhoneForLog('+55 (11) 98888-7777')).toBe('***7777');
    expect(redactPhoneForLog('1234')).toBe('***');
    expect(redactPhoneForLog(undefined)).toBe('[redacted]');
  });

  it('allows the explicit opt-out confirmation message after lead status is updated', async () => {
    vi.mocked(prisma.optout.findFirst).mockResolvedValue({ id: 'optout-001' } as any);

    const result = await worker.process({
      ...baseJob,
      data: {
        ...baseJob.data,
        force_send_optout_confirmation: true,
      },
    } as unknown as Job<SendMessagesPayload>);

    expect(result).toEqual({ sent: true, postponed: false });
    expect(createEvolutionClient).toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5511999999999',
        text: 'Mensagem de teste',
      })
    );

    const deliveryLog = mockLoggerInfo.mock.calls.find(([, message]) => message === '🚀 Delivering message via Evolution API');
    expect(deliveryLog?.[0]).toMatchObject({ recipient: '***9999' });
    expect(deliveryLog?.[0]).not.toHaveProperty('to');
    expect(JSON.stringify(deliveryLog?.[0])).not.toContain('5511999999999');
  });
});
