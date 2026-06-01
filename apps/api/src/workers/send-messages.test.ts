import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Job } from 'bullmq';
import { LeadStatus } from '@prospix/shared-types';
import { SendMessagesPayload, SendMessagesWorker } from './send-messages.js';
import { redis } from '../lib/redis.js';
import { createEvolutionClient } from '../integrations/evolution.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { redactPhoneForLog } from './send-messages.js';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

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

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

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

vi.mock('./send-whatsapp-job.js', () => ({
  createRescheduledSendWhatsappJobId: vi.fn(
    (tenantId: string, messageId: string, runAtMs: number) =>
      `send-whatsapp-${tenantId}-${messageId}-retry-${runAtMs}`
  ),
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
    resetDb();

    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.incr).mockResolvedValue(1);
    vi.mocked(redis.expire).mockResolvedValue(1);
    vi.mocked(redis.eval).mockResolvedValue(1);

    setTableResult('messages', {
      data: {
        id: 'message-001',
        tenant_id: 'tenant-001',
        content: 'Mensagem de teste',
        conversations: {
          id: 'conversation-001',
          leads: {
            id: 'lead-001',
            whatsapp: '5511999999999',
            status: LeadStatus.OPTED_OUT,
          },
        },
      },
      error: null,
    });

    setTableResult('tenants', {
      data: {
        id: 'tenant-001',
        whatsapp_warmup_day: 1,
      },
      error: null,
    });

    setTableResult('tenant_secrets', {
      data: {
        tenant_id: 'tenant-001',
        evolution_instance_name: 'instance-001',
        evolution_base_url: 'https://evolution.example.test',
      },
      error: null,
    });

    setTableResult('campaigns', { data: {}, error: null });
    setTableResult('pending_outbound', { data: {}, error: null });

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
    setTableResult('optouts', {
      data: { id: 'optout-001' },
      error: null,
    });

    const result = await worker.process(baseJob);

    expect(result).toEqual({ sent: false, postponed: false, reason: 'lead_opted_out' });
    expect(mockSendText).not.toHaveBeenCalled();
    expect(dbAdmin.from).toHaveBeenCalledWith('messages');
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
  });

  it('redacts phone numbers for delivery logs', () => {
    expect(redactPhoneForLog('5511999999999')).toBe('***9999');
    expect(redactPhoneForLog('+55 (11) 98888-7777')).toBe('***7777');
    expect(redactPhoneForLog('1234')).toBe('***');
    expect(redactPhoneForLog(undefined)).toBe('[redacted]');
  });

  it('allows the explicit opt-out confirmation message after lead status is updated', async () => {
    setTableResult('optouts', {
      data: { id: 'optout-001' },
      error: null,
    });

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
  });
});
