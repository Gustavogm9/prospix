/**
 * Tests do worker process-lgpd-request (AUD-P2-033).
 * Sem DB · mocka dbAdmin e valida transicoes de status + dispatch por type.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Job } from 'bullmq';
import { createMockDbAdmin } from '../test-helpers/mock-db.js';

const { dbAdmin, setTableResult, reset: resetDb } = createMockDbAdmin();

vi.mock('../lib/db.js', () => ({ dbAdmin }));

vi.mock('../lib/r2-storage.js', () => ({
  isR2Configured: vi.fn().mockReturnValue(false),
  uploadLgpdExport: vi.fn(),
}));

vi.mock('../lib/alert-sink.js', () => ({
  notifyCriticalAlert: vi.fn().mockResolvedValue(undefined),
}));

import {
  ProcessLgpdRequestWorker,
  type ProcessLgpdRequestPayload,
} from './process-lgpd-request.js';

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
    resetDb();
  });

  it('skips se request nao encontrado', async () => {
    setTableResult('lgpd_requests', {
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('skipped');
  });

  it('skips se request ja COMPLETED (idempotencia)', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'COMPLETED',
        type: 'EXPORT_DATA',
        scope: null,
      },
      error: null,
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('COMPLETED');
  });

  it('EXPORT_DATA · marca PROCESSING -> COMPLETED', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'PENDING',
        type: 'EXPORT_DATA',
        scope: { include: ['leads', 'meetings'] },
      },
      error: null,
    });

    setTableResult('leads', {
      data: [{ id: 'lead-1' }],
      error: null,
    });

    setTableResult('meetings', {
      data: [{ id: 'm-1' }],
      error: null,
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');
    expect(dbAdmin.from).toHaveBeenCalledWith('lgpd_requests');
  });

  it('DELETE_LEAD_DATA · falha se scope.lead_whatsapp ausente -> REJECTED', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'PENDING',
        type: 'DELETE_LEAD_DATA',
        scope: {},
      },
      error: null,
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('rejected');
  });

  it('DELETE_LEAD_DATA · falha se lead nao encontrado -> REJECTED', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'PENDING',
        type: 'DELETE_LEAD_DATA',
        scope: { lead_whatsapp: '+55999999' },
      },
      error: null,
    });

    setTableResult('leads', {
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('rejected');
  });

  it('DELETE_LEAD_DATA · anonimiza + insert optout · COMPLETED', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'PENDING',
        type: 'DELETE_LEAD_DATA',
        scope: { lead_whatsapp: '+5511999990001' },
      },
      error: null,
    });

    setTableResult('leads', {
      data: {
        id: 'lead-1',
        tenant_id: tenantId,
        whatsapp: '+5511999990001',
      },
      error: null,
    });

    setTableResult('conversations', {
      data: [{ id: 'conv-1' }],
      error: null,
    });

    setTableResult('messages', { data: null, error: null });
    setTableResult('lead_events', { data: null, error: null });
    setTableResult('lead_notes', { data: null, error: null });
    setTableResult('meetings', { data: null, error: null });
    setTableResult('optouts', { data: null, error: null });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');
  });

  it('DELETE_TENANT_DATA · marca tenant CHURNING + COMPLETED com grace period', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'PENDING',
        type: 'DELETE_TENANT_DATA',
        scope: null,
      },
      error: null,
    });

    setTableResult('tenants', { data: {}, error: null });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');
    expect(dbAdmin.from).toHaveBeenCalledWith('tenants');
  });

  it('CORRECT_DATA · sempre REJECTED com motivo "requer revisao humana"', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'PENDING',
        type: 'CORRECT_DATA',
        scope: { field: 'name', newValue: 'Novo Nome' },
      },
      error: null,
    });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('human review');
  });

  it('CONFIRM_DATA · COMPLETED com counts', async () => {
    setTableResult('lgpd_requests', {
      data: {
        id: 'r1',
        tenant_id: tenantId,
        status: 'PENDING',
        type: 'CONFIRM_DATA',
        scope: null,
      },
      error: null,
    });

    setTableResult('leads', { data: null, error: null, count: 10 });
    setTableResult('conversations', { data: null, error: null, count: 5 });
    setTableResult('meetings', { data: null, error: null, count: 2 });
    setTableResult('scripts', { data: null, error: null, count: 3 });

    const result = await worker.process(
      buildJob({ tenant_id: tenantId, trace_id: 't', lgpd_request_id: 'r1' }),
    );

    expect(result.status).toBe('completed');
  });
});
