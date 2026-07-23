// supabase/functions/admin-monitoring-dispatcher/index.ts
// Admin monitoring dispatcher: periodic reports, manual runs, test messages,
// and explicit disconnect alert dispatch.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dispatchAdminAiActivityAlert,
  dispatchAdminDisconnectAlert,
  getAdminMonitoringChannelStatus,
  sendAdminMonitoringWhatsApp,
} from "../_shared/admin-monitoring.ts";
import { buildAdminReportMessage, formatBrtMinute } from "../_shared/admin-message-formatters.ts";

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

type DispatcherRunStatus = "SUCCEEDED" | "COMPLETED_WITH_FAILURES" | "FAILED";
type ActivityState = "OK" | "WATCH" | "STALLED" | "BLOCKED" | "OFF_HOURS";
type WebhookReprocessStatus = "DRY_RUN" | "ACCEPTED" | "FAILED" | "SKIPPED";

const OPERATING_START_HOUR = 9;
const OPERATING_END_HOUR = 18;
const BRT_UTC_OFFSET_HOURS = 3;

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

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function jsonPreview(value: unknown, max = 2000): Record<string, unknown> {
  try {
    const text = JSON.stringify(value ?? {})
      .replace(/[A-Za-z0-9_=-]{40,}/g, "[REDACTED]")
      .replace(/55\d{10,13}/g, "[PHONE_REDACTED]")
      .slice(0, max);
    return { preview: text };
  } catch (_err) {
    return { preview: cleanText(value, max) };
  }
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
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

function brtParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    weekday: map.get("weekday") || "",
  };
}

function brtTodayAt(parts: ReturnType<typeof brtParts>, hour: number): string {
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour + BRT_UTC_OFFSET_HOURS,
    0,
    0,
    0,
  )).toISOString();
}

function buildOperatingWindow(now: Date) {
  const parts = brtParts(now);
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const isOpen = !weekend && parts.hour >= OPERATING_START_HOUR && parts.hour < OPERATING_END_HOUR;
  return {
    isOpen,
    label: isOpen
      ? "horario ativo"
      : weekend
        ? "fora do horario ativo: fim de semana"
        : `fora do horario ativo: ${OPERATING_START_HOUR}h as ${OPERATING_END_HOUR}h`,
    dayStartAt: brtTodayAt(parts, 0),
  };
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
    webhookEvents: await safeCount("webhookEvents", "evolution_webhook_processing_events", (q) =>
      applyTenantScope(q.gte("accepted_at", periodStart).lte("accepted_at", periodEnd), schedule)
    ),
    webhookFailed: await safeCount("webhookFailed", "evolution_webhook_processing_events", (q) =>
      applyTenantScope(q.eq("status", "FAILED").gte("failed_at", periodStart).lte("failed_at", periodEnd), schedule)
    ),
    webhookStaleProcessing: await safeCount("webhookStaleProcessing", "evolution_webhook_processing_events", (q) =>
      applyTenantScope(q.eq("status", "PROCESSING").lte("processing_started_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()), schedule)
    ),
    webhookDuplicateAttempts: await safeCount("webhookDuplicateAttempts", "evolution_webhook_processing_events", (q) =>
      applyTenantScope(q.gt("attempts", 1).gte("last_seen_at", periodStart).lte("last_seen_at", periodEnd), schedule)
    ),
  };

  let guardianQuery = supabase
    .from("whatsapp_guardian_status")
    .select("tenant_id, status, external_state, last_disconnect_reason_code, updated_at, quarantined_until, circuit_open_until")
    .order("updated_at", { ascending: false })
    .limit(20);
  guardianQuery = applyTenantScope(guardianQuery, schedule);
  const { data: guardianStatus, error: guardianError } = await guardianQuery;
  const tenantById = new Map((tenants || []).map((tenant: any) => [tenant.id, tenant]));
  const aiActivity = await collectAiActivity(schedule, tenants, guardianStatus || [], periodEnd);
  const webhookProcessing = await collectWebhookProcessing(schedule);

  const recentMessages = await loadRecentMessages(schedule, periodStart, periodEnd);
  const errors = [
    ...Object.values(counts).map((count) => count.error).filter(Boolean),
    guardianError ? `guardianStatus: ${guardianError.message}` : null,
    ...(webhookProcessing.errors || []),
    ...aiActivity.errors,
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
    guardianStatus: (guardianStatus || []).map((row: any) => ({
      ...row,
      tenant_name: tenantById.get(row.tenant_id)?.name || tenantById.get(row.tenant_id)?.slug || null,
    })),
    aiActivity,
    webhookProcessing,
    recentMessages,
    errors,
  };
}

async function collectWebhookProcessing(schedule: Schedule) {
  let issueQuery = supabase
    .from("evolution_webhook_operational_failures")
    .select([
      "id",
      "tenant_id",
      "tenant_name",
      "status",
      "skip_reason",
      "error_message",
      "attempts",
      "accepted_at",
      "failed_at",
      "updated_at",
      "processing_age_seconds",
      "operator_summary",
      "recommended_action",
    ].join(", "))
    .order("updated_at", { ascending: false })
    .limit(10);
  issueQuery = applyTenantScope(issueQuery, schedule);

  const issueResult = await safeRows("webhookProcessingIssues", issueQuery);

  return {
    issues: issueResult.rows.map((row: any) => ({
      tenant_id: row.tenant_id || null,
      tenant_name: row.tenant_name || "Conta nao identificada",
      status: row.status || "UNKNOWN",
      skip_reason: row.skip_reason || null,
      error_message: row.error_message || null,
      attempts: Number(row.attempts || 0),
      accepted_at: row.accepted_at || null,
      failed_at: row.failed_at || null,
      updated_at: row.updated_at || null,
      processing_age_seconds: row.processing_age_seconds == null ? null : Number(row.processing_age_seconds),
      operator_summary: row.operator_summary || null,
      recommended_action: row.recommended_action || null,
    })),
    errors: [issueResult.error].filter(Boolean),
  };
}

async function safeRows(
  label: string,
  query: PromiseLike<{ data: any[] | null; error: any }>,
): Promise<{ rows: any[]; error: string | null }> {
  try {
    const { data, error } = await query;
    if (error) return { rows: [], error: `${label}: ${error.message}` };
    return { rows: data || [], error: null };
  } catch (err: any) {
    return { rows: [], error: `${label}: ${cleanText(err?.message || err, 200)}` };
  }
}

function rowsByTenant(rows: any[]) {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const tenantId = String(row.tenant_id || "");
    if (!tenantId) continue;
    const list = map.get(tenantId) || [];
    list.push(row);
    map.set(tenantId, list);
  }
  return map;
}

function oldestAt(rows: any[], field: string): string | null {
  let oldest: string | null = null;
  for (const row of rows) {
    const value = row?.[field] ? String(row[field]) : null;
    if (value && (!oldest || value < oldest)) oldest = value;
  }
  return oldest;
}

function classifyActivity(input: {
  isOperatingWindow: boolean;
  guardianStatus: string;
  guardianBlockingSend?: boolean;
  guardianBlockSummary?: string | null;
  contactableBacklog: number;
  duePending: number;
  oldestDuePendingAt: string | null;
  blockedOrFailedLast24h?: number;
  unansweredConversations: number;
  oldestUnansweredInboundAt: string | null;
  outboundToday: number;
  nowMs: number;
}): { state: ActivityState; summary: string; action: string } {
  const guardian = input.guardianStatus.toUpperCase();
  if (guardian === "SUSPENDED" || guardian === "PAUSED" || input.guardianBlockingSend) {
    const dueDetail = input.duePending > 0
      ? ` ${countLabel(input.duePending, "mensagem pronta aguarda", "mensagens prontas aguardam")} reconexao antes de enviar.`
      : "";
    return {
      state: "BLOCKED",
      summary: `${input.guardianBlockSummary || "IA pausada por estado do WhatsApp."}.${dueDetail}`,
      action: "Reconectar ou estabilizar o WhatsApp.",
    };
  }

  const dueAge = input.oldestDuePendingAt ? Math.floor((input.nowMs - new Date(input.oldestDuePendingAt).getTime()) / 60000) : 0;
  if (input.duePending > 0 && dueAge >= 15) {
    return {
      state: "STALLED",
      summary: input.duePending === 1
        ? "1 mensagem vencida na fila."
        : `${countLabel(input.duePending, "mensagem", "mensagens")} vencidas na fila.`,
      action: "Checar worker send-messages e bloqueios do Guardian.",
    };
  }

  const inboundAge = input.oldestUnansweredInboundAt ? Math.floor((input.nowMs - new Date(input.oldestUnansweredInboundAt).getTime()) / 60000) : 0;
  if (input.unansweredConversations > 0 && inboundAge >= 10) {
    return {
      state: "STALLED",
      summary: input.unansweredConversations === 1
        ? "1 conversa aguarda resposta da IA."
        : `${countLabel(input.unansweredConversations, "conversa", "conversas")} aguardam resposta da IA.`,
      action: "Priorizar continuidade antes de nova prospeccao.",
    };
  }

  if (input.isOperatingWindow && input.contactableBacklog > 0 && input.outboundToday === 0) {
    return {
      state: "WATCH",
      summary: input.contactableBacklog === 1
        ? "1 lead apto e nenhum envio da IA hoje."
        : `${countLabel(input.contactableBacklog, "lead apto", "leads aptos")} e nenhum envio da IA hoje.`,
      action: "Acompanhar proxima execucao e validar campanha/cadencia.",
    };
  }

  if ((input.blockedOrFailedLast24h || 0) > 0) {
    return {
      state: "WATCH",
      summary: `${countLabel(input.blockedOrFailedLast24h || 0, "falha ou bloqueio recente", "falhas ou bloqueios recentes")} em envios da IA.`,
      action: "Acompanhar se novas filas voltam a falhar antes de aumentar cadencia.",
    };
  }

  if (input.contactableBacklog > 0 || input.duePending > 0 || input.unansweredConversations > 0 || ["COLD", "RECOVERY", "HIGH_LOAD", "COOLDOWN"].includes(guardian)) {
    return {
      state: "WATCH",
      summary: "Operacao com pontos para acompanhamento.",
      action: "Monitorar sem intervencao imediata.",
    };
  }

  if (!input.isOperatingWindow) {
    return {
      state: "OFF_HOURS",
      summary: "Fora do horario ativo de prospeccao.",
      action: "Nenhuma acao imediata.",
    };
  }

  return {
    state: "OK",
    summary: "IA sem pendencias operacionais relevantes.",
    action: "Nenhuma acao imediata.",
  };
}

async function collectAiActivity(schedule: Schedule, tenants: any[], guardianStatus: any[], periodEnd: string) {
  const now = new Date(periodEnd);
  const nowMs = now.getTime();
  const operatingWindow = buildOperatingWindow(now);
  const last60m = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const unansweredCutoff = new Date(nowMs - 10 * 60 * 1000).toISOString();

  let contactableQuery = supabase
    .from("leads")
    .select("id, tenant_id, created_at, status, contacted_at, queued_first_touch_at")
    .eq("status", "ENRICHED")
    .is("deleted_at", null)
    .is("contacted_at", null)
    .is("queued_first_touch_at", null)
    .not("whatsapp", "is", null)
    .order("created_at", { ascending: true })
    .limit(1000);
  contactableQuery = applyTenantScope(contactableQuery, schedule);
  let contactableResult = await safeRows("contactableLeads", contactableQuery);

  if (contactableResult.error) {
    let fallbackContactableQuery = supabase
      .from("leads")
      .select("id, tenant_id, created_at, status, contacted_at")
      .eq("status", "ENRICHED")
      .is("deleted_at", null)
      .is("contacted_at", null)
      .not("whatsapp", "is", null)
      .order("created_at", { ascending: true })
      .limit(1000);
    fallbackContactableQuery = applyTenantScope(fallbackContactableQuery, schedule);
    contactableResult = await safeRows("contactableLeadsLegacy", fallbackContactableQuery);
  }

  let pendingQuery = supabase
    .from("pending_outbound")
    .select("id, tenant_id, scheduled_for")
    .is("sent_at", null)
    .is("failed_at", null)
    .lte("scheduled_for", periodEnd)
    .order("scheduled_for", { ascending: true })
    .limit(1000);
  pendingQuery = applyTenantScope(pendingQuery, schedule);

  let unansweredQuery = supabase
    .from("conversations")
    .select("id, tenant_id, last_inbound_at, last_outbound_at")
    .eq("status", "ACTIVE")
    .eq("ai_handling", true)
    .not("last_inbound_at", "is", null)
    .lte("last_inbound_at", unansweredCutoff)
    .limit(1000);
  unansweredQuery = applyTenantScope(unansweredQuery, schedule);

  let outboundQuery = supabase
    .from("messages")
    .select("id, tenant_id, created_at")
    .eq("direction", "OUTBOUND")
    .eq("sender", "AI")
    .gte("created_at", operatingWindow.dayStartAt)
    .lte("created_at", periodEnd)
    .limit(1000);
  outboundQuery = applyTenantScope(outboundQuery, schedule);

  let inboundQuery = supabase
    .from("messages")
    .select("id, tenant_id, created_at")
    .eq("direction", "INBOUND")
    .gte("created_at", operatingWindow.dayStartAt)
    .lte("created_at", periodEnd)
    .limit(1000);
  inboundQuery = applyTenantScope(inboundQuery, schedule);

  let workerSnapshotQuery = supabase
    .from("ai_worker_operational_snapshot")
    .select([
      "tenant_id",
      "active_pending",
      "due_pending",
      "blocked_or_failed_last24h",
      "next_scheduled_for",
      "oldest_due_at",
      "oldest_due_age_seconds",
      "sent_today",
      "sent_last60m",
      "latest_ai_message_at",
      "latest_inbound_at",
      "guardian_status",
      "guardian_external_state",
      "guardian_reason_code",
      "guardian_operation_state",
      "guardian_blocking_send",
      "guardian_block_summary",
      "first_touch_eligible",
      "first_touch_evaluated",
      "latest_queue_status",
      "latest_queue_message_type",
      "latest_queue_failed_reason",
      "latest_queue_validation_reason_code",
      "latest_queue_final_guardian_decision",
    ].join(", "));
  workerSnapshotQuery = applyTenantScope(workerSnapshotQuery, schedule);

  const [pendingResult, unansweredResult, outboundResult, inboundResult, workerSnapshotResult] = await Promise.all([
    safeRows("pendingDue", pendingQuery),
    safeRows("unansweredConversations", unansweredQuery),
    safeRows("outboundToday", outboundQuery),
    safeRows("inboundToday", inboundQuery),
    safeRows("aiWorkerSnapshot", workerSnapshotQuery),
  ]);

  const contactableByTenant = rowsByTenant(contactableResult.rows);
  const pendingByTenant = rowsByTenant(pendingResult.rows);
  const unansweredByTenant = rowsByTenant(unansweredResult.rows.filter((row: any) => row.last_inbound_at && (!row.last_outbound_at || row.last_inbound_at > row.last_outbound_at)));
  const outboundByTenant = rowsByTenant(outboundResult.rows);
  const inboundByTenant = rowsByTenant(inboundResult.rows);
  const guardianByTenant = new Map((guardianStatus || []).map((row: any) => [String(row.tenant_id), row]));
  const workerByTenant = new Map((workerSnapshotResult.rows || []).map((row: any) => [String(row.tenant_id), row]));

  const tenantRows = tenants.map((tenant: any) => {
    const tenantId = String(tenant.id);
    const contactable = contactableByTenant.get(tenantId) || [];
    const pending = pendingByTenant.get(tenantId) || [];
    const unanswered = unansweredByTenant.get(tenantId) || [];
    const outbound = outboundByTenant.get(tenantId) || [];
    const inbound = inboundByTenant.get(tenantId) || [];
    const guardian = guardianByTenant.get(tenantId);
    const worker = workerByTenant.get(tenantId) || null;
    const contactableBacklog = worker ? Number(worker.first_touch_eligible || 0) : contactable.length;
    const duePending = worker ? Number(worker.due_pending || 0) : pending.length;
    const outboundToday = worker ? Number(worker.sent_today || 0) : outbound.length;
    const outboundLast60m = worker
      ? Number(worker.sent_last60m || 0)
      : outbound.filter((row: any) => String(row.created_at || "") >= last60m).length;
    const classified = classifyActivity({
      isOperatingWindow: operatingWindow.isOpen,
      guardianStatus: String(worker?.guardian_status || guardian?.status || "NORMAL"),
      guardianBlockingSend: Boolean(worker?.guardian_blocking_send),
      guardianBlockSummary: worker?.guardian_block_summary || null,
      contactableBacklog,
      duePending,
      oldestDuePendingAt: worker?.oldest_due_at || oldestAt(pending, "scheduled_for"),
      blockedOrFailedLast24h: Number(worker?.blocked_or_failed_last24h || 0),
      unansweredConversations: unanswered.length,
      oldestUnansweredInboundAt: oldestAt(unanswered, "last_inbound_at"),
      outboundToday,
      nowMs,
    });

    return {
      tenant_id: tenantId,
      tenant_name: tenant.name || tenant.slug || tenantId,
      state: classified.state,
      summary: classified.summary,
      action: classified.action,
      contactable_backlog: contactableBacklog,
      due_pending: duePending,
      unanswered_conversations: unanswered.length,
      outbound_today: outboundToday,
      outbound_last_60m: outboundLast60m,
      inbound_today: inbound.length,
      guardian_status: worker?.guardian_status || guardian?.status || null,
      active_pending: worker ? Number(worker.active_pending || 0) : null,
      blocked_or_failed_last24h: worker ? Number(worker.blocked_or_failed_last24h || 0) : null,
      first_touch_evaluated: worker ? Number(worker.first_touch_evaluated || 0) : null,
      oldest_due_age_minutes: worker?.oldest_due_age_seconds == null
        ? null
        : Math.floor(Number(worker.oldest_due_age_seconds || 0) / 60),
      next_scheduled_for: worker?.next_scheduled_for || null,
      latest_ai_message_at: worker?.latest_ai_message_at || null,
      worker_status: worker?.latest_queue_status || null,
      worker_message_type: worker?.latest_queue_message_type || null,
      worker_failed_reason: worker?.latest_queue_failed_reason || null,
      worker_validation_reason_code: worker?.latest_queue_validation_reason_code || null,
      worker_final_guardian_decision: worker?.latest_queue_final_guardian_decision || null,
      guardian_external_state: worker?.guardian_external_state || guardian?.external_state || null,
      guardian_reason_code: worker?.guardian_reason_code || guardian?.last_disconnect_reason_code || null,
      guardian_blocking_send: Boolean(worker?.guardian_blocking_send),
      guardian_block_summary: worker?.guardian_block_summary || null,
    };
  });

  const summary = tenantRows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.state] = (acc[row.state] || 0) + 1;
    return acc;
  }, {});

  const errors = [
    contactableResult.error,
    pendingResult.error,
    unansweredResult.error,
    outboundResult.error,
    inboundResult.error,
    workerSnapshotResult.error,
  ].filter(Boolean);

  return {
    operatingWindow,
    summary,
    tenants: tenantRows,
    errors,
  };
}

async function collectAllTenantGuardianStatus(schedule: Schedule) {
  let guardianQuery = supabase
    .from("whatsapp_guardian_status")
    .select("tenant_id, status, external_state, last_disconnect_reason_code, updated_at, quarantined_until, circuit_open_until")
    .order("updated_at", { ascending: false })
    .limit(200);
  guardianQuery = applyTenantScope(guardianQuery, schedule);
  const { data, error } = await guardianQuery;
  if (error) return { rows: [], error: `guardianStatus: ${error.message}` };
  return { rows: data || [], error: null };
}

async function processAiActivityAlerts(source: string) {
  const schedule: Schedule = {
    id: "ai-activity-alert-monitor",
    name: "AI Activity Alert Monitor",
    recipient_id: "",
    active: true,
    interval_minutes: 5,
    window_minutes: 60,
    timezone: "America/Sao_Paulo",
    tenant_ids: null,
    include_numbers: false,
    include_recent_messages: false,
  };
  const periodEnd = new Date().toISOString();
  const tenants = await loadTenants(schedule);
  const guardian = await collectAllTenantGuardianStatus(schedule);
  const activity = await collectAiActivity(schedule, tenants, guardian.rows, periodEnd);
  const actionable = activity.tenants.filter((row: any) => ["BLOCKED", "STALLED"].includes(String(row.state || "").toUpperCase()));
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const results = [];

  for (const row of actionable) {
    try {
      const result = await dispatchAdminAiActivityAlert({
        supabase,
        activity: row,
        source,
      });
      sent += result.sent || 0;
      failed += result.failed || 0;
      skipped += result.skipped || 0;
      results.push({ tenant_id: row.tenant_id, state: row.state, ...result });
    } catch (err: any) {
      failed++;
      results.push({ tenant_id: row.tenant_id, state: row.state, error: cleanText(err?.message || err, 240) });
    }
  }

  return {
    evaluated: activity.tenants.length,
    actionable: actionable.length,
    sent,
    failed,
    skipped,
    errors: [guardian.error, ...(activity.errors || [])].filter(Boolean),
    results,
  };
}

async function buildReportMessage(schedule: Schedule, metrics: any) {
  const built = buildAdminReportMessage(schedule, metrics);
  return { aiSummary: built.summary, body: built.body };
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

async function createDispatcherRun(mode: string, source: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("admin_monitoring_dispatcher_runs")
      .insert({
        mode,
        source,
        status: "RUNNING",
      })
      .select("id")
      .single();

    if (error) throw error;
    return data?.id || null;
  } catch (err: any) {
    console.warn("[admin-monitoring-dispatcher] run audit insert failed", cleanText(err?.message || err, 240));
    return null;
  }
}

function summarizeDueResults(results: Array<Record<string, unknown>>) {
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const result of results) {
    if (result.status === "SENT") sent++;
    else if (result.status === "FAILED") failed++;
    else if (result.status === "SKIPPED") skipped++;
  }

  return { sent, failed, skipped };
}

async function completeDispatcherRun(
  runId: string | null,
  status: DispatcherRunStatus,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;

  try {
    await supabase
      .from("admin_monitoring_dispatcher_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        ...patch,
      })
      .eq("id", runId);
  } catch (err: any) {
    console.warn("[admin-monitoring-dispatcher] run audit update failed", cleanText(err?.message || err, 240));
  }
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
    const result = await sendAdminMonitoringWhatsApp(recipient.whatsapp, built.body, supabase);

    await completeRun(runId, result.ok ? "SENT" : "FAILED", {
      channel_id: result.channelId || null,
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
    `Horario: ${formatBrtMinute(new Date())}`,
    "Canal administrativo operacional para este destinatario.",
  ].join("\n");

  return await sendAdminMonitoringWhatsApp(recipient.whatsapp, body, supabase);
}

function isWebhookEventStale(row: any): boolean {
  if (String(row?.status || "").toUpperCase() !== "PROCESSING") return false;
  const startedAt = row?.processing_started_at ? new Date(row.processing_started_at).getTime() : NaN;
  return Number.isFinite(startedAt) && Date.now() - startedAt >= 5 * 60 * 1000;
}

function isWebhookEventReplayable(row: any): boolean {
  const status = String(row?.status || "").toUpperCase();
  return status === "FAILED" || isWebhookEventStale(row);
}

async function updateWebhookReprocessRun(
  runId: string,
  status: WebhookReprocessStatus,
  patch: Record<string, unknown>,
) {
  await supabase
    .from("evolution_webhook_reprocess_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", runId);
}

async function processWebhookReprocess(body: any, source: string) {
  const processingEventId = String(body?.processing_event_id || body?.event_id || "");
  const dryRun = body?.dry_run !== false;
  const requestedById = isUuid(body?.requested_by_id) ? String(body.requested_by_id) : null;
  const reason = cleanText(body?.reason, 500);

  if (!isUuid(processingEventId)) return { ok: false, error: "processing_event_id is required" };
  if (reason.length < 10) return { ok: false, error: "reason must have at least 10 characters" };

  const { data: event, error: eventError } = await supabase
    .from("evolution_webhook_processing_events")
    .select("id, event_name, instance_name, status, attempts, payload, accepted_at, processing_started_at, failed_at, updated_at")
    .eq("id", processingEventId)
    .maybeSingle();

  if (eventError) throw new Error(eventError.message);
  if (!event) return { ok: false, error: "WEBHOOK_PROCESSING_EVENT_NOT_FOUND" };

  const replayable = isWebhookEventReplayable(event);
  const status = String(event.status || "UNKNOWN").toUpperCase();
  const eligibility = {
    replayable,
    previous_status: status,
    attempts: Number(event.attempts || 0),
    accepted_at: event.accepted_at || null,
    processing_started_at: event.processing_started_at || null,
    failed_at: event.failed_at || null,
    updated_at: event.updated_at || null,
    reason: replayable
      ? "Evento elegivel para reprocessamento seletivo."
      : "Somente eventos com falha ou processamento travado ha mais de 5 minutos podem ser reprocessados.",
  };

  const { data: run, error: runError } = await supabase
    .from("evolution_webhook_reprocess_runs")
    .insert({
      processing_event_id: event.id,
      requested_by_id: requestedById,
      source,
      dry_run: dryRun,
      status: "PENDING",
      reason,
      previous_status: status,
      previous_attempts: Number(event.attempts || 0),
    })
    .select("id")
    .single();

  if (runError) throw new Error(runError.message);
  const runId = run.id as string;

  if (dryRun) {
    await updateWebhookReprocessRun(runId, "DRY_RUN", {
      response_body_redacted: { status: "DRY_RUN", ...eligibility },
    });
    return { ok: true, dry_run: true, status: "DRY_RUN", run_id: runId, ...eligibility };
  }

  if (!replayable) {
    await updateWebhookReprocessRun(runId, "SKIPPED", {
      error: "WEBHOOK_EVENT_NOT_REPLAYABLE",
      response_body_redacted: eligibility,
    });
    return { ok: false, status: "SKIPPED", run_id: runId, error: "WEBHOOK_EVENT_NOT_REPLAYABLE", ...eligibility };
  }

  if (!event.payload || typeof event.payload !== "object") {
    await updateWebhookReprocessRun(runId, "FAILED", {
      error: "WEBHOOK_EVENT_PAYLOAD_UNAVAILABLE",
      response_body_redacted: eligibility,
    });
    return { ok: false, status: "FAILED", run_id: runId, error: "WEBHOOK_EVENT_PAYLOAD_UNAVAILABLE", ...eligibility };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/webhook-evolution`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(event.payload),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (_err) {
      parsed = { raw: text.slice(0, 500) };
    }

    const accepted = response.ok && parsed?.ok !== false;
    await updateWebhookReprocessRun(runId, accepted ? "ACCEPTED" : "FAILED", {
      response_status: response.status,
      response_body_redacted: jsonPreview(parsed || text),
      error: accepted ? null : cleanText(parsed?.error || parsed?.message || text || `HTTP ${response.status}`, 500),
    });

    return {
      ok: accepted,
      status: accepted ? "ACCEPTED" : "FAILED",
      run_id: runId,
      response_status: response.status,
      webhook_response: jsonPreview(parsed || text, 800),
      ...eligibility,
    };
  } catch (err: any) {
    const errorMessage = cleanText(err?.message || err, 500);
    await updateWebhookReprocessRun(runId, "FAILED", {
      error: errorMessage,
      response_body_redacted: { error: errorMessage },
    });
    return { ok: false, status: "FAILED", run_id: runId, error: errorMessage, ...eligibility };
  }
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
      return json({ ok: true, channel: await getAdminMonitoringChannelStatus(supabase) });
    }

    if (mode === "due") {
      const dispatcherRunId = await createDispatcherRun(mode, source);
      try {
        const result = await processDue(body?.limit || 10, source);
        const aiActivityAlerts = await processAiActivityAlerts(source);
        const summary = summarizeDueResults(result.results);
        await completeDispatcherRun(
          dispatcherRunId,
          summary.failed > 0 || aiActivityAlerts.failed > 0 ? "COMPLETED_WITH_FAILURES" : "SUCCEEDED",
          {
            claimed_count: result.claimed,
            sent_count: summary.sent + aiActivityAlerts.sent,
            failed_count: summary.failed + aiActivityAlerts.failed,
            skipped_count: summary.skipped + aiActivityAlerts.skipped,
            result_summary: {
              reports: result,
              ai_activity_alerts: aiActivityAlerts,
            },
          },
        );
        return json({ ok: true, ...result, ai_activity_alerts: aiActivityAlerts, dispatcher_run_id: dispatcherRunId });
      } catch (err: any) {
        const errorMessage = cleanText(err?.message || err, 500);
        await completeDispatcherRun(dispatcherRunId, "FAILED", {
          error: errorMessage,
          result_summary: { source, mode },
        });
        throw new Error(errorMessage);
      }
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

    if (mode === "webhook_reprocess") {
      const result = await processWebhookReprocess(body, source);
      return json(result.ok ? { ok: true, result } : { ok: false, result, error: result.error || "WEBHOOK_REPROCESS_FAILED" }, result.ok ? 200 : 400);
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
