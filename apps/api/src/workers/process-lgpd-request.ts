/**
 * Worker · process-lgpd-request (AUD-P2-033 -> Resolvido)
 *
 * Processa solicitacoes LGPD (`LgpdRequest`) criadas via UX em PrivacyTab:
 *  - EXPORT_DATA       · gera JSON com leads/conversations/meetings/scripts do tenant
 *  - DELETE_LEAD_DATA  · anonimiza lead + apaga mensagens/eventos + insert em optouts
 *  - DELETE_TENANT_DATA · marca tenant como CHURNING (grace 7d antes de delete)
 *  - CORRECT_DATA      · marca REJECTED (requer revisao humana · operador Guilds)
 *  - CONFIRM_DATA      · marca COMPLETED com flag de confirmacao
 *
 * Fluxo:
 *  1. POST /v1/tenant/lgpd/requests cria registro PENDING + enfileira job
 *  2. Este worker assume · marca PROCESSING · executa · marca COMPLETED/REJECTED
 *
 * Idempotencia: jobId determinado por `lgpd-request-${id}`. Re-execucao apos
 * COMPLETED/REJECTED/CANCELED retorna sem efeito (no-op).
 *
 * NOTA: Implementacao "MVP funcional" · uploads para R2 ficam em iteracao futura
 * (export por enquanto retorna JSON inline em scope.export_data; quando R2 vier,
 * basta substituir o assemble por upload + presigned URL).
 */
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { isR2Configured, uploadLgpdExport } from '../lib/r2-storage.js';
import { notifyCriticalAlert } from '../lib/alert-sink.js';
import { LgpdRequestType, LgpdRequestStatus, TenantStatus, LeadStatus, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { BaseJobPayload } from '@prospix/shared-types';

export interface ProcessLgpdRequestPayload extends BaseJobPayload {
  lgpd_request_id: string;
}

export interface ProcessLgpdRequestResult {
  status: 'completed' | 'rejected' | 'skipped';
  request_id: string;
  reason?: string;
}

export class ProcessLgpdRequestWorker extends BaseWorker<
  ProcessLgpdRequestPayload,
  ProcessLgpdRequestResult
> {
  override name = 'process-lgpd-request';
  override concurrency = 1; // serial por seguranca de dados

  override async process(job: Job<ProcessLgpdRequestPayload>): Promise<ProcessLgpdRequestResult> {
    const { lgpd_request_id, tenant_id } = job.data;

    const request = await prisma.lgpdRequest.findFirst({
      where: { id: lgpd_request_id, tenantId: tenant_id },
    });

    if (!request) {
      logger.warn(
        { tenant_id, lgpd_request_id },
        'lgpd-worker: request nao encontrado · skipping',
      );
      return { status: 'skipped', request_id: lgpd_request_id, reason: 'request not found' };
    }

    if (request.status !== LgpdRequestStatus.PENDING) {
      logger.info(
        { tenant_id, lgpd_request_id, current_status: request.status },
        'lgpd-worker: request nao esta PENDING · skipping (idempotencia)',
      );
      return {
        status: 'skipped',
        request_id: lgpd_request_id,
        reason: `status was ${request.status}`,
      };
    }

    // Marca PROCESSING
    await prisma.lgpdRequest.update({
      where: { id: lgpd_request_id },
      data: { status: LgpdRequestStatus.PROCESSING },
    });

    logger.info(
      { tenant_id, lgpd_request_id, type: request.type },
      'lgpd-worker: processing started',
    );

    try {
      switch (request.type) {
        case LgpdRequestType.EXPORT_DATA:
          return await this.handleExportData(request);
        case LgpdRequestType.DELETE_LEAD_DATA:
          return await this.handleDeleteLeadData(request);
        case LgpdRequestType.DELETE_TENANT_DATA:
          return await this.handleDeleteTenantData(request);
        case LgpdRequestType.CORRECT_DATA:
          return await this.handleCorrectData(request);
        case LgpdRequestType.CONFIRM_DATA:
          return await this.handleConfirmData(request);
        default:
          throw new Error(`Unsupported LGPD type: ${String(request.type)}`);
      }
    } catch (err) {
      logger.error(
        {
          tenant_id,
          lgpd_request_id,
          type: request.type,
          err: err instanceof Error ? { message: err.message, type: err.name } : err,
        },
        'lgpd-worker: processing failed',
      );

      // Marca REJECTED com motivo · operador humano pode reprocessar manualmente
      await prisma.lgpdRequest.update({
        where: { id: lgpd_request_id },
        data: {
          status: LgpdRequestStatus.REJECTED,
          rejectionReason: err instanceof Error ? err.message : 'Unknown processing error',
          processedAt: new Date(),
        },
      });

      return {
        status: 'rejected',
        request_id: lgpd_request_id,
        reason: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }

  // ── EXPORT_DATA ───────────────────────────────────────────────────────────
  private async handleExportData(
    request: { id: string; tenantId: string; scope: Prisma.JsonValue | null },
  ): Promise<ProcessLgpdRequestResult> {
    const scope = (request.scope as { include?: string[] } | null) ?? {};
    const include = scope.include ?? ['leads', 'conversations', 'meetings', 'scripts'];

    // Collect data sob tenant_id context (RLS aplicado via _base-worker)
    const exportPayload: Record<string, unknown> = { exported_at: new Date().toISOString() };

    if (include.includes('leads')) {
      exportPayload.leads = await prisma.lead.findMany({
        select: {
          id: true,
          name: true,
          whatsapp: true,
          profession: true,
          email: true,
          status: true,
          fitScore: true,
          createdAt: true,
        },
        take: 50000,
      });
    }

    if (include.includes('conversations')) {
      const conversations = await prisma.conversation.findMany({
        select: {
          id: true,
          leadId: true,
          status: true,
          startedAt: true,
          messageCount: true,
        },
        take: 50000,
      });
      exportPayload.conversations = conversations;
    }

    if (include.includes('meetings')) {
      exportPayload.meetings = await prisma.meeting.findMany({
        select: {
          id: true,
          leadId: true,
          scheduledFor: true,
          status: true,
          outcome: true,
          createdAt: true,
        },
        take: 5000,
      });
    }

    if (include.includes('scripts')) {
      exportPayload.scripts = await prisma.script.findMany({
        select: {
          id: true,
          name: true,
          category: true,
          status: true,
          createdAt: true,
        },
        take: 1000,
      });
    }

    const existingScope =
      request.scope && typeof request.scope === 'object' && !Array.isArray(request.scope)
        ? (request.scope as Record<string, unknown>)
        : {};

    // Se R2 configurado, faz upload + gera presigned URL com TTL 7d.
    // Caso contrario (dev/test sem R2 creds), mantem JSON inline (MVP fallback).
    //
    // ┌─────────────────────────────────────────────────────────────────────┐
    // │ ⚠️  LGPD INLINE STORAGE LIMITATION (M-9)                          │
    // │                                                                     │
    // │ When R2 (Cloudflare) is NOT configured (R2_ACCOUNT_ID,             │
    // │ R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY unset), the full LGPD       │
    // │ export payload — including PII (names, phone numbers, emails,      │
    // │ professions, etc.) — is stored INLINE in the `lgpd_requests`       │
    // │ table's `scope` JSON column (`scope.export_data`).                 │
    // │                                                                     │
    // │ This means:                                                         │
    // │  • PII persists in the database beyond the download TTL window.    │
    // │  • Database backups will contain exported PII snapshots.           │
    // │  • There is no automatic expiration/cleanup of inline data.        │
    // │                                                                     │
    // │ For production deployments, R2 MUST be configured so that          │
    // │ exports are uploaded to object storage with presigned URLs          │
    // │ and a 7-day TTL, avoiding PII persistence in the DB.              │
    // └─────────────────────────────────────────────────────────────────────┘
    let downloadUrl: string | null = null;
    let downloadExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    let exportMethod = 'inline-json-fallback';
    let r2Key: string | undefined;

    if (isR2Configured()) {
      try {
        const upload = await uploadLgpdExport({
          tenantId: request.tenantId,
          requestId: request.id,
          payload: exportPayload,
        });
        downloadUrl = upload.presignedUrl;
        downloadExpiresAt = upload.expiresAt;
        r2Key = upload.key;
        exportMethod = 'r2-presigned-url';
      } catch (uploadErr) {
        logger.error(
          {
            tenant_id: request.tenantId,
            lgpd_request_id: request.id,
            err: uploadErr instanceof Error ? { message: uploadErr.message } : uploadErr,
          },
          'lgpd-worker: R2 upload failed · falling back to inline JSON',
        );
        // Continua com fallback inline · nao quebra o request
      }
    }

    const updatedScope: Record<string, unknown> = {
      ...existingScope,
      export_method: exportMethod,
    };

    if (r2Key) {
      updatedScope.export_r2_key = r2Key;
    } else {
      // Fallback · inline payload
      updatedScope.export_data = exportPayload;
    }

    await prisma.lgpdRequest.update({
      where: { id: request.id },
      data: {
        status: LgpdRequestStatus.COMPLETED,
        processedAt: new Date(),
        downloadUrl,
        downloadExpiresAt,
        scope: updatedScope as Prisma.InputJsonValue,
      },
    });

    logger.info(
      {
        tenant_id: request.tenantId,
        lgpd_request_id: request.id,
        leads_count: Array.isArray(exportPayload.leads) ? exportPayload.leads.length : 0,
        conversations_count: Array.isArray(exportPayload.conversations)
          ? exportPayload.conversations.length
          : 0,
      },
      'lgpd-worker: EXPORT_DATA completed',
    );

    return { status: 'completed', request_id: request.id };
  }

  // ── DELETE_LEAD_DATA ──────────────────────────────────────────────────────
  private async handleDeleteLeadData(
    request: { id: string; tenantId: string; scope: Prisma.JsonValue | null },
  ): Promise<ProcessLgpdRequestResult> {
    const scope = (request.scope as { lead_whatsapp?: string } | null) ?? {};
    const leadWhatsapp = scope.lead_whatsapp;

    if (!leadWhatsapp) {
      throw new Error('scope.lead_whatsapp obrigatorio para DELETE_LEAD_DATA');
    }

    const lead = await prisma.lead.findFirst({
      where: { tenantId: request.tenantId, whatsapp: leadWhatsapp },
    });

    if (!lead) {
      throw new Error(`Lead com whatsapp ${leadWhatsapp} nao encontrado neste tenant`);
    }

    // Transacao · anonimiza + delete mensagens/eventos + insert optout
    await prisma.$transaction(async (tx) => {
      // Apaga mensagens (Conversations remain como soft-history mas sem mensagens)
      await tx.message.deleteMany({
        where: { conversation: { leadId: lead.id } },
      });

      // Apaga lead_events
      await tx.leadEvent.deleteMany({ where: { leadId: lead.id } });

      // Apaga notas
      await tx.leadNote.deleteMany({ where: { leadId: lead.id } });

      // Apaga conversations (cascade pra messages ja foi)
      await tx.conversation.deleteMany({ where: { leadId: lead.id } });

      // Apaga meetings
      await tx.meeting.deleteMany({ where: { leadId: lead.id } });

      // Anonimiza lead row (mantem ID + status pra audit, mas zera PII)
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          name: '[REDACTED · LGPD]',
          email: null,
          metadata: Prisma.JsonNull,
          status: LeadStatus.ARCHIVED,
          deletedAt: new Date(),
        },
      });

      // Insert em optouts pra evitar re-abordagem
      await tx.optout.upsert({
        where: { tenantId_whatsapp: { tenantId: request.tenantId, whatsapp: leadWhatsapp } },
        update: { reason: 'LGPD-delete-request', source: 'lgpd_request' },
        create: {
          tenantId: request.tenantId,
          whatsapp: leadWhatsapp,
          reason: 'LGPD-delete-request',
          source: 'lgpd_request',
        },
      });
    });

    await prisma.lgpdRequest.update({
      where: { id: request.id },
      data: { status: LgpdRequestStatus.COMPLETED, processedAt: new Date() },
    });

    logger.info(
      { tenant_id: request.tenantId, lgpd_request_id: request.id, lead_id: lead.id },
      'lgpd-worker: DELETE_LEAD_DATA completed',
    );

    return { status: 'completed', request_id: request.id };
  }

  // ── DELETE_TENANT_DATA ────────────────────────────────────────────────────
  private async handleDeleteTenantData(request: {
    id: string;
    tenantId: string;
  }): Promise<ProcessLgpdRequestResult> {
    // MVP · marca tenant como CHURNING e enfileira deletion definitiva
    // apos grace period (PRD G.3 · 7 dias)
    await prisma.tenant.update({
      where: { id: request.tenantId },
      data: { status: TenantStatus.CHURNING },
    });

    const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.lgpdRequest.update({
      where: { id: request.id },
      data: {
        status: LgpdRequestStatus.COMPLETED,
        processedAt: new Date(),
        scope: {
          tenant_marked_churning: true,
          grace_period_until: graceUntil.toISOString(),
          deletion_after_grace: 'manual · operador Guilds aprova apos 7d',
        } as Prisma.InputJsonValue,
      },
    });

    logger.warn(
      {
        tenant_id: request.tenantId,
        lgpd_request_id: request.id,
        grace_until: graceUntil.toISOString(),
        alert: true,
        severity: 'critical',
        action_required: 'manual-tenant-deletion-after-grace',
      },
      'lgpd-worker: DELETE_TENANT_DATA · tenant marked CHURNING (7d grace)',
    );

    // Pluga Sentry/Slack quando configurado
    await notifyCriticalAlert(
      {
        event_name: 'lgpd:tenant-churning',
        severity: 'critical',
        action_required: 'manual-tenant-deletion-after-grace',
        tenant_id: request.tenantId,
        lgpd_request_id: request.id,
        grace_until: graceUntil.toISOString(),
      },
      `Tenant ${request.tenantId} solicitou exclusao LGPD · CHURNING por 7d`,
    );

    return { status: 'completed', request_id: request.id };
  }

  // ── CORRECT_DATA ──────────────────────────────────────────────────────────
  private async handleCorrectData(request: {
    id: string;
    tenantId: string;
  }): Promise<ProcessLgpdRequestResult> {
    // Requer revisao humana · auto-corret nao e seguro sem contexto
    await prisma.lgpdRequest.update({
      where: { id: request.id },
      data: {
        status: LgpdRequestStatus.REJECTED,
        processedAt: new Date(),
        rejectionReason:
          'Correcao de dados requer revisao humana. Time Guilds entrara em contato em ate 15 dias uteis.',
      },
    });

    logger.info(
      { tenant_id: request.tenantId, lgpd_request_id: request.id },
      'lgpd-worker: CORRECT_DATA escalated to human (rejected with reason)',
    );

    return { status: 'rejected', request_id: request.id, reason: 'requires human review' };
  }

  // ── CONFIRM_DATA ──────────────────────────────────────────────────────────
  private async handleConfirmData(request: {
    id: string;
    tenantId: string;
  }): Promise<ProcessLgpdRequestResult> {
    const counts = await prisma.$transaction([
      prisma.lead.count(),
      prisma.conversation.count(),
      prisma.meeting.count(),
      prisma.script.count(),
    ]);

    await prisma.lgpdRequest.update({
      where: { id: request.id },
      data: {
        status: LgpdRequestStatus.COMPLETED,
        processedAt: new Date(),
        scope: {
          confirmation: 'Dados existem no Prospix',
          tenant_id: request.tenantId,
          counts: {
            leads: counts[0],
            conversations: counts[1],
            meetings: counts[2],
            scripts: counts[3],
          },
          confirmed_at: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return { status: 'completed', request_id: request.id };
  }
}
