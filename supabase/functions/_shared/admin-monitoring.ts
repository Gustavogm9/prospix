import { buildAdminDisconnectAlertMessage } from "./admin-message-formatters.ts";

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

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_EVOLUTION_BASE_URL = "https://evolution-evolution-api.qr4jgl.easypanel.host";

function uuid(): string {
  return crypto.randomUUID();
}

function cleanText(value: unknown, max = 600): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeWhatsAppNumber(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeBaseUrl(value: string | null | undefined): string {
  return String(value || "").replace(/\/+$/, "");
}

function getAdminMonitoringApiKey(): string {
  return Deno.env.get("ADMIN_REPORT_EVOLUTION_API_KEY") || Deno.env.get("EVOLUTION_GUILDS_API_KEY") || "";
}

function getDefaultAdminBaseUrl(): string {
  return normalizeBaseUrl(
    Deno.env.get("ADMIN_REPORT_EVOLUTION_BASE_URL")
      || Deno.env.get("EVOLUTION_BASE_URL")
      || DEFAULT_EVOLUTION_BASE_URL,
  );
}

async function loadActiveAdminMonitoringChannel(
  supabase?: SupabaseLike,
): Promise<AdminMonitoringChannelRow | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("admin_monitoring_channels")
    .select([
      "id",
      "label",
      "evolution_base_url",
      "evolution_instance_name",
      "active",
      "connection_status",
      "external_state",
      "last_qr_requested_at",
      "connected_at",
      "disconnected_at",
      "last_checked_at",
      "last_error",
    ].join(", "))
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[admin-monitoring] failed to load admin channel", error);
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
      instanceName: row.evolution_instance_name || "",
      apiKey,
      configured: Boolean(baseUrl && row.evolution_instance_name && apiKey),
      source: "admin_monitoring_channels",
      connectionStatus: row.connection_status || "UNKNOWN",
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
    instanceName: "",
    apiKey,
    configured: false,
    source: "NO_ACTIVE_ADMIN_MONITORING_CHANNEL",
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
    connected: channel.connectionStatus === "CONNECTED",
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
    reason: channel.channelId ? null : "NO_ACTIVE_ADMIN_MONITORING_CHANNEL",
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
        ? "ADMIN_MONITORING_CHANNEL_INCOMPLETE"
        : "ADMIN_MONITORING_CHANNEL_NOT_CONNECTED",
    };
  }

  const number = normalizeWhatsAppNumber(to);
  if (number.length < 10) {
    return {
      ok: false,
      channelId: channel.channelId,
      channelInstanceName: channel.instanceName || null,
      error: "INVALID_RECIPIENT_WHATSAPP",
    };
  }

  try {
    const response = await fetch(`${channel.baseUrl}/message/sendText/${channel.instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return params.fallback;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("ADMIN_MONITORING_OPENAI_MODEL") || "gpt-4o-mini",
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
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
    .from("admin_monitoring_recipients")
    .select("id, label, whatsapp")
    .eq("active", true)
    .eq("disconnect_alerts_enabled", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[admin-monitoring] failed to load recipients", error);
    return [];
  }

  return (data || []) as Recipient[];
}

async function loadTenant(supabase: SupabaseLike, tenantId: string) {
  const { data } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("id", tenantId)
    .maybeSingle();
  return data || { id: tenantId, name: tenantId, slug: null };
}

async function loadConnectionEvent(supabase: SupabaseLike, eventId?: string | null) {
  if (!eventId) return null;
  const { data } = await supabase
    .from("whatsapp_connection_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  return data || null;
}

async function loadRecentMessages(supabase: SupabaseLike, tenantId: string, referenceAt: string) {
  const ref = new Date(referenceAt);
  const since = new Date(ref.getTime() - 5 * 60 * 60 * 1000).toISOString();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, conversation_id, direction, sender, content, delivery_status, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .lte("created_at", referenceAt)
    .order("created_at", { ascending: false })
    .limit(12);

  const rows = messages || [];
  const conversationIds = Array.from(new Set(rows.map((m: any) => m.conversation_id).filter(Boolean)));
  const conversationLead = new Map<string, string>();

  if (conversationIds.length > 0) {
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, lead_id")
      .in("id", conversationIds);
    for (const row of conversations || []) {
      if (row.id && row.lead_id) conversationLead.set(row.id, row.lead_id);
    }
  }

  const leadIds = Array.from(new Set(Array.from(conversationLead.values())));
  const leads = new Map<string, any>();

  if (leadIds.length > 0) {
    const { data: leadRows } = await supabase
      .from("leads")
      .select("id, name, whatsapp")
      .in("id", leadIds);
    for (const lead of leadRows || []) {
      leads.set(lead.id, lead);
    }
  }

  return rows.reverse().map((message: any) => {
    const lead = leads.get(conversationLead.get(message.conversation_id) || "");
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

async function loadRecentConnectionLogs(supabase: SupabaseLike, tenantId: string, referenceAt: string) {
  const ref = new Date(referenceAt);
  const since = new Date(ref.getTime() - 10 * 60 * 1000).toISOString();
  const until = new Date(ref.getTime() + 60 * 1000).toISOString();

  const { data } = await supabase
    .from("whatsapp_connection_events")
    .select("created_at, event_type, external_state, reason_code, raw_error_redacted, local_status_before, local_status_after, pending_due_count")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .lte("created_at", until)
    .order("created_at", { ascending: true })
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
  });
}

export async function dispatchAdminDisconnectAlert(params: DisconnectAlertParams) {
  const recipients = await loadRecipients(params.supabase);
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, reason: "NO_ACTIVE_RECIPIENTS" };
  }

  const event = await loadConnectionEvent(params.supabase, params.connectionEventId);
  const eventAt = event?.created_at || new Date().toISOString();
  const tenant = await loadTenant(params.supabase, params.tenantId);
  const recentMessages = await loadRecentMessages(params.supabase, params.tenantId, eventAt);
  const connectionLogs = await loadRecentConnectionLogs(params.supabase, params.tenantId, eventAt);
  const incidentKey = params.connectionEventId
    ? `connection_event:${params.connectionEventId}`
    : `tenant:${params.tenantId}:${params.reasonCode}:${eventAt.slice(0, 16)}`;

  const built = await buildDisconnectMessage({
    tenant,
    event,
    reasonCode: params.reasonCode,
    externalState: params.externalState ?? event?.external_state ?? null,
    source: params.source,
    pendingDueCount: params.pendingDueCount ?? event?.pending_due_count ?? null,
    recentMessages,
    connectionLogs,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const { data: existing } = await params.supabase
      .from("admin_disconnect_alert_deliveries")
      .select("id, status")
      .eq("incident_key", incidentKey)
      .eq("recipient_id", recipient.id)
      .maybeSingle();

    if (existing?.status === "SENT") {
      skipped++;
      continue;
    }

    const deliveryId = existing?.id || uuid();
    if (!existing?.id) {
      const { error: insertError } = await params.supabase
        .from("admin_disconnect_alert_deliveries")
        .insert({
          id: deliveryId,
          connection_event_id: params.connectionEventId || null,
          operational_alert_id: params.operationalAlertId || null,
          tenant_id: params.tenantId,
          recipient_id: recipient.id,
          incident_key: incidentKey,
          status: "PENDING",
          reason_code: params.reasonCode,
          external_state: params.externalState ?? event?.external_state ?? null,
          ai_summary: built.summary,
          message_body: built.body,
        });

      if (insertError) {
        failed++;
        continue;
      }
    }

    const result = await sendAdminMonitoringWhatsApp(recipient.whatsapp, built.body, params.supabase);
    await params.supabase
      .from("admin_disconnect_alert_deliveries")
      .update({
        channel_id: result.channelId || null,
        status: result.ok ? "SENT" : "FAILED",
        sent_at: result.ok ? new Date().toISOString() : null,
        whatsapp_message_id: result.whatsappMessageId || null,
        error: result.error || null,
        ai_summary: built.summary,
        message_body: built.body,
      })
      .eq("id", deliveryId);

    if (result.ok) sent++;
    else failed++;
  }

  return { sent, failed, skipped };
}
