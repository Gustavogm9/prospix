// supabase/functions/admin-monitoring-dispatcher/index.ts
// Admin monitoring dispatcher: periodic reports, manual runs, test messages,
// and explicit disconnect alert dispatch.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dispatchAdminDisconnectAlert,
  getAdminMonitoringChannelStatus,
  sendAdminMonitoringWhatsApp,
  summarizeWithExistingAI,
} from "../_shared/admin-monitoring.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

type Schedule = {
  id: string;
  name: string;
  recipient_id: string;
  active: boolean;
  interval_minutes: number;
  window_minutes: number;
  timezone: string;
  tenant_ids: string[] | null;
  include_numbers: boolean;
  include_recent_messages: boolean;
};

type Recipient = {
  id: string;
  label: string;
  whatsapp: string;
  active: boolean;
  report_enabled: boolean;
};

type CountResult = {
  value: number;
  error?: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max = 500): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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
  }).format(date);
}

function scopedTenantIds(schedule: Schedule): string[] {
  return Array.isArray(schedule.tenant_ids)
    ? schedule.tenant_ids.filter((id) => typeof id === "string" && id.length > 0)
    : [];
}

function applyTenantScope(query: any, schedule: Schedule) {
  const tenantIds = scopedTenantIds(schedule);
  return tenantIds.length > 0 ? query.in("tenant_id", tenantIds) : query;
}

async function safeCount(
  label: string,
  table: string,
  build: (query: any) => any,
): Promise<CountResult> {
  try {
    const query = build(supabase.from(table).select("id", { count: "exact", head: true }));
    const { count, error } = await query;
    if (error) return { value: 0, error: `${label}: ${error.message}` };
    return { value: count || 0, error: null };
  } catch (err: any) {
    return { value: 0, error: `${label}: ${cleanText(err?.message || err, 200)}` };
  }
}

async function loadSchedule(scheduleId: string): Promise<Schedule | null> {
  const { data, error } = await supabase
    .from("admin_monitoring_schedules")
    .select("*")
    .eq("id", scheduleId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as Schedule | null;
}

async function loadRecipient(recipientId: string): Promise<Recipient | null> {
  const { data, error } = await supabase
    .from("admin_monitoring_recipients")
    .select("id, label, whatsapp, active, report_enabled")
    .eq("id", recipientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as Recipient | null;
}

async function loadTenants(schedule: Schedule) {
  let query = supabase
    .from("tenants")
    .select("id, name, slug, status")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  const tenantIds = scopedTenantIds(schedule);
  if (tenantIds.length > 0) query = query.in("id", tenantIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadRecentMessages(schedule: Schedule, periodStart: string, periodEnd: string) {
  if (!schedule.include_recent_messages) return [];

  let query = supabase
    .from("messages")
    .select("id, tenant_id, conversation_id, direction, sender, content, delivery_status, created_at")
    .gte("created_at", periodStart)
    .lte("created_at", periodEnd)
    .order("created_at", { ascending: false })
    .limit(20);

  query = applyTenantScope(query, schedule);
  const { data: messages, error } = await query;
  if (error) return [];

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
    for (const lead of leadRows || []) leads.set(lead.id, lead);
  }

  return rows.reverse().map((message: any) => {
    const lead = leads.get(conversationLead.get(message.conversation_id) || "");
    return {
      created_at: message.created_at,
      tenant_id: message.tenant_id,
      direction: message.direction,
      sender: message.sender,
      delivery_status: message.delivery_status,
      lead_name: lead?.name || null,
      lead_whatsapp: schedule.include_numbers ? lead?.whatsapp || null : null,
      content_preview: cleanText(message.content, 180),
    };
  });
}

async function collectMetrics(schedule: Schedule, periodStart: string, periodEnd: string) {
  const tenants = await loadTenants(schedule);
  const counts: Record<string, CountResult> = {
    leadsCreated: await safeCount("leadsCreated", "leads", (q) =>
      applyTenantScope(q.gte("created_at", periodStart).lte("created_at", periodEnd).is("deleted_at", null), schedule)
    ),
    conversationsStarted: await safeCount("conversationsStarted", "conversations", (q) =>
      applyTenantScope(q.gte("started_at", periodStart).lte("started_at", periodEnd), schedule)
    ),
    activeConversations: await safeCount("activeConversations", "conversations", (q) =>
      applyTenantScope(q.eq("status", "ACTIVE"), schedule)
    ),
    inboundMessages: await safeCount("inboundMessages", "messages", (q) =>
      applyTenantScope(q.eq("direction", "INBOUND").gte("created_at", periodStart).lte("created_at", periodEnd), schedule)
    ),
    outboundMessages: await safeCount("outboundMessages", "messages", (q) =>
      applyTenantScope(q.eq("direction", "OUTBOUND").gte("created_at", periodStart).lte("created_at", periodEnd), schedule)
    ),
    pendingDue: await safeCount("pendingDue", "pending_outbound", (q) =>
      applyTenantScope(q.is("sent_at", null).is("failed_at", null).lte("scheduled_for", periodEnd), schedule)
    ),
    connectionEvents: await safeCount("connectionEvents", "whatsapp_connection_events", (q) =>
      applyTenantScope(q.gte("created_at", periodStart).lte("created_at", periodEnd), schedule)
    ),
    criticalConnectionEvents: await safeCount("criticalConnectionEvents", "whatsapp_connection_events", (q) =>
      applyTenantScope(
        q
          .gte("created_at", periodStart)
          .lte("created_at", periodEnd)
          .in("reason_code", [
            "WA_DEVICE_REMOVED",
            "WA_STREAM_ERRORED",
            "WA_SESSION_CONFLICT",
            "WA_UNAUTHORIZED",
            "SEND_CRITICAL_DEVICE_REMOVED",
            "SEND_CRITICAL_STREAM_ERRORED",
            "SEND_CRITICAL_SESSION_CONFLICT",
            "SEND_CRITICAL_UNAUTHORIZED",
            "SEND_CRITICAL_CONNECTION_CLOSED",
            "SEND_CRITICAL_INSTANCE_NOT_FOUND",
          ]),
        schedule,
      )
    ),
  };

  let guardianQuery = supabase
    .from("whatsapp_guardian_status")
    .select("tenant_id, status, external_state, last_disconnect_reason_code, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20);
  guardianQuery = applyTenantScope(guardianQuery, schedule);
  const { data: guardianStatus, error: guardianError } = await guardianQuery;

  const recentMessages = await loadRecentMessages(schedule, periodStart, periodEnd);
  const errors = [
    ...Object.values(counts).map((count) => count.error).filter(Boolean),
    guardianError ? `guardianStatus: ${guardianError.message}` : null,
  ].filter(Boolean);

  return {
    period: { start: periodStart, end: periodEnd },
    tenantScope: scopedTenantIds(schedule).length > 0 ? "selected" : "all_active",
    tenants: tenants.map((tenant: any) => ({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
    })),
    counts: Object.fromEntries(Object.entries(counts).map(([key, result]) => [key, result.value])),
    guardianStatus: guardianStatus || [],
    recentMessages,
    errors,
  };
}

function buildFallbackSummary(metrics: any): string {
  const counts = metrics.counts || {};
  return [
    `Janela com ${counts.leadsCreated || 0} leads captados, ${counts.conversationsStarted || 0} conversas iniciadas e ${counts.outboundMessages || 0} mensagens outbound.`,
    `Fila pendente vencida: ${counts.pendingDue || 0}. Eventos de conexao WhatsApp: ${counts.connectionEvents || 0}, criticos: ${counts.criticalConnectionEvents || 0}.`,
    metrics.errors?.length ? `Coleta parcial: ${metrics.errors.length} erro(s) tecnicos registrados no run.` : "Coleta concluida sem erro tecnico reportado.",
  ].join(" ");
}

async function buildReportMessage(schedule: Schedule, metrics: any) {
  const fallback = buildFallbackSummary(metrics);
  const aiSummary = await summarizeWithExistingAI({
    systemPrompt: [
      "Voce e um operador senior de monitoramento administrativo do Prospix.",
      "Resuma captacao, conversas, fila e saude do WhatsApp para administradores.",
      "Use somente os dados fornecidos, sem inferir causa ou diagnostico fora das evidencias.",
      "Seja conciso, factual e aponte risco operacional imediato quando existir.",
    ].join(" "),
    userPrompt: JSON.stringify({
      schedule: {
        id: schedule.id,
        name: schedule.name,
        interval_minutes: schedule.interval_minutes,
        window_minutes: schedule.window_minutes,
        include_numbers: schedule.include_numbers,
      },
      metrics,
    }),
    fallback,
    maxTokens: 260,
  });

  const counts = metrics.counts || {};
  const tenantNames = (metrics.tenants || []).slice(0, 8).map((t: any) => t.name || t.slug || t.id).join(", ");
  const guardianLines = (metrics.guardianStatus || []).slice(0, 6).map((row: any) =>
    `- ${row.tenant_id}: ${row.status || "n/d"} / ${row.external_state || "sem estado"} / ${row.last_disconnect_reason_code || "sem motivo"}`
  );
  const messageLines = (metrics.recentMessages || []).slice(-8).map((message: any) => {
    const phone = schedule.include_numbers ? message.lead_whatsapp || "sem numero" : "numero oculto";
    const who = message.direction === "OUTBOUND" ? "IA/OUT" : "LEAD/IN";
    return `- ${formatBrt(message.created_at)} ${who} ${phone}: ${message.content_preview || "(sem texto)"}`;
  });

  const body = [
    "[PROSPIX] Relatorio administrativo",
    `Agenda: ${schedule.name}`,
    `Janela: ${formatBrt(metrics.period.start)} ate ${formatBrt(metrics.period.end)}`,
    `Escopo: ${metrics.tenantScope === "selected" ? tenantNames || "tenants selecionados" : "todos os tenants ativos"}`,
    "",
    "Resumo IA:",
    aiSummary,
    "",
    "Metricas:",
    `- Leads captados: ${counts.leadsCreated || 0}`,
    `- Conversas iniciadas: ${counts.conversationsStarted || 0}`,
    `- Conversas ativas: ${counts.activeConversations || 0}`,
    `- Mensagens inbound/outbound: ${counts.inboundMessages || 0}/${counts.outboundMessages || 0}`,
    `- Fila pendente vencida: ${counts.pendingDue || 0}`,
    `- Eventos WhatsApp totais/criticos: ${counts.connectionEvents || 0}/${counts.criticalConnectionEvents || 0}`,
    "",
    "Saude WhatsApp:",
    guardianLines.length ? guardianLines.join("\n") : "- Sem status guardian registrado no escopo.",
    "",
    "Ultimas mensagens:",
    messageLines.length ? messageLines.join("\n") : "- Sem mensagens recentes na janela ou exibicao desativada.",
    metrics.errors?.length ? `\nErros de coleta: ${metrics.errors.join(" | ").slice(0, 700)}` : "",
  ].filter((line) => line !== "").join("\n");

  return { aiSummary, body };
}

async function createRun(schedule: Schedule, recipient: Recipient, periodStart: string, periodEnd: string) {
  const { data, error } = await supabase
    .from("admin_monitoring_report_runs")
    .insert({
      schedule_id: schedule.id,
      recipient_id: recipient.id,
      status: "RUNNING",
      period_start: periodStart,
      period_end: periodEnd,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

async function completeRun(runId: string, status: "SENT" | "FAILED" | "SKIPPED", patch: Record<string, unknown>) {
  await supabase
    .from("admin_monitoring_report_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", runId);
}

async function processSchedule(schedule: Schedule, source: string) {
  const recipient = await loadRecipient(schedule.recipient_id);
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - Math.max(5, schedule.window_minutes) * 60 * 1000).toISOString();

  if (!recipient || !recipient.active || !recipient.report_enabled) {
    const inactiveRecipient = recipient || { id: schedule.recipient_id } as Recipient;
    const runId = await createRun(schedule, inactiveRecipient, periodStart, periodEnd);
    await completeRun(runId, "SKIPPED", {
      error: "RECIPIENT_INACTIVE_OR_NOT_FOUND",
      metrics: { source },
    });
    await supabase
      .from("admin_monitoring_schedules")
      .update({ last_error: "RECIPIENT_INACTIVE_OR_NOT_FOUND" })
      .eq("id", schedule.id);
    return { schedule_id: schedule.id, status: "SKIPPED", error: "RECIPIENT_INACTIVE_OR_NOT_FOUND" };
  }

  const runId = await createRun(schedule, recipient, periodStart, periodEnd);

  try {
    const metrics = await collectMetrics(schedule, periodStart, periodEnd);
    const built = await buildReportMessage(schedule, metrics);
    const result = await sendAdminMonitoringWhatsApp(recipient.whatsapp, built.body);

    await completeRun(runId, result.ok ? "SENT" : "FAILED", {
      metrics,
      ai_summary: built.aiSummary,
      message_body: built.body,
      whatsapp_message_id: result.whatsappMessageId || null,
      error: result.error || null,
    });

    await supabase
      .from("admin_monitoring_schedules")
      .update({
        last_success_at: result.ok ? new Date().toISOString() : null,
        last_error: result.ok ? null : result.error || "SEND_FAILED",
      })
      .eq("id", schedule.id);

    return {
      schedule_id: schedule.id,
      run_id: runId,
      status: result.ok ? "SENT" : "FAILED",
      error: result.error || null,
    };
  } catch (err: any) {
    const errorMessage = cleanText(err?.message || err, 500);
    await completeRun(runId, "FAILED", { error: errorMessage });
    await supabase
      .from("admin_monitoring_schedules")
      .update({ last_error: errorMessage })
      .eq("id", schedule.id);
    return { schedule_id: schedule.id, run_id: runId, status: "FAILED", error: errorMessage };
  }
}

async function processDue(limit: number, source: string) {
  const { data, error } = await supabase.rpc("claim_due_admin_monitoring_schedules", {
    p_limit: Math.max(1, Math.min(Number(limit) || 10, 50)),
  });

  if (error) throw new Error(error.message);
  const schedules = (data || []) as Schedule[];
  const results = [];
  for (const schedule of schedules) {
    results.push(await processSchedule(schedule, source));
  }
  return { claimed: schedules.length, results };
}

async function sendRecipientTest(recipientId: string) {
  const recipient = await loadRecipient(recipientId);
  if (!recipient) return { ok: false, error: "RECIPIENT_NOT_FOUND" };
  if (!recipient.active) return { ok: false, error: "RECIPIENT_INACTIVE" };

  const body = [
    "[PROSPIX] Teste de monitoramento administrativo",
    `Destinatario: ${recipient.label}`,
    `Horario: ${formatBrt(new Date())}`,
    "Canal administrativo operacional para este destinatario.",
  ].join("\n");

  return await sendAdminMonitoringWhatsApp(recipient.whatsapp, body);
}

serve(async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch (_err) {
    body = {};
  }

  const mode = body?.mode || "due";
  const source = cleanText(body?.source || "admin-monitoring-dispatcher", 120);

  try {
    if (mode === "status") {
      return json({ ok: true, channel: getAdminMonitoringChannelStatus() });
    }

    if (mode === "due") {
      return json({ ok: true, ...(await processDue(body?.limit || 10, source)) });
    }

    if (mode === "schedule") {
      if (!body?.schedule_id) return json({ ok: false, error: "schedule_id is required" }, 400);
      const schedule = await loadSchedule(body.schedule_id);
      if (!schedule) return json({ ok: false, error: "SCHEDULE_NOT_FOUND" }, 404);
      return json({ ok: true, result: await processSchedule(schedule, source) });
    }

    if (mode === "recipient_test") {
      if (!body?.recipient_id) return json({ ok: false, error: "recipient_id is required" }, 400);
      return json({ ok: true, result: await sendRecipientTest(body.recipient_id) });
    }

    if (mode === "disconnect_alert") {
      if (!body?.tenant_id || !body?.reason_code) {
        return json({ ok: false, error: "tenant_id and reason_code are required" }, 400);
      }
      const result = await dispatchAdminDisconnectAlert({
        supabase,
        tenantId: body.tenant_id,
        reasonCode: body.reason_code,
        externalState: body.external_state || null,
        connectionEventId: body.connection_event_id || null,
        operationalAlertId: body.operational_alert_id || null,
        pendingDueCount: body.pending_due_count ?? null,
        source,
      });
      return json({ ok: true, result });
    }

    return json({ ok: false, error: "UNKNOWN_MODE" }, 400);
  } catch (err: any) {
    console.error("[admin-monitoring-dispatcher] failed", err);
    return json({ ok: false, error: cleanText(err?.message || err, 500) }, 500);
  }
});
