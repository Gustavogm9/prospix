import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';
import { loadAiActivityMonitor, type TenantAiActivity } from '../../../_lib/ai-activity-monitor';

type WhatsAppGuardianTrace = {
  status: {
    status: string | null;
    externalState: string | null;
    externalCheckedAt: string | null;
    lastDisconnectReasonCode: string | null;
    quarantinedUntil: string | null;
    circuitOpenUntil: string | null;
    lastGlobalSendAt: string | null;
    stateEnteredAt?: string | null;
    stateReasonCode?: string | null;
    stateSource?: string | null;
    updatedAt: string | null;
  } | null;
  currentState: {
    status: string;
    label: string;
    impactLevel: 'INFO' | 'OBSERVATION' | 'ATTENTION' | 'CRITICAL';
    operationState: 'ACTIVE' | 'THROTTLED' | 'BLOCKED' | 'REQUIRES_ACTION';
    enteredAt: string | null;
    durationSeconds: number | null;
    allowSend: boolean;
    allowNewActive: boolean;
    summary: string;
  } | null;
  recentTransitions: Array<{
    previousStatus: string | null;
    status: string;
    externalState: string | null;
    reasonCode: string;
    impactLevel: string;
    operationState: string;
    operatorSummary: string;
    allowSend: boolean | null;
    allowNewActive: boolean | null;
    enteredAt: string;
    exitedAt: string | null;
    durationSeconds: number | null;
  }>;
  events24h: Array<{
    eventType: string | null;
    reasonCode: string | null;
    externalState: string | null;
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  recentEvents: Array<{
    eventType: string | null;
    reasonCode: string | null;
    externalState: string | null;
    createdAt: string;
  }>;
  pendingOutbound: {
    activePending: number;
    missingGuardianEvidence: number;
  };
  dueQueueDiagnostics: {
    totalDue: number;
    items: Array<{
      pendingOutboundId: string;
      conversationId: string | null;
      leadId: string | null;
      leadName: string | null;
      leadSource: string | null;
      leadStatus: string | null;
      campaignName: string | null;
      campaignStatus: string | null;
      messageType: string | null;
      scheduledFor: string;
      dueAgeSeconds: number | null;
      attempts: number;
      validationStatus: string | null;
      validationReasonCode: string | null;
      finalGuardianDecision: string | null;
      conversationStatus: string | null;
      aiHandling: boolean | null;
      guardianStatus: string | null;
      guardianExternalState: string | null;
      guardianReasonCode: string | null;
      blockingReason: string;
      blockerKind: string;
      blocksSend: boolean;
      operatorSummary: string;
      recommendedAction: string;
    }>;
  };
  workerSnapshot: {
    generatedAt: string;
    tenantId: string;
    tenantName: string | null;
    tenantStatus: string | null;
    activePending: number;
    duePending: number;
    approvedPending: number;
    delayedPending: number;
    blockedOrFailedLast24h: number;
    nextScheduledFor: string | null;
    oldestDueAt: string | null;
    oldestDueAgeSeconds: number | null;
    sentToday: number;
    sentLast60m: number;
    latestAiMessageAt: string | null;
    latestInboundAt: string | null;
    latestRetryQueuedAt: string | null;
    guardianStatus: string | null;
    guardianExternalState: string | null;
    guardianReasonCode: string | null;
    guardianOperationState: string | null;
    guardianBlockingSend: boolean;
    guardianBlockSummary: string | null;
    firstTouchEligible: number;
    firstTouchEvaluated: number;
    latestQueue: {
      id: string | null;
      messageType: string | null;
      status: string | null;
      createdAt: string | null;
      scheduledFor: string | null;
      sentAt: string | null;
      failedAt: string | null;
      failedReason: string | null;
      validationStatus: string | null;
      validationReasonCode: string | null;
      finalGuardianDecision: string | null;
    } | null;
  } | null;
  aiActivity: TenantAiActivity | null;
};

function stateLabel(status: string | null | undefined): string {
  const normalized = String(status || 'NORMAL').toUpperCase();
  if (normalized === 'NORMAL') return 'Operacional';
  if (normalized === 'COLD') return 'Em observacao';
  if (normalized === 'HIGH_LOAD') return 'Volume alto';
  if (normalized === 'COOLDOWN') return 'Em resfriamento';
  if (normalized === 'PAUSED') return 'Pausado';
  if (normalized === 'SUSPENDED') return 'Acao necessaria';
  return normalized.replaceAll('_', ' ');
}

function buildCurrentState(status: any, latestTransition: any | null): WhatsAppGuardianTrace['currentState'] {
  if (!status) return null;

  const normalized = String(status.status || 'NORMAL').toUpperCase();
  const enteredAt = status.state_entered_at || latestTransition?.entered_at || status.updated_at || null;
  const enteredMs = enteredAt ? new Date(enteredAt).getTime() : NaN;
  const durationSeconds = Number.isFinite(enteredMs)
    ? Math.max(0, Math.floor((Date.now() - enteredMs) / 1000))
    : null;
  const quarantined = status.quarantined_until
    ? new Date(status.quarantined_until).getTime() > Date.now()
    : false;

  if (normalized === 'SUSPENDED') {
    return {
      status: normalized,
      label: stateLabel(normalized),
      impactLevel: 'CRITICAL',
      operationState: 'REQUIRES_ACTION',
      enteredAt,
      durationSeconds,
      allowSend: false,
      allowNewActive: false,
      summary: 'WhatsApp desconectado ou sem autorizacao. A IA nao envia ate reconectar o numero.',
    };
  }

  if (normalized === 'PAUSED') {
    return {
      status: normalized,
      label: stateLabel(normalized),
      impactLevel: 'ATTENTION',
      operationState: 'BLOCKED',
      enteredAt,
      durationSeconds,
      allowSend: false,
      allowNewActive: false,
      summary: 'Conexao instavel, fechada ou conectando. A IA pausa envios para evitar falhas.',
    };
  }

  if (normalized === 'COLD') {
    return {
      status: normalized,
      label: stateLabel(normalized),
      impactLevel: 'OBSERVATION',
      operationState: 'THROTTLED',
      enteredAt,
      durationSeconds,
      allowSend: true,
      allowNewActive: !quarantined,
      summary: quarantined
        ? 'WhatsApp conectado em observacao. Respostas podem seguir, mas novas prospeccoes aguardam o fim da quarentena.'
        : 'WhatsApp conectado em observacao. A IA opera com ritmo reduzido para proteger o numero.',
    };
  }

  if (normalized === 'HIGH_LOAD') {
    return {
      status: normalized,
      label: stateLabel(normalized),
      impactLevel: 'OBSERVATION',
      operationState: 'THROTTLED',
      enteredAt,
      durationSeconds,
      allowSend: true,
      allowNewActive: false,
      summary: 'Volume alto. A IA prioriza respostas e reduz novas prospeccoes ate a carga normalizar.',
    };
  }

  if (normalized === 'COOLDOWN') {
    return {
      status: normalized,
      label: stateLabel(normalized),
      impactLevel: 'ATTENTION',
      operationState: 'THROTTLED',
      enteredAt,
      durationSeconds,
      allowSend: true,
      allowNewActive: false,
      summary: 'Numero em resfriamento operacional. A IA envia com intervalo maior e nao inicia novas prospeccoes.',
    };
  }

  return {
    status: normalized,
    label: stateLabel(normalized),
    impactLevel: 'INFO',
    operationState: 'ACTIVE',
    enteredAt,
    durationSeconds,
    allowSend: true,
    allowNewActive: true,
    summary: 'WhatsApp operacional. A IA pode responder e iniciar conversas dentro das regras configuradas.',
  };
}

function aggregateEvents(events: any[]) {
  const grouped = new Map<string, {
    eventType: string | null;
    reasonCode: string | null;
    externalState: string | null;
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>();

  for (const event of events) {
    const eventType = event.event_type ?? null;
    const reasonCode = event.reason_code ?? null;
    const externalState = event.external_state ?? null;
    const createdAt = event.created_at;
    if (!createdAt) continue;

    const key = `${eventType || ''}|${reasonCode || ''}|${externalState || ''}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        eventType,
        reasonCode,
        externalState,
        count: 1,
        firstSeenAt: createdAt,
        lastSeenAt: createdAt,
      });
      continue;
    }

    existing.count += 1;
    if (createdAt < existing.firstSeenAt) existing.firstSeenAt = createdAt;
    if (createdAt > existing.lastSeenAt) existing.lastSeenAt = createdAt;
  }

  return Array.from(grouped.values()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

function mapWorkerSnapshot(row: any): WhatsAppGuardianTrace['workerSnapshot'] {
  if (!row) return null;

  const latestQueue = row.latest_queue_id
    ? {
        id: row.latest_queue_id ?? null,
        messageType: row.latest_queue_message_type ?? null,
        status: row.latest_queue_status ?? null,
        createdAt: row.latest_queue_created_at ?? null,
        scheduledFor: row.latest_queue_scheduled_for ?? null,
        sentAt: row.latest_queue_sent_at ?? null,
        failedAt: row.latest_queue_failed_at ?? null,
        failedReason: row.latest_queue_failed_reason ?? null,
        validationStatus: row.latest_queue_validation_status ?? null,
        validationReasonCode: row.latest_queue_validation_reason_code ?? null,
        finalGuardianDecision: row.latest_queue_final_guardian_decision ?? null,
      }
    : null;

  return {
    generatedAt: row.generated_at,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name ?? null,
    tenantStatus: row.tenant_status ?? null,
    activePending: Number(row.active_pending ?? 0),
    duePending: Number(row.due_pending ?? 0),
    approvedPending: Number(row.approved_pending ?? 0),
    delayedPending: Number(row.delayed_pending ?? 0),
    blockedOrFailedLast24h: Number(row.blocked_or_failed_last24h ?? 0),
    nextScheduledFor: row.next_scheduled_for ?? null,
    oldestDueAt: row.oldest_due_at ?? null,
    oldestDueAgeSeconds: row.oldest_due_age_seconds == null ? null : Number(row.oldest_due_age_seconds),
    sentToday: Number(row.sent_today ?? 0),
    sentLast60m: Number(row.sent_last60m ?? 0),
    latestAiMessageAt: row.latest_ai_message_at ?? null,
    latestInboundAt: row.latest_inbound_at ?? null,
    latestRetryQueuedAt: row.latest_retry_queued_at ?? null,
    guardianStatus: row.guardian_status ?? null,
    guardianExternalState: row.guardian_external_state ?? null,
    guardianReasonCode: row.guardian_reason_code ?? null,
    guardianOperationState: row.guardian_operation_state ?? null,
    guardianBlockingSend: Boolean(row.guardian_blocking_send),
    guardianBlockSummary: row.guardian_block_summary ?? null,
    firstTouchEligible: Number(row.first_touch_eligible ?? 0),
    firstTouchEvaluated: Number(row.first_touch_evaluated ?? 0),
    latestQueue,
  };
}

function mapDueQueueDiagnostic(row: any): WhatsAppGuardianTrace['dueQueueDiagnostics']['items'][number] {
  return {
    pendingOutboundId: row.pending_outbound_id,
    conversationId: row.conversation_id ?? null,
    leadId: row.lead_id ?? null,
    leadName: row.lead_name ?? null,
    leadSource: row.lead_source ?? null,
    leadStatus: row.lead_status ?? null,
    campaignName: row.campaign_name ?? null,
    campaignStatus: row.campaign_status ?? null,
    messageType: row.message_type ?? null,
    scheduledFor: row.scheduled_for,
    dueAgeSeconds: row.due_age_seconds == null ? null : Number(row.due_age_seconds),
    attempts: Number(row.attempts ?? 0),
    validationStatus: row.validation_status ?? null,
    validationReasonCode: row.validation_reason_code ?? null,
    finalGuardianDecision: row.final_guardian_decision ?? null,
    conversationStatus: row.conversation_status ?? null,
    aiHandling: row.ai_handling ?? null,
    guardianStatus: row.guardian_status ?? null,
    guardianExternalState: row.guardian_external_state ?? null,
    guardianReasonCode: row.guardian_reason_code ?? null,
    blockingReason: row.blocking_reason,
    blockerKind: row.blocker_kind,
    blocksSend: Boolean(row.blocks_send),
    operatorSummary: row.operator_summary,
    recommendedAction: row.recommended_action,
  };
}

async function loadWhatsAppGuardianTrace(tenantId: string): Promise<WhatsAppGuardianTrace> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let statusQuery = supabaseAdmin
    .from('whatsapp_guardian_status')
    .select('status, external_state, external_checked_at, last_disconnect_reason_code, quarantined_until, circuit_open_until, last_global_send_at, state_entered_at, state_reason_code, state_source, updated_at')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const [
    recentEventsResult,
    events24hResult,
    activePendingResult,
    missingGuardianResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('whatsapp_connection_events')
      .select('event_type, reason_code, external_state, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('whatsapp_connection_events')
      .select('event_type, reason_code, external_state, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('pending_outbound')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('sent_at', null)
      .is('failed_at', null),
    supabaseAdmin
      .from('pending_outbound')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('sent_at', null)
      .is('failed_at', null)
      .or('validation_status.is.null,guardian_config_version_id.is.null,final_guardian_decision.is.null'),
  ]);

  let statusResult = await statusQuery;
  if (statusResult.error) {
    statusQuery = supabaseAdmin
      .from('whatsapp_guardian_status')
      .select('status, external_state, external_checked_at, last_disconnect_reason_code, quarantined_until, circuit_open_until, last_global_send_at, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    statusResult = await statusQuery;
  }

  if (statusResult.error) throw statusResult.error;
  if (recentEventsResult.error) throw recentEventsResult.error;
  if (events24hResult.error) throw events24hResult.error;
  if (activePendingResult.error) throw activePendingResult.error;
  if (missingGuardianResult.error) throw missingGuardianResult.error;

  let recentTransitions: WhatsAppGuardianTrace['recentTransitions'] = [];
  const transitionsResult = await supabaseAdmin
    .from('whatsapp_guardian_state_transitions')
    .select('previous_status, status, external_state, reason_code, impact_level, operation_state, operator_summary, allow_send, allow_new_active, entered_at, exited_at, duration_seconds')
    .eq('tenant_id', tenantId)
    .order('entered_at', { ascending: false })
    .limit(8);

  if (!transitionsResult.error) {
    recentTransitions = (transitionsResult.data ?? []).map((transition: any) => ({
      previousStatus: transition.previous_status ?? null,
      status: transition.status,
      externalState: transition.external_state ?? null,
      reasonCode: transition.reason_code,
      impactLevel: transition.impact_level,
      operationState: transition.operation_state,
      operatorSummary: transition.operator_summary,
      allowSend: transition.allow_send ?? null,
      allowNewActive: transition.allow_new_active ?? null,
      enteredAt: transition.entered_at,
      exitedAt: transition.exited_at ?? null,
      durationSeconds: transition.duration_seconds ?? null,
    }));
  }

  let workerSnapshot: WhatsAppGuardianTrace['workerSnapshot'] = null;
  const workerSnapshotResult = await supabaseAdmin
    .from('ai_worker_operational_snapshot')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!workerSnapshotResult.error) {
    workerSnapshot = mapWorkerSnapshot(workerSnapshotResult.data);
  } else {
    console.warn('AI worker operational snapshot unavailable:', workerSnapshotResult.error.message);
  }

  let dueQueueDiagnostics: WhatsAppGuardianTrace['dueQueueDiagnostics'] = {
    totalDue: 0,
    items: [],
  };
  const dueQueueDiagnosticsResult = await supabaseAdmin
    .from('ai_worker_due_queue_diagnostics')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('scheduled_for', { ascending: true })
    .limit(5);

  if (!dueQueueDiagnosticsResult.error) {
    dueQueueDiagnostics = {
      totalDue: dueQueueDiagnosticsResult.count ?? (dueQueueDiagnosticsResult.data?.length ?? 0),
      items: (dueQueueDiagnosticsResult.data ?? []).map(mapDueQueueDiagnostic),
    };
  } else {
    console.warn('AI worker due queue diagnostics unavailable:', dueQueueDiagnosticsResult.error.message);
  }

  const status = statusResult.data
    ? {
        status: statusResult.data.status ?? null,
        externalState: statusResult.data.external_state ?? null,
        externalCheckedAt: statusResult.data.external_checked_at ?? null,
        lastDisconnectReasonCode: statusResult.data.last_disconnect_reason_code ?? null,
        quarantinedUntil: statusResult.data.quarantined_until ?? null,
        circuitOpenUntil: statusResult.data.circuit_open_until ?? null,
        lastGlobalSendAt: statusResult.data.last_global_send_at ?? null,
        stateEnteredAt: statusResult.data.state_entered_at ?? null,
        stateReasonCode: statusResult.data.state_reason_code ?? null,
        stateSource: statusResult.data.state_source ?? null,
        updatedAt: statusResult.data.updated_at ?? null,
      }
    : null;

  return {
    status,
    currentState: buildCurrentState(statusResult.data, recentTransitions[0] || null),
    recentTransitions,
    events24h: aggregateEvents(events24hResult.data ?? []),
    recentEvents: (recentEventsResult.data ?? []).map((event: any) => ({
      eventType: event.event_type ?? null,
      reasonCode: event.reason_code ?? null,
      externalState: event.external_state ?? null,
      createdAt: event.created_at,
    })),
    pendingOutbound: {
      activePending: activePendingResult.count ?? 0,
      missingGuardianEvidence: missingGuardianResult.count ?? 0,
    },
    dueQueueDiagnostics,
    workerSnapshot,
    aiActivity: null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    const guardianTrace = await loadWhatsAppGuardianTrace(tenantId);
    const aiActivityMonitor = await loadAiActivityMonitor(supabaseAdmin, { tenantIds: [tenantId] });
    guardianTrace.aiActivity = aiActivityMonitor.tenants[0] || null;

    const { data: secretRecord } = await supabaseAdmin
      .from('tenant_secrets')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!secretRecord || !secretRecord.evolution_instance_name) {
      return NextResponse.json({
        status: 'disconnected',
        configured: false,
        instanceName: null,
        guardianTrace,
      });
    }

    const instanceName = secretRecord.evolution_instance_name;
    const baseUrl = secretRecord.evolution_base_url || process.env.EVOLUTION_BASE_URL;
    const apiKey = secretRecord.evolution_api_key_encrypted || process.env.EVOLUTION_GUILDS_API_KEY || '';

    // Call Evolution API fetchInstances to get rich metadata about the instances
    const evoRes = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(4000),
    });

    if (!evoRes.ok) {
      // Se a chamada global falhar, tente a connectionState como fallback
      try {
        const fallbackRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
          headers: { apikey: apiKey },
          signal: AbortSignal.timeout(3000),
        });
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          const state = fallbackData?.instance?.state ?? fallbackData?.state;
          return NextResponse.json({
            status: state === 'open' ? 'connected' : 'disconnected',
            reason: 'other',
            configured: true,
            instanceName,
            guardianTrace,
          });
        }
      } catch (_e) {}

      return NextResponse.json({
        status: 'disconnected',
        configured: true,
        instanceName,
        error: 'CONNECTION_STATE_UNAVAILABLE',
        guardianTrace,
      });
    }

    const instances = await evoRes.json();
    const instance = Array.isArray(instances)
      ? instances.find((inst: any) => inst.name === instanceName || inst.instanceName === instanceName)
      : null;

    if (!instance) {
      return NextResponse.json({
        status: 'disconnected',
        configured: true,
        instanceName,
        reason: 'instance_not_found',
        guardianTrace,
      });
    }

    const isConnected = instance.connectionStatus === 'open' || instance.connectionState?.state === 'open';
    let reason = 'other';

    if (!isConnected && instance.disconnectionObject) {
      try {
        const discObj = typeof instance.disconnectionObject === 'string'
          ? JSON.parse(instance.disconnectionObject)
          : instance.disconnectionObject;
        const errTag = discObj?.error?.data?.content?.[0]?.attrs?.type || discObj?.error?.data?.tag;
        if (errTag === 'device_removed' || JSON.stringify(discObj).includes('device_removed')) {
          reason = 'device_removed';
        }
      } catch (_e) {
        if (JSON.stringify(instance.disconnectionObject).includes('device_removed')) {
          reason = 'device_removed';
        }
      }
    }

    return NextResponse.json({
      status: isConnected ? 'connected' : 'disconnected',
      reason: isConnected ? null : reason,
      configured: true,
      instanceName,
      guardianTrace,
    });
  } catch (err) {
    console.error('Error getting WhatsApp connection status:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to process WhatsApp integration request' },
      { status: 500 }
    );
  }
}
