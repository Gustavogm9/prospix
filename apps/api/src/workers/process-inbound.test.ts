import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job } from 'bullmq';
import { ProcessInboundPayload, ProcessInboundWorker } from './process-inbound.js';
import { redis } from '../lib/redis.js';
import { classifyIntent } from '../ai/classifier.js';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    eval: vi.fn(),
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../lib/realtime.js', () => ({
  publishRealtimeEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ai/classifier.js', () => ({
  classifyIntent: vi.fn(),
}));

vi.mock('../ai/script-engine.js', () => ({
  executeScriptStep: vi.fn(),
}));

vi.mock('../ai/prompt-builder.js', () => ({
  buildSystemPrompt: vi.fn(),
}));

vi.mock('../ai/guardrails.js', () => ({
  callAIWithGuardrails: vi.fn(),
}));

vi.mock('../lib/queue.js', () => ({
  createTenantQueue: vi.fn(() => ({ add: queueAddMock })),
}));

describe('ProcessInboundWorker idempotency', () => {
  const worker = new ProcessInboundWorker();
  const baseJob = {
    id: 'job-process-1',
    data: {
      tenant_id: 'tenant-001',
      trace_id: 'trace-001',
      conversation_id: 'conversation-001',
      lead_id: 'lead-001',
      message_content: 'Oi',
      message_direction: 'INBOUND',
      whatsapp_message_id: 'wa-inbound-001',
    } satisfies ProcessInboundPayload,
  } as unknown as Job<ProcessInboundPayload>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.eval).mockResolvedValue(1);

    setTableResult('leads', {
      data: {
        id: 'lead-001',
        tenant_id: 'tenant-001',
        status: 'CAPTURED',
        whatsapp: '5511999999999',
      },
      error: null,
    });

    setTableResult('conversations', {
      data: {
        id: 'conversation-001',
        tenant_id: 'tenant-001',
        ai_handling: false,
        messages: [],
        message_count: 0,
      },
      error: null,
    });

    vi.mocked(classifyIntent).mockResolvedValue({
      intent: 'asking_callback',
      confidence: 0.8,
    } as any);
  });

  it('skips duplicate inbound messages before calling the classifier', async () => {
    setTableResult('messages', {
      data: {
        id: 'message-existing',
        tenant_id: 'tenant-001',
        conversation_id: 'conversation-001',
      },
      error: null,
    });

    const result = await worker.process(baseJob);

    expect(result).toEqual({ success: true, replied: false, escalated: false, optout: false });
    // Lead shouldn't be fetched since we returned early on duplicate
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalled();
  });

  it('continues processing retries that already persisted the inbound message', async () => {
    setTableResult('messages', {
      data: {
        id: 'message-existing',
        tenant_id: 'tenant-001',
        conversation_id: 'conversation-001',
      },
      error: null,
    });

    const result = await worker.process({
      ...baseJob,
      attemptsMade: 1,
    } as unknown as Job<ProcessInboundPayload>);

    expect(result).toEqual({ success: true, replied: false, escalated: false, optout: false });
    expect(classifyIntent).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate whatsapp message ids that belong to another conversation', async () => {
    setTableResult('messages', {
      data: {
        id: 'message-existing',
        tenant_id: 'tenant-001',
        conversation_id: 'other-conversation',
      },
      error: null,
    });

    await expect(worker.process(baseJob)).rejects.toThrow(
      'WhatsApp message wa-inbound-001 already belongs to another tenant or conversation'
    );
    expect(classifyIntent).not.toHaveBeenCalled();
  });
});
