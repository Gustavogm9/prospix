import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';

type WhatsAppGuardianTrace = {
  status: {
    status: string | null;
    externalState: string | null;
    externalCheckedAt: string | null;
    lastDisconnectReasonCode: string | null;
    quarantinedUntil: string | null;
    circuitOpenUntil: string | null;
    lastGlobalSendAt: string | null;
    updatedAt: string | null;
  } | null;
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
};

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

  const [
    statusResult,
    recentEventsResult,
    events24hResult,
    activePendingResult,
    missingGuardianResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('whatsapp_guardian_status')
      .select('status, external_state, external_checked_at, last_disconnect_reason_code, quarantined_until, circuit_open_until, last_global_send_at, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
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

  if (statusResult.error) throw statusResult.error;
  if (recentEventsResult.error) throw recentEventsResult.error;
  if (events24hResult.error) throw events24hResult.error;
  if (activePendingResult.error) throw activePendingResult.error;
  if (missingGuardianResult.error) throw missingGuardianResult.error;

  const status = statusResult.data
    ? {
        status: statusResult.data.status ?? null,
        externalState: statusResult.data.external_state ?? null,
        externalCheckedAt: statusResult.data.external_checked_at ?? null,
        lastDisconnectReasonCode: statusResult.data.last_disconnect_reason_code ?? null,
        quarantinedUntil: statusResult.data.quarantined_until ?? null,
        circuitOpenUntil: statusResult.data.circuit_open_until ?? null,
        lastGlobalSendAt: statusResult.data.last_global_send_at ?? null,
        updatedAt: statusResult.data.updated_at ?? null,
      }
    : null;

  return {
    status,
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
  };
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    const guardianTrace = await loadWhatsAppGuardianTrace(tenantId);

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
