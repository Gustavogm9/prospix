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
