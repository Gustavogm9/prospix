/**
 * Tests do worker process-lgpd-request (AUD-P2-033).
 * Sem DB · mocka Prisma e valida transicoes de status + dispatch por type.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job } from 'bullmq';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    lgpdRequest: { findFirst: vi.fn(), update: vi.fn() },
    lead: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    conversation: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    meeting: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    message: { deleteMany: vi.fn() },
    leadEvent: { deleteMany: vi.fn() },
    leadNote: { deleteMany: vi.fn() },
    script: { findMany: vi.fn(), count: vi.fn() },
    tenant: { update: vi.fn() },
    optout: { upsert: vi.fn() },
    $transaction: vi.fn(async (calls: unknown) => {
      if (typeof calls === 'function') {
        return (calls as (tx: unknown) => Promise<unknown>)({
          message: { deleteMany: vi.fn() },
          leadEvent: { deleteMany: vi.fn() },
          leadNote: { deleteMany: vi.fn() },
          conversation: { deleteMany: vi.fn() },
          meeting: { deleteMany: vi.fn() },
          lead: { update: vi.fn() },
          optout: { upsert: vi.fn() },
        });
      }
      // count batch
      return [10, 5, 2, 3];
    }),
  },
}));

import { prisma } from '../lib/prisma.js';
import {
  ProcessLgpdRequestWorker,
  type ProcessLgpdRequestPayload,
} from './process-lgpd-request.js';

const mockedPrisma = prisma as unknown as {
  lgpdRequest: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  lead: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  conversation: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  meeting: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  script: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  tenant: { update: ReturnType<typeof vi.fn> };
};

function buildJob(payload: ProcessLgpdRequestPayload): Job<ProcessLgpdRequestPayload> {
  return {
    id: `job-${Date.now()}`,
    data: payload,
  } as unknown as Job<ProcessLgpdRequestPayload>;
}

describe('ProcessLgpdRequestWorker', () => {
  const worker = new ProcessLgpdRequestWorker();
  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips se request nao encontrado', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue(null);

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('skipped');
    expect(mockedPrisma.lgpdRequest.update).not.toHaveBeenCalled();
  });

  it('skips se request ja COMPLETED (idempotencia)', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'COMPLETED',
      type: 'EXPORT_DATA',
      scope: null,
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('COMPLETED');
  });

  it('EXPORT_DATA · marca PROCESSING -> COMPLETED + popula export_data no scope', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'PENDING',
      type: 'EXPORT_DATA',
      scope: { include: ['leads', 'meetings'] },
    });
    mockedPrisma.lead.findMany.mockResolvedValue([{ id: 'lead-1' }]);
    mockedPrisma.meeting.findMany.mockResolvedValue([{ id: 'm-1' }]);

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');

    // PROCESSING transition
    expect(mockedPrisma.lgpdRequest.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'r1' },
      data: { status: 'PROCESSING' },
    });

    // COMPLETED transition + scope com export_data
    const completedCall = mockedPrisma.lgpdRequest.update.mock.calls[1]![0];
    expect(completedCall.data.status).toBe('COMPLETED');
    expect(completedCall.data.downloadExpiresAt).toBeInstanceOf(Date);
    expect(completedCall.data.scope.export_data).toBeDefined();
    expect(completedCall.data.scope.export_data.leads).toHaveLength(1);
  });

  it('DELETE_LEAD_DATA · falha se scope.lead_whatsapp ausente -> REJECTED', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'PENDING',
      type: 'DELETE_LEAD_DATA',
      scope: {},
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('rejected');
    const rejectedCall = mockedPrisma.lgpdRequest.update.mock.calls.find(
      (c) => c[0].data.status === 'REJECTED',
    );
    expect(rejectedCall).toBeDefined();
    expect(rejectedCall![0].data.rejectionReason).toContain('lead_whatsapp');
  });

  it('DELETE_LEAD_DATA · falha se lead nao encontrado -> REJECTED', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'PENDING',
      type: 'DELETE_LEAD_DATA',
      scope: { lead_whatsapp: '+55999999' },
    });
    mockedPrisma.lead.findFirst.mockResolvedValue(null);

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('rejected');
  });

  it('DELETE_LEAD_DATA · anonimiza + insert optout · COMPLETED', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'PENDING',
      type: 'DELETE_LEAD_DATA',
      scope: { lead_whatsapp: '+5511999990001' },
    });
    mockedPrisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      tenantId,
      whatsapp: '+5511999990001',
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');
    const completedCall = mockedPrisma.lgpdRequest.update.mock.calls.find(
      (c) => c[0].data.status === 'COMPLETED',
    );
    expect(completedCall).toBeDefined();
  });

  it('DELETE_TENANT_DATA · marca tenant CHURNING + COMPLETED com grace period', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'PENDING',
      type: 'DELETE_TENANT_DATA',
      scope: null,
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');
    expect(mockedPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: { status: 'CHURNING' },
    });
    const completedCall = mockedPrisma.lgpdRequest.update.mock.calls.find(
      (c) => c[0].data.status === 'COMPLETED',
    );
    expect(completedCall![0].data.scope.tenant_marked_churning).toBe(true);
    expect(completedCall![0].data.scope.grace_period_until).toBeDefined();
  });

  it('CORRECT_DATA · sempre REJECTED com motivo "requer revisao humana"', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'PENDING',
      type: 'CORRECT_DATA',
      scope: { field: 'name', newValue: 'Novo Nome' },
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('rejected');
    const rejectedCall = mockedPrisma.lgpdRequest.update.mock.calls.find(
      (c) => c[0].data.status === 'REJECTED',
    );
    expect(rejectedCall![0].data.rejectionReason).toContain('revisao humana');
  });

  it('CONFIRM_DATA · COMPLETED com counts de leads/conversations/meetings/scripts', async () => {
    mockedPrisma.lgpdRequest.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId,
      status: 'PENDING',
      type: 'CONFIRM_DATA',
      scope: null,
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');
    const completedCall = mockedPrisma.lgpdRequest.update.mock.calls.find(
      (c) => c[0].data.status === 'COMPLETED',
    );
    expect(completedCall![0].data.scope.counts).toEqual({
      leads: 10,
      conversations: 5,
      meetings: 2,
      scripts: 3,
    });
  });
});
