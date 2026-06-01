/**
 * Worker — process-lgpd-request (AUD-P2-033 -> Resolvido)
 *
 * Processa solicitacoes LGPD (`LgpdRequest`) criadas via UX em PrivacyTab:
 *  - EXPORT_DATA       — gera JSON com leads/conversations/meetings/scripts do tenant
 *  - DELETE_LEAD_DATA  — anonimiza lead + apaga mensagens/eventos + insert em optouts
 *  - DELETE_TENANT_DATA — marca tenant como CHURNING (grace 7d antes de delete)
 *  - CORRECT_DATA      — marca REJECTED (requer revisao humana — operador Guilds)
 *  - CONFIRM_DATA      — marca COMPLETED com flag de confirmacao
 *
 * Fluxo:
 *  1. POST /v1/tenant/lgpd/requests cria registro PENDING + enfileira job
 *  2. Este worker assume — marca PROCESSING — executa — marca COMPLETED/REJECTED
 *
 * Idempotencia: jobId determinado por `lgpd-request-${id}`. Re-execucao apos
 * COMPLETED/REJECTED/CANCELED retorna sem efeito (no-op).
 *
 * NOTA: Implementacao "MVP funcional" — uploads para R2 ficam em iteracao futura
 * (export por enquanto retorna JSON inline em scope.export_data; quando R2 vier,
 * basta substituir o assemble por upload + presigned URL).
 */
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { isR2Configured, uploadLgpdExport } from '../lib/r2-storage.js';
import { notifyCriticalAlert } from '../lib/alert-sink.js';
import { LgpdRequestType, LgpdRequestStatus, TenantStatus, LeadStatus } from '@prospix/shared-types';
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

    const { data: request, error: reqErr } = await dbAdmin
      .from('lgpd_requests')
      .select('*')
      .eq('id', lgpd_request_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (reqErr || !request) {
      logger.warn(
        { tenant_id, lgpd_request_id },
        'lgpd-worker: request nao encontrado — skipping',
      );
      return { status: 'skipped', request_id: lgpd_request_id, reason: 'request not found' };
    }

    if (request.status !== LgpdRequestStatus.PENDING) {
      logger.info(
        { tenant_id, lgpd_request_id, current_status: request.status },
        'lgpd-worker: request nao esta PENDING — skipping (idempotencia)',
      );
      return {
        status: 'skipped',
        request_id: lgpd_request_id,
        reason: `status was ${request.status}`,
      };
    }

    // Marca PROCESSING
    const { error: procErr } = await dbAdmin
      .from('lgpd_requests')
      .update({ status: LgpdRequestStatus.PROCESSING })
      .eq('id', lgpd_request_id);
    if (procErr) throw procErr;

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

      // Marca REJECTED com motivo — operador humano pode reprocessar manualmente
      await dbAdmin
        .from('lgpd_requests')
        .update({
          status: LgpdRequestStatus.REJECTED,
          rejection_reason: err instanceof Error ? err.message : 'Unknown processing error',
          processed_at: new Date().toISOString(),
        })
        .eq('id', lgpd_request_id);

      return {
        status: 'rejected',
        request_id: lgpd_request_id,
        reason: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }

  // — EXPORT_DATA —
  private async handleExportData(
    request: { id: string; tenant_id: string; scope: any },
  ): Promise<ProcessLgpdRequestResult> {
    const scope = (request.scope as { include?: string[] } | null) ?? {};
    const include = scope.include ?? ['leads', 'conversations', 'meetings', 'scripts'];

    // Collect data sob tenant_id context
    const exportPayload: Record<string, unknown> = { exported_at: new Date().toISOString() };

    if (include.includes('leads')) {
      const { data } = await dbAdmin
        .from('leads')
        .select('id, name, whatsapp, profession, email, status, fit_score, created_at')
        .eq('tenant_id', request.tenant_id)
        .limit(10000);
      exportPayload.leads = data || [];
    }

    if (include.includes('conversations')) {
      const { data } = await dbAdmin
        .from('conversations')
        .select('id, lead_id, status, started_at, message_count')
        .eq('tenant_id', request.tenant_id)
        .limit(10000);
      exportPayload.conversations = data || [];
    }

    if (include.includes('meetings')) {
      const { data } = await dbAdmin
        .from('meetings')
        .select('id, lead_id, scheduled_for, status, outcome, created_at')
        .eq('tenant_id', request.tenant_id)
        .limit(5000);
      exportPayload.meetings = data || [];
    }

    if (include.includes('scripts')) {
      const { data } = await dbAdmin
        .from('scripts')
        .select('id, name, category, status, created_at')
        .eq('tenant_id', request.tenant_id)
        .limit(1000);
      exportPayload.scripts = data || [];
    }

    const existingScope =
      request.scope && typeof request.scope === 'object' && !Array.isArray(request.scope)
        ? (request.scope as Record<string, unknown>)
        : {};

    let downloadUrl: string | null = null;
    let downloadExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    let exportMethod = 'inline-json-fallback';
    let r2Key: string | undefined;

    if (isR2Configured()) {
      try {
        const upload = await uploadLgpdExport({
          tenantId: request.tenant_id,
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
            tenant_id: request.tenant_id,
            lgpd_request_id: request.id,
            err: uploadErr instanceof Error ? { message: uploadErr.message } : uploadErr,
          },
          'lgpd-worker: R2 upload failed — falling back to inline JSON',
        );
      }
    }

    const updatedScope: Record<string, unknown> = {
      ...existingScope,
      export_method: exportMethod,
    };

    if (r2Key) {
      updatedScope.export_r2_key = r2Key;
    } else {
      // Fallback — inline payload
      updatedScope.export_data = exportPayload;
    }

    const { error: updateErr } = await dbAdmin
      .from('lgpd_requests')
      .update({
        status: LgpdRequestStatus.COMPLETED,
        processed_at: new Date().toISOString(),
        download_url: downloadUrl,
        download_expires_at: downloadExpiresAt.toISOString(),
        scope: updatedScope as any,
      })
      .eq('id', request.id);
    if (updateErr) throw updateErr;

    logger.info(
      {
        tenant_id: request.tenant_id,
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

  // — DELETE_LEAD_DATA —
  private async handleDeleteLeadData(
    request: { id: string; tenant_id: string; scope: any },
  ): Promise<ProcessLgpdRequestResult> {
    const scope = (request.scope as { lead_whatsapp?: string } | null) ?? {};
    const leadWhatsapp = scope.lead_whatsapp;

    if (!leadWhatsapp) {
      throw new Error('scope.lead_whatsapp obrigatorio para DELETE_LEAD_DATA');
    }

    const { data: lead, error: leadErr } = await dbAdmin
      .from('leads')
      .select('*')
      .eq('tenant_id', request.tenant_id)
      .eq('whatsapp', leadWhatsapp)
      .limit(1)
      .single();

    if (leadErr || !lead) {
      throw new Error(`Lead com whatsapp ${leadWhatsapp} nao encontrado neste tenant`);
    }

    // Sequential deletes (replacing $transaction)
    // Apaga mensagens (Conversations remain como soft-history mas sem mensagens)
    // First get conversation IDs for this lead
    const { data: convs } = await dbAdmin
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id);
    const convIds = (convs || []).map((c: any) => c.id);

    if (convIds.length > 0) {
      await dbAdmin
        .from('messages')
        .delete()
        .in('conversation_id', convIds);
    }

    // Apaga lead_events
    await dbAdmin
      .from('lead_events')
      .delete()
      .eq('lead_id', lead.id);

    // Apaga notas
    await dbAdmin
      .from('lead_notes')
      .delete()
      .eq('lead_id', lead.id);

    // Apaga conversations
    await dbAdmin
      .from('conversations')
      .delete()
      .eq('lead_id', lead.id);

    // Apaga meetings
    await dbAdmin
      .from('meetings')
      .delete()
      .eq('lead_id', lead.id);

    // Anonimiza lead row (mantem ID + status pra audit, mas zera PII)
    await dbAdmin
      .from('leads')
      .update({
        name: '[REDACTED — LGPD]',
        email: null,
        metadata: null,
        status: LeadStatus.ARCHIVED,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    // Insert em optouts pra evitar re-abordagem
    await dbAdmin
      .from('optouts')
      .upsert(
        {
          tenant_id: request.tenant_id,
          whatsapp: leadWhatsapp,
          reason: 'LGPD-delete-request',
          source: 'lgpd_request',
        },
        { onConflict: 'tenant_id,whatsapp' }
      );

    await dbAdmin
      .from('lgpd_requests')
      .update({
        status: LgpdRequestStatus.COMPLETED,
        processed_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    logger.info(
      { tenant_id: request.tenant_id, lgpd_request_id: request.id, lead_id: lead.id },
      'lgpd-worker: DELETE_LEAD_DATA completed',
    );

    return { status: 'completed', request_id: request.id };
  }

  // — DELETE_TENANT_DATA —
  private async handleDeleteTenantData(request: {
    id: string;
    tenant_id: string;
  }): Promise<ProcessLgpdRequestResult> {
    // MVP — marca tenant como CHURNING e enfileira deletion definitiva
    // apos grace period (PRD G.3 — 7 dias)
    await dbAdmin
      .from('tenants')
      .update({ status: TenantStatus.CHURNING })
      .eq('id', request.tenant_id);

    const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await dbAdmin
      .from('lgpd_requests')
      .update({
        status: LgpdRequestStatus.COMPLETED,
        processed_at: new Date().toISOString(),
        scope: {
          tenant_marked_churning: true,
          grace_period_until: graceUntil.toISOString(),
          deletion_after_grace: 'manual — operador Guilds aprova apos 7d',
        },
      })
      .eq('id', request.id);

    logger.warn(
      {
        tenant_id: request.tenant_id,
        lgpd_request_id: request.id,
        grace_until: graceUntil.toISOString(),
        alert: true,
        severity: 'critical',
        action_required: 'manual-tenant-deletion-after-grace',
      },
      'lgpd-worker: DELETE_TENANT_DATA — tenant marked CHURNING (7d grace)',
    );

    // Pluga Sentry/Slack quando configurado
    await notifyCriticalAlert(
      {
        event_name: 'lgpd:tenant-churning',
        severity: 'critical',
        action_required: 'manual-tenant-deletion-after-grace',
        tenant_id: request.tenant_id,
        lgpd_request_id: request.id,
        grace_until: graceUntil.toISOString(),
      },
      `Tenant ${request.tenant_id} solicitou exclusao LGPD — CHURNING por 7d`,
    );

    return { status: 'completed', request_id: request.id };
  }

  // — CORRECT_DATA —
  private async handleCorrectData(request: {
    id: string;
    tenant_id: string;
  }): Promise<ProcessLgpdRequestResult> {
    // Requer revisao humana — auto-corret nao e seguro sem contexto
    await dbAdmin
      .from('lgpd_requests')
      .update({
        status: LgpdRequestStatus.REJECTED,
        processed_at: new Date().toISOString(),
        rejection_reason:
          'Correcao de dados requer revisao humana. Time Guilds entrara em contato em ate 15 dias uteis.',
      })
      .eq('id', request.id);

    logger.info(
      { tenant_id: request.tenant_id, lgpd_request_id: request.id },
      'lgpd-worker: CORRECT_DATA escalated to human (rejected with reason)',
    );

    return { status: 'rejected', request_id: request.id, reason: 'requires human review' };
  }

  // — CONFIRM_DATA —
  private async handleConfirmData(request: {
    id: string;
    tenant_id: string;
  }): Promise<ProcessLgpdRequestResult> {
    const { count: leadsCount } = await dbAdmin
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', request.tenant_id);

    const { count: convsCount } = await dbAdmin
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', request.tenant_id);

    const { count: meetingsCount } = await dbAdmin
      .from('meetings')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', request.tenant_id);

    const { count: scriptsCount } = await dbAdmin
      .from('scripts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', request.tenant_id);

    await dbAdmin
      .from('lgpd_requests')
      .update({
        status: LgpdRequestStatus.COMPLETED,
        processed_at: new Date().toISOString(),
        scope: {
          confirmation: 'Dados existem no Prospix',
          tenant_id: request.tenant_id,
          counts: {
            leads: leadsCount || 0,
            conversations: convsCount || 0,
            meetings: meetingsCount || 0,
            scripts: scriptsCount || 0,
          },
          confirmed_at: new Date().toISOString(),
        },
      })
      .eq('id', request.id);

    return { status: 'completed', request_id: request.id };
  }
}
