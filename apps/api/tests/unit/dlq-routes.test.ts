/**
 * Testes do endpoint admin DLQ (AUD-P1-021).
 * Mocka lib/dlq.js para testar so o roteamento + validacao + erros HTTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';

vi.mock('../../src/lib/dlq.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/dlq.js')>(
    '../../src/lib/dlq.js',
  );
  return {
    ...actual,
    listDlqJobs: vi.fn(),
    replayDlqJob: vi.fn(),
    purgeDlqJob: vi.fn(),
  };
});

import { registerAdminDlqRoutes } from '../../src/routes/admin/dlq.js';
import {
  listDlqJobs,
  replayDlqJob,
  purgeDlqJob,
  DlqReplayNotAllowedError,
  DlqJobNotFoundError,
} from '../../src/lib/dlq.js';

describe('Admin DLQ routes', () => {
  let app: ReturnType<typeof fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = fastify();
    registerAdminDlqRoutes(app);
  });

  describe('GET /dlq', () => {
    it('retorna sumario + allowlist + runbook', async () => {
      const response = await app.inject({ method: 'GET', url: '/dlq' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.replayable_workers).toContain('health-check');
      expect(body.data.runbook).toBe('docs/auditoria/runbook-dlq-replay.md');
      expect(body.data.all_workers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ worker: 'health-check', replayable: true }),
          expect.objectContaining({ worker: 'process-inbound', replayable: false }),
        ]),
      );
    });
  });

  describe('GET /dlq/:worker', () => {
    it('lista jobs do worker', async () => {
      (listDlqJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          dlq_job_id: 'job-1',
          entry: { worker: 'health-check', source_job_id: 'src-1' },
          attempts_on_dlq: 0,
          replayable: true,
        },
      ]);

      const response = await app.inject({ method: 'GET', url: '/dlq/health-check' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.worker).toBe('health-check');
      expect(body.data.replayable).toBe(true);
      expect(body.data.count).toBe(1);
      expect(listDlqJobs).toHaveBeenCalledWith('health-check', { limit: 50, offset: 0, tenantId: undefined });
    });

    it('aplica filtros de query', async () => {
      (listDlqJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const response = await app.inject({
        method: 'GET',
        url: '/dlq/send-messages?limit=10&offset=20&tenant_id=11111111-1111-1111-1111-111111111111',
      });
      expect(response.statusCode).toBe(200);
      expect(listDlqJobs).toHaveBeenCalledWith('send-messages', {
        limit: 10,
        offset: 20,
        tenantId: '11111111-1111-1111-1111-111111111111',
      });
    });

    it('rejeita worker desconhecido com 404', async () => {
      const response = await app.inject({ method: 'GET', url: '/dlq/unknown-worker' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('rejeita query invalida com 422', async () => {
      const response = await app.inject({ method: 'GET', url: '/dlq/health-check?limit=-1' });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /dlq/:worker/:dlqJobId/replay', () => {
    it('replay sucesso para worker da allowlist', async () => {
      (replayDlqJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        worker: 'health-check',
        dlq_job_id: 'job-1',
        source_job_id: 'src-1',
        replayed_into: 'queue-global-health-check',
        new_job_id: 'dlq-replay-src-1-123',
        dry_run: false,
        approved_by: 'admin@guilds.com.br',
        reason: 'transient redis flap',
        replayed_at: '2026-05-23T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/dlq/health-check/job-1/replay',
        payload: { approved_by: 'admin@guilds.com.br', reason: 'transient redis flap' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.dry_run).toBe(false);
      expect(replayDlqJob).toHaveBeenCalledWith('health-check', 'job-1', {
        dryRun: false,
        approvedBy: 'admin@guilds.com.br',
        reason: 'transient redis flap',
      });
    });

    it('dry-run passa flag corretamente', async () => {
      (replayDlqJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        worker: 'health-check',
        dlq_job_id: 'job-1',
        source_job_id: 'src-1',
        replayed_into: 'queue-global-health-check',
        new_job_id: 'dry-run',
        dry_run: true,
        approved_by: 'admin@guilds.com.br',
        reason: 'pre-check',
        replayed_at: '2026-05-23T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/dlq/health-check/job-1/replay',
        payload: { dry_run: true, approved_by: 'admin@guilds.com.br', reason: 'pre-check' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.dry_run).toBe(true);
    });

    it('rejeita worker fora da allowlist com 403 + link ao runbook', async () => {
      (replayDlqJob as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DlqReplayNotAllowedError('process-inbound'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/dlq/process-inbound/job-1/replay',
        payload: { approved_by: 'admin@guilds.com.br', reason: 'forcing replay' },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.details.runbook).toBe('docs/auditoria/runbook-dlq-replay.md');
      expect(body.error.details.replayable_workers).toContain('health-check');
    });

    it('rejeita DLQ job inexistente com 404', async () => {
      (replayDlqJob as ReturnType<typeof vi.fn>).mockRejectedValue(
        new DlqJobNotFoundError('health-check', 'missing'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/dlq/health-check/missing/replay',
        payload: { approved_by: 'admin', reason: 'try' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('rejeita replay sem approved_by ou reason', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/dlq/health-check/job-1/replay',
        payload: { approved_by: '' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
      expect(replayDlqJob).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /dlq/:worker/:dlqJobId', () => {
    it('purge sucesso com aprovacao + motivo', async () => {
      (purgeDlqJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        purged_at: '2026-05-23T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/dlq/process-inbound/job-1',
        payload: {
          approved_by: 'admin@guilds.com.br',
          reason: 'job ja processado fora da plataforma',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.ok).toBe(true);
      expect(purgeDlqJob).toHaveBeenCalledWith(
        'process-inbound',
        'job-1',
        'admin@guilds.com.br',
        'job ja processado fora da plataforma',
      );
    });

    it('purge funciona mesmo para worker FORA da allowlist (apenas remove)', async () => {
      (purgeDlqJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        purged_at: '2026-05-23T10:00:00.000Z',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/dlq/billing-suspension/job-1',
        payload: { approved_by: 'admin', reason: 'manual fix' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejeita purge sem aprovacao', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/dlq/health-check/job-1',
        payload: {},
      });
      expect(response.statusCode).toBe(422);
      expect(purgeDlqJob).not.toHaveBeenCalled();
    });
  });
});
