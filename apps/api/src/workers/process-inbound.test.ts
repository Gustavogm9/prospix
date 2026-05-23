import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job } from 'bullmq';
import { ProcessInboundPayload, ProcessInboundWorker } from './process-inbound.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { classifyIntent } from '../ai/classifier.js';

const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    optout: {
      upsert: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    script: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    leadEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

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
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.eval).mockResolvedValue(1);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.lead.findUnique).mockResolvedValue({
      id: 'lead-001',
      tenantId: 'tenant-001',
      status: 'CAPTURED',
      whatsapp: '5511999999999',
    } as any);
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: 'conversation-001',
      tenantId: 'tenant-001',
      aiHandling: false,
      messages: [],
    } as any);
    vi.mocked(classifyIntent).mockResolvedValue({
      intent: 'asking_callback',
      confidence: 0.8,
    } as any);
  });

  it('skips duplicate inbound messages before calling the classifier', async () => {
    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      id: 'message-existing',
      tenantId: 'tenant-001',
      conversationId: 'conversation-001',
    } as any);

    const result = await worker.process(baseJob);

    expect(result).toEqual({ success: true, replied: false, escalated: false, optout: false });
    expect(prisma.lead.findUnique).not.toHaveBeenCalled();
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalled();
  });

  it('continues processing retries that already persisted the inbound message', async () => {
    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      id: 'message-existing',
      tenantId: 'tenant-001',
      conversationId: 'conversation-001',
    } as any);

    const result = await worker.process({
      ...baseJob,
      attemptsMade: 1,
    } as unknown as Job<ProcessInboundPayload>);

    expect(result).toEqual({ success: true, replied: false, escalated: false, optout: false });
    expect(prisma.lead.findUnique).toHaveBeenCalled();
    expect(classifyIntent).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('persists inbound message and conversation counters atomically for new messages', async () => {
    vi.mocked(prisma.message.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.message.create).mockResolvedValue({ id: 'message-new' } as any);
    vi.mocked(prisma.conversation.update).mockResolvedValue({} as any);

    const result = await worker.process(baseJob);

    expect(result).toEqual({ success: true, replied: false, escalated: false, optout: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        whatsappMessageId: 'wa-inbound-001',
        intentDetected: 'asking_callback',
      }),
    }));
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conversation-001' },
      data: expect.objectContaining({
        messageCount: { increment: 1 },
      }),
    }));
  });

  it('treats a concurrent unique violation as a duplicate without applying side effects', async () => {
    vi.mocked(prisma.message.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'message-existing',
        tenantId: 'tenant-001',
        conversationId: 'conversation-001',
      } as any);
    vi.mocked(prisma.message.create).mockRejectedValue({
      code: 'P2002',
      meta: { target: ['whatsappMessageId'] },
    });

    const result = await worker.process(baseJob);

    expect(result).toEqual({ success: true, replied: false, escalated: false, optout: false });
    expect(classifyIntent).toHaveBeenCalledTimes(1);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalled();
  });

  it('rejects duplicate whatsapp message ids that belong to another conversation', async () => {
    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      id: 'message-existing',
      tenantId: 'tenant-001',
      conversationId: 'other-conversation',
    } as any);

    await expect(worker.process(baseJob)).rejects.toThrow(
      'WhatsApp message wa-inbound-001 already belongs to another tenant or conversation'
    );
    expect(prisma.lead.findUnique).not.toHaveBeenCalled();
    expect(classifyIntent).not.toHaveBeenCalled();
  });
});
