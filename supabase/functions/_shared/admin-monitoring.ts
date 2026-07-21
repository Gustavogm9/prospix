type SupabaseLike = any;

type Recipient = {
  id: string;
  label: string;
  whatsapp: string;
};

type SendResult = {
  ok: boolean;
  whatsappMessageId?: string | null;
  error?: string | null;
};

type AdminChannel = {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  configured: boolean;
  source: string;
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

function formatBrt(value: string | Date | null | undefined): string {
  if (!value) return "desconhecido";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "desconhecido";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function getAdminChannel(): AdminChannel {
  const adminBaseUrl = Deno.env.get("ADMIN_REPORT_EVOLUTION_BASE_URL");
  const adminInstance = Deno.env.get("ADMIN_REPORT_EVOLUTION_INSTANCE_NAME");
  const adminApiKey = Deno.env.get("ADMIN_REPORT_EVOLUTION_API_KEY");

  if (adminBaseUrl && adminInstance && adminApiKey) {
    return {
      baseUrl: adminBaseUrl.replace(/\/+$/, ""),
      instanceName: adminInstance,
      apiKey: adminApiKey,
      configured: true,
      source: "ADMIN_REPORT_EVOLUTION_*",
    };
  }

  const fallbackBaseUrl = Deno.env.get("EVOLUTION_BASE_URL") || DEFAULT_EVOLUTION_BASE_URL;
  const fallbackInstance = Deno.env.get("EVOLUTION_GUILDS_INSTANCE");
  const fallbackApiKey = Deno.env.get("EVOLUTION_GUILDS_API_KEY");

  return {
    baseUrl: fallbackBaseUrl.replace(/\/+$/, ""),
    instanceName: fallbackInstance || "",
    apiKey: fallbackApiKey || "",
    configured: Boolean(fallbackInstance && fallbackApiKey),
    source: "EVOLUTION_GUILDS_*",
  };
}

export function getAdminMonitoringChannelStatus() {
  const channel = getAdminChannel();
  return {
    configured: channel.configured,
    source: channel.source,
    instanceName: channel.instanceName || null,
    baseUrlConfigured: Boolean(channel.baseUrl),
  };
}

export async function sendAdminMonitoringWhatsApp(to: string, text: string): Promise<SendResult> {
  const channel = getAdminChannel();
  if (!channel.configured) {
    return {
      ok: false,
      error: "ADMIN_MONITORING_CHANNEL_NOT_CONFIGURED",
    };
  }

  const number = normalizeWhatsAppNumber(to);
  if (number.length < 10) {
    return {
      ok: false,
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
        error: `HTTP ${response.status}: ${bodyText.slice(0, 240)}`,
      };
    }

    return {
      ok: true,
      whatsappMessageId: body?.key?.id || body?.messageId || null,
    };
  } catch (err: any) {
    return {
      ok: false,
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

function buildDisconnectFallbackSummary(params: {
  tenantName: string;
  reasonCode: string;
  externalState?: string | null;
  recentMessages: any[];
  pendingDueCount?: number | null;
}) {
  const sent = params.recentMessages.filter((m) => m.direction === "OUTBOUND").length;
  const inbound = params.recentMessages.filter((m) => m.direction === "INBOUND").length;
  return [
    `Queda detectada no tenant ${params.tenantName}.`,
    `Motivo tecnico: ${params.reasonCode}. Estado externo: ${params.externalState || "desconhecido"}.`,
    `Janela de 5h antes do evento: ${sent} mensagens outbound e ${inbound} inbound registradas.`,
    params.pendingDueCount == null ? null : `Fila pendente no momento: ${params.pendingDueCount}.`,
  ].filter(Boolean).join(" ");
}

async function buildDisconnectMessage(params: {
  tenant: any;
  event: any | null;
  reasonCode: string;
  externalState?: string | null;
  source: string;
  pendingDueCount?: number | null;
  recentMessages: any[];
}) {
  const eventAt = params.event?.created_at || new Date().toISOString();
  const fallback = buildDisconnectFallbackSummary({
    tenantName: params.tenant?.name || params.tenant?.id || "tenant desconhecido",
    reasonCode: params.reasonCode,
    externalState: params.externalState,
    recentMessages: params.recentMessages,
    pendingDueCount: params.pendingDueCount ?? params.event?.pending_due_count ?? null,
  });

  const summary = await summarizeWithExistingAI({
    systemPrompt: [
      "Voce e um operador senior de monitoramento do Prospix.",
      "Resuma um incidente de queda de WhatsApp para administradores.",
      "Seja objetivo, factual, sem especular causa fora dos dados.",
      "Inclua risco operacional e acao imediata recomendada em no maximo 5 frases.",
    ].join(" "),
    userPrompt: JSON.stringify({
      tenant: params.tenant,
      event: params.event,
      reason_code: params.reasonCode,
      external_state: params.externalState,
      source: params.source,
      pending_due_count: params.pendingDueCount ?? params.event?.pending_due_count ?? null,
      recent_messages: params.recentMessages,
    }),
    fallback,
    maxTokens: 240,
  });

  const messageLines = params.recentMessages.slice(-8).map((message) => {
    const phone = message.lead_whatsapp || "sem numero";
    const who = message.direction === "OUTBOUND" ? "IA/OUT" : "LEAD/IN";
    return `- ${formatBrt(message.created_at)} ${who} ${phone}: ${message.content_preview || "(sem texto)"}`;
  });

  const body = [
    "[PROSPIX] WhatsApp desconectado",
    `Tenant: ${params.tenant?.name || params.tenant?.id || "desconhecido"}`,
    `Quando: ${formatBrt(eventAt)}`,
    `Motivo: ${params.reasonCode}`,
    `Estado externo: ${params.externalState || params.event?.external_state || "desconhecido"}`,
    `Origem: ${params.source}`,
    `Pendentes no momento: ${params.pendingDueCount ?? params.event?.pending_due_count ?? "n/d"}`,
    "",
    "Resumo IA:",
    summary,
    "",
    "Ultimas mensagens registradas:",
    messageLines.length > 0 ? messageLines.join("\n") : "- Nenhuma mensagem encontrada nas 5h anteriores.",
  ].join("\n");

  return { summary, body };
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

    const result = await sendAdminMonitoringWhatsApp(recipient.whatsapp, built.body);
    await params.supabase
      .from("admin_disconnect_alert_deliveries")
      .update({
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
