import {
  buildAdminAiActivityAlertMessage,
  buildAdminDisconnectAlertMessage,
  buildAdminRecoveryStructuralAlertMessage,
} from './admin-message-formatters.ts';

type SupabaseLike = any;

type Recipient = {
  id: string;
  label: string;
  whatsapp: string;
};

type SendResult = {
  ok: boolean;
  channelId?: string | null;
  channelInstanceName?: string | null;
  whatsappMessageId?: string | null;
  error?: string | null;
};

type AdminMonitoringChannelRow = {
  id: string;
  label: string;
  evolution_base_url: string;
  evolution_instance_name: string;
  active: boolean;
  connection_status: string;
  external_state: string | null;
  last_qr_requested_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
};

type AdminChannel = {
  channelId: string | null;
  label: string | null;
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  configured: boolean;
  source: string;
  connectionStatus: string | null;
  externalState: string | null;
  lastQrRequestedAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

type DisconnectAlertParams = {
  supabase: SupabaseLike;
  tenantId: string;
  reasonCode: string;
  externalState?: string | null;
  connectionEventId?: string | null;
  operationalAlertId?: string | null;
  pendingDueCount?: number | null;
  source: string;
};

type AiActivityAlertParams = {
  supabase: SupabaseLike;
  activity: {
    tenant_id?: string | null;
    tenant_name?: string | null;
    state?: string | null;
    summary?: string | null;
    action?: string | null;
    contactable_backlog?: number | null;
    due_pending?: number | null;
    unanswered_conversations?: number | null;
    outbound_today?: number | null;
    outbound_last_60m?: number | null;
    inbound_today?: number | null;
    guardian_status?: string | null;
    guardian_reason_code?: string | null;
    blocking_reason?: string | null;
    blocker_kind?: string | null;
    guardian_blocking_send?: boolean | null;
  };
  source: string;
};

type RecoveryStructuralAlertParams = {
  supabase: SupabaseLike;
  tenantId: string;
  reasonCode: string;
  structuralReason: string;
  details?: string | null;
  pendingDueCount?: number | null;
  source: string;
};

type DisconnectIncident = {
  id: string | null;
  incident_key: string;
  status: string;
  alert_sent_at?: string | null;
  alert_send_attempts?: number | null;
  occurrence_count?: number | null;
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_EVOLUTION_BASE_URL = 'https://evolution-evolution-api.qr4jgl.easypanel.host';

function uuid(): string {
  return crypto.randomUUID();
}

function cleanText(value: unknown, max = 600): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeWhatsAppNumber(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeBaseUrl(value: string | null | undefined): string {
  return String(value || '').replace(/\/+$/, '');
}

function canonicalReasonCode(reasonCode: unknown): string {
  return cleanText(reasonCode || 'UNKNOWN', 120) || 'UNKNOWN';
}

function stableToken(value: unknown, fallback = 'GENERAL'): string {
  return (
    cleanText(value || fallback, 80)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback
  );
}

function buildAiActivityIncidentKey(tenantId: string, state: string, activity: AiActivityAlertParams['activity']) {
  const reason =
    activity.blocking_reason ||
    activity.guardian_reason_code ||
    activity.guardian_status ||
    activity.blocker_kind ||
    activity.summary ||
    state;
  return `ai_activity:${tenantId}:${stableToken(state)}:${stableToken(reason)}`;
}

function getAdminMonitoringApiKey(): string {
  return (
    Deno.env.get('ADMIN_REPORT_EVOLUTION_API_KEY') || Deno.env.get('EVOLUTION_GUILDS_API_KEY') || ''
  );
}

function getDefaultAdminBaseUrl(): string {
  return normalizeBaseUrl(
    Deno.env.get('ADMIN_REPORT_EVOLUTION_BASE_URL') ||
      Deno.env.get('EVOLUTION_BASE_URL') ||
      DEFAULT_EVOLUTION_BASE_URL,
  );
}

async function loadActiveAdminMonitoringChannel(
  supabase?: SupabaseLike,
): Promise<AdminMonitoringChannelRow | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('admin_monitoring_channels')
    .select(
      [
        'id',
        'label',
        'evolution_base_url',
        'evolution_instance_name',
        'active',
        'connection_status',
        'external_state',
        'last_qr_requested_at',
        'connected_at',
        'disconnected_at',
        'last_checked_at',
        'last_error',
      ].join(', '),
    )
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[admin-monitoring] failed to load admin channel', error);
    return null;
  }

  return (data || null) as AdminMonitoringChannelRow | null;
}

async function getAdminChannel(supabase?: SupabaseLike): Promise<AdminChannel> {
  const row = await loadActiveAdminMonitoringChannel(supabase);
  const apiKey = getAdminMonitoringApiKey();

  if (row) {
    const baseUrl = normalizeBaseUrl(row.evolution_base_url) || getDefaultAdminBaseUrl();
    return {
      channelId: row.id,
      label: row.label,
      baseUrl,
      instanceName: row.evolution_instance_name || '',
      apiKey,
      configured: Boolean(baseUrl && row.evolution_instance_name && apiKey),
      source: 'admin_monitoring_channels',
      connectionStatus: row.connection_status || 'UNKNOWN',
      externalState: row.external_state || null,
      lastQrRequestedAt: row.last_qr_requested_at || null,
      connectedAt: row.connected_at || null,
      disconnectedAt: row.disconnected_at || null,
      lastCheckedAt: row.last_checked_at || null,
      lastError: row.last_error || null,
    };
  }

  return {
    channelId: null,
    label: null,
    baseUrl: getDefaultAdminBaseUrl(),
    instanceName: '',
    apiKey,
    configured: false,
    source: 'NO_ACTIVE_ADMIN_MONITORING_CHANNEL',
    connectionStatus: null,
    externalState: null,
    lastQrRequestedAt: null,
    connectedAt: null,
    disconnectedAt: null,
    lastCheckedAt: null,
    lastError: null,
  };
}

export async function getAdminMonitoringChannelStatus(supabase?: SupabaseLike) {
  const channel = await getAdminChannel(supabase);
  return {
    configured: channel.configured,
    connected: channel.connectionStatus === 'CONNECTED',
    channelId: channel.channelId,
    label: channel.label,
    source: channel.source,
    instanceName: channel.instanceName || null,
    baseUrlConfigured: Boolean(channel.baseUrl),
    apiKeyConfigured: Boolean(channel.apiKey),
    connectionStatus: channel.connectionStatus,
    externalState: channel.externalState,
    lastQrRequestedAt: channel.lastQrRequestedAt,
    connectedAt: channel.connectedAt,
    disconnectedAt: channel.disconnectedAt,
    lastCheckedAt: channel.lastCheckedAt,
    lastError: channel.lastError,
    reason: channel.channelId ? null : 'NO_ACTIVE_ADMIN_MONITORING_CHANNEL',
  };
}

export async function sendAdminMonitoringWhatsApp(
  to: string,
  text: string,
  supabase?: SupabaseLike,
): Promise<SendResult> {
  const channel = await getAdminChannel(supabase);
  if (!channel.configured) {
    return {
      ok: false,
      channelId: channel.channelId,
      channelInstanceName: channel.instanceName || null,
      error: channel.channelId
        ? 'ADMIN_MONITORING_CHANNEL_INCOMPLETE'
        : 'ADMIN_MONITORING_CHANNEL_NOT_CONNECTED',
    };
  }

  const number = normalizeWhatsAppNumber(to);
  if (number.length < 10) {
    return {
      ok: false,
      channelId: channel.channelId,
      channelInstanceName: channel.instanceName || null,
      error: 'INVALID_RECIPIENT_WHATSAPP',
    };
  }

  try {
    const response = await fetch(`${channel.baseUrl}/message/sendText/${channel.instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: channel.apiKey,
      },
      body: JSON.stringify({
        number,
        text: text.slice(0, 3900),
      }),
      signal: AbortSignal.timeout(12_000),
    });

    const bodyText = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(bodyText);
    } catch (_err) {
      body = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        channelId: channel.channelId,
        channelInstanceName: channel.instanceName,
        error: `HTTP ${response.status}: ${bodyText.slice(0, 240)}`,
      };
    }

    return {
      ok: true,
      channelId: channel.channelId,
      channelInstanceName: channel.instanceName,
      whatsappMessageId: body?.key?.id || body?.messageId || null,
    };
  } catch (err: any) {
    return {
      ok: false,
      channelId: channel.channelId,
      channelInstanceName: channel.instanceName || null,
      error: cleanText(err?.message || err, 240),
    };
  }
}

export async function summarizeWithExistingAI(params: {
  systemPrompt: string;
  userPrompt: string;
  fallback: string;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return params.fallback;

  try {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: Deno.env.get('ADMIN_MONITORING_OPENAI_MODEL') || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: 0.1,
        max_tokens: params.maxTokens || 220,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return params.fallback;
    const data = await response.json();
    return cleanText(data?.choices?.[0]?.message?.content || params.fallback, 1200);
  } catch (_err) {
    return params.fallback;
  }
}

async function loadRecipients(supabase: SupabaseLike): Promise<Recipient[]> {
  const { data, error } = await supabase
    .from('admin_monitoring_recipients')
    .select('id, label, whatsapp')
    .eq('active', true)
    .eq('disconnect_alerts_enabled', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[admin-monitoring] failed to load recipients', error);
    return [];
  }

  return (data || []) as Recipient[];
}

async function loadTenant(supabase: SupabaseLike, tenantId: string) {
  const { data } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('id', tenantId)
    .maybeSingle();
  return data || { id: tenantId, name: tenantId, slug: null };
}

async function loadOpenDisconnectIncident(
  supabase: SupabaseLike,
  tenantId: string,
  reasonCode?: string | null,
): Promise<DisconnectIncident | null> {
  let query = supabase
    .from('admin_disconnect_incidents')
    .select('id, incident_key, status, alert_sent_at, alert_send_attempts, occurrence_count')
    .eq('tenant_id', tenantId)
    .eq('status', 'OPEN')
    .order('last_seen_at', { ascending: false })
    .limit(1);

  if (reasonCode) query = query.eq('reason_code', canonicalReasonCode(reasonCode));

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn('[admin-monitoring] failed to load disconnect incident', error);
    return null;
  }
  return (data || null) as DisconnectIncident | null;
}

async function touchDisconnectIncident(
  supabase: SupabaseLike,
  incident: DisconnectIncident,
  params: DisconnectAlertParams,
  eventAt: string,
  externalState: string | null,
): Promise<DisconnectIncident> {
  if (!incident.id) return incident;

  const occurrenceCount = Math.max(1, Number(incident.occurrence_count || 1)) + 1;
  const patch: Record<string, unknown> = {
    last_connection_event_id: params.connectionEventId || null,
    operational_alert_id: params.operationalAlertId || null,
    last_external_state: externalState,
    last_seen_at: eventAt,
    occurrence_count: occurrenceCount,
    pending_due_count: params.pendingDueCount ?? null,
    source: params.source,
    last_error: null,
  };

  const { data, error } = await supabase
    .from('admin_disconnect_incidents')
    .update(patch)
    .eq('id', incident.id)
    .select('id, incident_key, status, alert_sent_at, alert_send_attempts, occurrence_count')
    .single();

  if (error) {
    console.warn('[admin-monitoring] failed to touch disconnect incident', error);
    return incident;
  }

  return (data || incident) as DisconnectIncident;
}

async function openOrTouchDisconnectIncident(
  params: DisconnectAlertParams,
  eventAt: string,
  externalState: string | null,
): Promise<DisconnectIncident> {
  const reasonCode = canonicalReasonCode(params.reasonCode);
  const existing = await loadOpenDisconnectIncident(params.supabase, params.tenantId, reasonCode);
  if (existing) {
    return touchDisconnectIncident(params.supabase, existing, params, eventAt, externalState);
  }

  const incidentId = uuid();
  const incidentKey = `disconnect_incident:${incidentId}`;
  const { data, error } = await params.supabase
    .from('admin_disconnect_incidents')
    .insert({
      id: incidentId,
      tenant_id: params.tenantId,
      reason_code: reasonCode,
      incident_key: incidentKey,
      status: 'OPEN',
      first_connection_event_id: params.connectionEventId || null,
      last_connection_event_id: params.connectionEventId || null,
      operational_alert_id: params.operationalAlertId || null,
      first_external_state: externalState,
      last_external_state: externalState,
      first_seen_at: eventAt,
      last_seen_at: eventAt,
      occurrence_count: 1,
      pending_due_count: params.pendingDueCount ?? null,
      source: params.source,
    })
    .select('id, incident_key, status, alert_sent_at, alert_send_attempts, occurrence_count')
    .single();

  if (!error && data) return data as DisconnectIncident;

  const raced = await loadOpenDisconnectIncident(params.supabase, params.tenantId, reasonCode);
  if (raced) {
    return touchDisconnectIncident(params.supabase, raced, params, eventAt, externalState);
  }

  console.warn('[admin-monitoring] failed to open disconnect incident', error);
  return {
    id: null,
    incident_key: `disconnect_fallback:${params.tenantId}:${reasonCode}`,
    status: 'OPEN',
    alert_sent_at: null,
    alert_send_attempts: 0,
    occurrence_count: 1,
  };
}

async function markDisconnectIncidentAlertAttempted(
  supabase: SupabaseLike,
  incident: DisconnectIncident,
  params: { sent: number; failed: number; lastError?: string | null },
) {
  if (!incident.id) return;

  const attempted = params.sent + params.failed;
  const patch: Record<string, unknown> = {
    alert_send_attempts: Number(incident.alert_send_attempts || 0) + attempted,
    last_error: params.lastError || null,
  };
  if (params.sent > 0) patch.alert_sent_at = new Date().toISOString();

  const { error } = await supabase
    .from('admin_disconnect_incidents')
    .update(patch)
    .eq('id', incident.id);

  if (error) {
    console.warn('[admin-monitoring] failed to mark disconnect incident alert attempt', error);
  }
}

export async function hasOpenAdminDisconnectIncident(
  supabase: SupabaseLike,
  tenantId: string,
  reasonCode?: string | null,
): Promise<boolean> {
  if (!tenantId) return false;
  return Boolean(await loadOpenDisconnectIncident(supabase, tenantId, reasonCode));
}

export async function resolveAdminDisconnectIncidents(params: {
  supabase: SupabaseLike;
  tenantId: string;
  externalState?: string | null;
  reasonCode?: string | null;
  connectionEventId?: string | null;
  source: string;
}) {
  if (!params.tenantId) return { resolved: 0 };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: 'RESOLVED',
    resolved_at: now,
    resolved_reason_code: canonicalReasonCode(params.reasonCode || 'WA_CONNECTION_HEALTHY'),
    last_external_state: params.externalState || 'open',
    last_seen_at: now,
    source: params.source,
    last_error: null,
  };
  if (params.connectionEventId) patch.last_connection_event_id = params.connectionEventId;

  const { data, error } = await params.supabase
    .from('admin_disconnect_incidents')
    .update(patch)
    .eq('tenant_id', params.tenantId)
    .eq('status', 'OPEN')
    .select('id');

  if (error) {
    console.warn('[admin-monitoring] failed to resolve disconnect incidents', error);
    return { resolved: 0, error: error.message };
  }

  return { resolved: (data || []).length };
}

async function createOrLoadAiActivityOperationalAlert(
  params: AiActivityAlertParams,
  incidentKey: string,
) {
  const tenantId = String(params.activity.tenant_id || '');
  if (!tenantId) return null;

  const { data: existing } = await params.supabase
    .from('operational_alerts')
    .select('id')
    .eq('dedup_key', incidentKey)
    .is('resolved_at', null)
    .maybeSingle();

  if (existing?.id) {
    await params.supabase
      .from('operational_alerts')
      .update({
        message: cleanText(
          params.activity.summary || 'Monitor de atividade detectou atraso operacional da IA.',
          500,
        ),
        context: {
          source: params.source,
          activity: params.activity,
          dedupe: 'same_tenant_state_reason',
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    return existing.id;
  }

  const alertId = uuid();
  const state = String(params.activity.state || 'STALLED').toUpperCase();
  const severity = state === 'BLOCKED' ? 'CRITICAL' : 'ATTENTION';
  const { error } = await params.supabase.from('operational_alerts').insert({
    id: alertId,
    type: 'ai_activity_monitor',
    severity,
    tenant_id: tenantId,
    title: state === 'BLOCKED' ? 'IA bloqueada operacionalmente' : 'IA com atividade atrasada',
    message: cleanText(
      params.activity.summary || 'Monitor de atividade detectou atraso operacional da IA.',
      500,
    ),
    context: {
      source: params.source,
      activity: params.activity,
      dedupe: 'same_tenant_state_reason',
    },
    dedup_key: incidentKey,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.warn('[admin-monitoring] failed to create AI activity operational_alert', error);
    return null;
  }

  return alertId;
}

async function createOrLoadRecoveryStructuralOperationalAlert(
  params: RecoveryStructuralAlertParams,
  incidentKey: string,
) {
  const { data: existing } = await params.supabase
    .from('operational_alerts')
    .select('id')
    .eq('dedup_key', incidentKey)
    .is('resolved_at', null)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const alertId = uuid();
  const { error } = await params.supabase.from('operational_alerts').insert({
    id: alertId,
    type: 'ai_recovery_structural_block',
    severity: 'CRITICAL',
    tenant_id: params.tenantId,
    title: 'RECOVERY bloqueado por erro estrutural',
    message: cleanText(
      params.structuralReason || 'RECOVERY bloqueado por dependencia estrutural indisponivel.',
      500,
    ),
    context: {
      source: params.source,
      reason_code: params.reasonCode,
      structural_reason: params.structuralReason,
      details: params.details || null,
      pending_due_count: params.pendingDueCount ?? null,
    },
    dedup_key: incidentKey,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.warn(
      '[admin-monitoring] failed to create RECOVERY structural operational_alert',
      error,
    );
    return null;
  }

  return alertId;
}

async function loadConnectionEvent(supabase: SupabaseLike, eventId?: string | null) {
  if (!eventId) return null;
  const { data } = await supabase
    .from('whatsapp_connection_events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();
  return data || null;
}

async function loadRecentMessages(supabase: SupabaseLike, tenantId: string, referenceAt: string) {
  const ref = new Date(referenceAt);
  const since = new Date(ref.getTime() - 5 * 60 * 60 * 1000).toISOString();

  const { data: messages } = await supabase
    .from('messages')
    .select('id, conversation_id, direction, sender, content, delivery_status, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .lte('created_at', referenceAt)
    .order('created_at', { ascending: false })
    .limit(12);

  const rows = messages || [];
  const conversationIds = Array.from(
    new Set(rows.map((m: any) => m.conversation_id).filter(Boolean)),
  );
  const conversationLead = new Map<string, string>();

  if (conversationIds.length > 0) {
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id, lead_id')
      .in('id', conversationIds);
    for (const row of conversations || []) {
      if (row.id && row.lead_id) conversationLead.set(row.id, row.lead_id);
    }
  }

  const leadIds = Array.from(new Set(Array.from(conversationLead.values())));
  const leads = new Map<string, any>();

  if (leadIds.length > 0) {
    const { data: leadRows } = await supabase
      .from('leads')
      .select('id, name, whatsapp')
      .in('id', leadIds);
    for (const lead of leadRows || []) {
      leads.set(lead.id, lead);
    }
  }

  return rows.reverse().map((message: any) => {
    const lead = leads.get(conversationLead.get(message.conversation_id) || '');
    return {
      created_at: message.created_at,
      direction: message.direction,
      sender: message.sender,
      delivery_status: message.delivery_status,
      lead_name: lead?.name || null,
      lead_whatsapp: lead?.whatsapp || null,
      content_preview: cleanText(message.content, 180),
    };
  });
}

async function loadRecentOutboundMessages(
  supabase: SupabaseLike,
  tenantId: string,
  referenceAt: string,
) {
  const messages = await loadRecentMessages(supabase, tenantId, referenceAt);
  return messages.filter(
    (message: any) => String(message.direction || '').toUpperCase() === 'OUTBOUND',
  );
}

async function loadQueueImpact(supabase: SupabaseLike, tenantId: string, referenceAt: string) {
  const baseQuery = () =>
    supabase
      .from('pending_outbound')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('sent_at', null)
      .is('failed_at', null);

  const { count: activePending } = await baseQuery();
  const { count: duePending } = await baseQuery().lte('scheduled_for', referenceAt);

  const { data: oldestDueRows } = await supabase
    .from('pending_outbound')
    .select('scheduled_for')
    .eq('tenant_id', tenantId)
    .is('sent_at', null)
    .is('failed_at', null)
    .lte('scheduled_for', referenceAt)
    .order('scheduled_for', { ascending: true })
    .limit(1);

  const { data: nextRows } = await supabase
    .from('pending_outbound')
    .select('scheduled_for')
    .eq('tenant_id', tenantId)
    .is('sent_at', null)
    .is('failed_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(1);

  const { data: queueRows } = await supabase
    .from('pending_outbound')
    .select('id, conversation_id, message_type, scheduled_for, attempts')
    .eq('tenant_id', tenantId)
    .is('sent_at', null)
    .is('failed_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(5);

  const rows = queueRows || [];
  const conversationIds = Array.from(
    new Set(rows.map((row: any) => row.conversation_id).filter(Boolean)),
  );
  const conversationLead = new Map<string, string>();

  if (conversationIds.length > 0) {
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id, lead_id')
      .in('id', conversationIds);
    for (const row of conversations || []) {
      if (row.id && row.lead_id) conversationLead.set(row.id, row.lead_id);
    }
  }

  const leadIds = Array.from(new Set(Array.from(conversationLead.values())));
  const leads = new Map<string, any>();

  if (leadIds.length > 0) {
    const { data: leadRows } = await supabase
      .from('leads')
      .select('id, name, whatsapp')
      .in('id', leadIds);
    for (const lead of leadRows || []) {
      leads.set(lead.id, lead);
    }
  }

  return {
    activePending: activePending ?? null,
    duePending: duePending ?? null,
    oldestDueAt: oldestDueRows?.[0]?.scheduled_for || null,
    nextScheduledFor: nextRows?.[0]?.scheduled_for || null,
    sample: rows.map((row: any) => {
      const lead = leads.get(conversationLead.get(row.conversation_id) || '');
      return {
        scheduled_for: row.scheduled_for,
        message_type: row.message_type,
        attempts: row.attempts,
        lead_name: lead?.name || null,
        lead_whatsapp: lead?.whatsapp || null,
      };
    }),
  };
}

async function loadRecentConnectionLogs(
  supabase: SupabaseLike,
  tenantId: string,
  referenceAt: string,
) {
  const ref = new Date(referenceAt);
  const since = new Date(ref.getTime() - 10 * 60 * 1000).toISOString();
  const until = new Date(ref.getTime() + 60 * 1000).toISOString();

  const { data } = await supabase
    .from('whatsapp_connection_events')
    .select(
      'created_at, event_type, external_state, reason_code, raw_error_redacted, local_status_before, local_status_after, pending_due_count',
    )
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .lte('created_at', until)
    .order('created_at', { ascending: true })
    .limit(12);

  return data || [];
}

async function buildDisconnectMessage(params: {
  tenant: any;
  event: any | null;
  reasonCode: string;
  externalState?: string | null;
  source: string;
  pendingDueCount?: number | null;
  recentMessages: any[];
  connectionLogs: any[];
  queueImpact?: any | null;
}) {
  return buildAdminDisconnectAlertMessage({
    tenant: params.tenant,
    event: params.event,
    reasonCode: params.reasonCode,
    externalState: params.externalState,
    source: params.source,
    pendingDueCount: params.pendingDueCount ?? params.event?.pending_due_count ?? null,
    recentMessages: params.recentMessages,
    connectionLogs: params.connectionLogs,
    queueImpact: params.queueImpact || null,
  });
}

export async function dispatchAdminDisconnectAlert(params: DisconnectAlertParams) {
  const event = await loadConnectionEvent(params.supabase, params.connectionEventId);
  const eventAt = event?.created_at || new Date().toISOString();
  const tenant = await loadTenant(params.supabase, params.tenantId);
  const recentMessages = await loadRecentMessages(params.supabase, params.tenantId, eventAt);
  const connectionLogs = await loadRecentConnectionLogs(params.supabase, params.tenantId, eventAt);
  const queueImpact = await loadQueueImpact(params.supabase, params.tenantId, eventAt);
  const externalState = params.externalState ?? event?.external_state ?? null;
  const incident = await openOrTouchDisconnectIncident(params, eventAt, externalState);
  const incidentKey = incident.incident_key;

  const recipients = await loadRecipients(params.supabase);
  if (recipients.length === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: 0,
      reason: 'NO_ACTIVE_RECIPIENTS',
      incident_id: incident.id,
      incident_key: incidentKey,
    };
  }

  if (incident.alert_sent_at) {
    return {
      sent: 0,
      failed: 0,
      skipped: recipients.length,
      reason: 'INCIDENT_ALREADY_ALERTED',
      incident_id: incident.id,
      incident_key: incidentKey,
    };
  }

  const built = await buildDisconnectMessage({
    tenant,
    event,
    reasonCode: params.reasonCode,
    externalState,
    source: params.source,
    pendingDueCount: params.pendingDueCount ?? event?.pending_due_count ?? null,
    recentMessages,
    connectionLogs,
    queueImpact,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const { data: existing } = await params.supabase
      .from('admin_disconnect_alert_deliveries')
      .select('id, status')
      .eq('incident_key', incidentKey)
      .eq('recipient_id', recipient.id)
      .maybeSingle();

    if (existing?.id) {
      skipped++;
      continue;
    }

    const deliveryId = uuid();
    const insertPayload: Record<string, unknown> = {
      id: deliveryId,
      connection_event_id: params.connectionEventId || null,
      operational_alert_id: params.operationalAlertId || null,
      tenant_id: params.tenantId,
      recipient_id: recipient.id,
      incident_key: incidentKey,
      status: 'PENDING',
      reason_code: canonicalReasonCode(params.reasonCode),
      external_state: externalState,
      ai_summary: built.summary,
      message_body: built.body,
    };
    if (incident.id) insertPayload.disconnect_incident_id = incident.id;

    const { error: insertError } = await params.supabase
      .from('admin_disconnect_alert_deliveries')
      .insert(insertPayload);

    if (insertError) {
      if (insertError.code === '23505') {
        skipped++;
      } else {
        failed++;
      }
      continue;
    }

    const result = await sendAdminMonitoringWhatsApp(
      recipient.whatsapp,
      built.body,
      params.supabase,
    );
    await params.supabase
      .from('admin_disconnect_alert_deliveries')
      .update({
        channel_id: result.channelId || null,
        status: result.ok ? 'SENT' : 'FAILED',
        sent_at: result.ok ? new Date().toISOString() : null,
        whatsapp_message_id: result.whatsappMessageId || null,
        error: result.error || null,
        ai_summary: built.summary,
        message_body: built.body,
      })
      .eq('id', deliveryId);

    if (result.ok) sent++;
    else failed++;
  }

  await markDisconnectIncidentAlertAttempted(params.supabase, incident, {
    sent,
    failed,
    lastError: failed > 0 && sent === 0 ? 'ADMIN_DISCONNECT_ALERT_SEND_FAILED' : null,
  });

  return { sent, failed, skipped, incident_id: incident.id, incident_key: incidentKey };
}

export async function dispatchAdminRecoveryStructuralAlert(params: RecoveryStructuralAlertParams) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId || !params.reasonCode) {
    return { sent: 0, failed: 0, skipped: 0, reason: 'NOT_ACTIONABLE' };
  }

  const recipients = await loadRecipients(params.supabase);
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, reason: 'NO_ACTIVE_RECIPIENTS' };
  }

  const now = new Date();
  const referenceAt = now.toISOString();
  const alertBucket = referenceAt.slice(0, 13);
  const incidentKey = `recovery_structural:${tenantId}:${params.reasonCode}:${alertBucket}`;
  const tenant = await loadTenant(params.supabase, tenantId);
  const queueImpact = await loadQueueImpact(params.supabase, tenantId, referenceAt);
  const recentOutboundMessages = await loadRecentOutboundMessages(
    params.supabase,
    tenantId,
    referenceAt,
  );
  const operationalAlertId = await createOrLoadRecoveryStructuralOperationalAlert(
    params,
    incidentKey,
  );
  const built = buildAdminRecoveryStructuralAlertMessage({
    tenant,
    reasonCode: params.reasonCode,
    structuralReason: params.structuralReason,
    details: params.details || null,
    source: params.source,
    createdAt: referenceAt,
    pendingDueCount: params.pendingDueCount ?? queueImpact.duePending ?? null,
    recentOutboundMessages,
    queueImpact,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const { data: existing } = await params.supabase
      .from('admin_ai_activity_alert_deliveries')
      .select('id, status')
      .eq('incident_key', incidentKey)
      .eq('recipient_id', recipient.id)
      .maybeSingle();

    if (existing?.status === 'SENT') {
      skipped++;
      continue;
    }

    const deliveryId = existing?.id || uuid();
    if (!existing?.id) {
      const { error: insertError } = await params.supabase
        .from('admin_ai_activity_alert_deliveries')
        .insert({
          id: deliveryId,
          operational_alert_id: operationalAlertId,
          tenant_id: tenantId,
          recipient_id: recipient.id,
          incident_key: incidentKey,
          status: 'PENDING',
          activity_state: 'BLOCKED',
          severity: 'CRITICAL',
          ai_summary: built.summary,
          message_body: built.body,
        });

      if (insertError) {
        console.warn(
          '[admin-monitoring] failed to insert RECOVERY structural alert delivery',
          insertError,
        );
        failed++;
        continue;
      }
    }

    const result = await sendAdminMonitoringWhatsApp(
      recipient.whatsapp,
      built.body,
      params.supabase,
    );
    await params.supabase
      .from('admin_ai_activity_alert_deliveries')
      .update({
        channel_id: result.channelId || null,
        status: result.ok ? 'SENT' : 'FAILED',
        sent_at: result.ok ? new Date().toISOString() : null,
        whatsapp_message_id: result.whatsappMessageId || null,
        error: result.error || null,
        ai_summary: built.summary,
        message_body: built.body,
      })
      .eq('id', deliveryId);

    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed, skipped };
}

export async function dispatchAdminAiActivityAlert(params: AiActivityAlertParams) {
  const state = String(params.activity.state || '').toUpperCase();
  const tenantId = String(params.activity.tenant_id || '');
  if (!tenantId || !['BLOCKED', 'STALLED'].includes(state)) {
    return { sent: 0, failed: 0, skipped: 0, reason: 'NOT_ACTIONABLE' };
  }

  if (await hasOpenAdminDisconnectIncident(params.supabase, tenantId)) {
    return {
      sent: 0,
      failed: 0,
      skipped: 1,
      reason: 'SUPPRESSED_OPEN_DISCONNECT_INCIDENT',
    };
  }

  const recipients = await loadRecipients(params.supabase);
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, reason: 'NO_ACTIVE_RECIPIENTS' };
  }

  const now = new Date();
  const incidentKey = buildAiActivityIncidentKey(tenantId, state, params.activity);
  const tenant = await loadTenant(params.supabase, tenantId);
  const operationalAlertId = await createOrLoadAiActivityOperationalAlert(params, incidentKey);
  const built = buildAdminAiActivityAlertMessage({
    tenant,
    activity: params.activity,
    source: params.source,
    createdAt: now.toISOString(),
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const { data: existing } = await params.supabase
      .from('admin_ai_activity_alert_deliveries')
      .select('id, status')
      .eq('incident_key', incidentKey)
      .eq('recipient_id', recipient.id)
      .maybeSingle();

    if (existing?.status === 'SENT') {
      skipped++;
      continue;
    }

    const deliveryId = existing?.id || uuid();
    if (!existing?.id) {
      const { error: insertError } = await params.supabase
        .from('admin_ai_activity_alert_deliveries')
        .insert({
          id: deliveryId,
          operational_alert_id: operationalAlertId,
          tenant_id: tenantId,
          recipient_id: recipient.id,
          incident_key: incidentKey,
          status: 'PENDING',
          activity_state: state,
          severity: state === 'BLOCKED' ? 'CRITICAL' : 'ATTENTION',
          ai_summary: built.summary,
          message_body: built.body,
        });

      if (insertError) {
        console.warn('[admin-monitoring] failed to insert AI activity alert delivery', insertError);
        failed++;
        continue;
      }
    }

    const result = await sendAdminMonitoringWhatsApp(
      recipient.whatsapp,
      built.body,
      params.supabase,
    );
    await params.supabase
      .from('admin_ai_activity_alert_deliveries')
      .update({
        channel_id: result.channelId || null,
        status: result.ok ? 'SENT' : 'FAILED',
        sent_at: result.ok ? new Date().toISOString() : null,
        whatsapp_message_id: result.whatsappMessageId || null,
        error: result.error || null,
        ai_summary: built.summary,
        message_body: built.body,
      })
      .eq('id', deliveryId);

    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed, skipped };
}
