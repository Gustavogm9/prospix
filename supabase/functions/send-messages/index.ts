// supabase/functions/send-messages/index.ts
// ProspIX — Supabase Edge Function: Send Messages
// Called by pg_cron every 5 min (08h-23h BRT)
// 1. Sends first-touch messages to ENRICHED leads (via script + variation)
// 2. Processes pending_outbound records (AI responses queued with delay)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GuardianRunner } from "../_shared/guardians/runner.ts";
import { buildCandidatePayload } from "../_shared/guardians/candidate.ts";
import {
  computeFirstResponseScheduledFor,
  getGuardianByKey,
  guardianNumber,
} from "../_shared/guardians/validators/cadence.ts";
import type { GuardianRunResult } from "../_shared/guardians/types.ts";
import { dispatchAdminDisconnectAlert } from "../_shared/admin-monitoring.ts";
import {
  buildGuardianStatePatch,
  recordGuardianStateTransition,
  shouldMoveColdToRecovery,
  shouldPromoteRecoveryToNormal,
} from "../_shared/whatsapp-guardian-state.ts";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// ── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function uuid(): string {
  return crypto.randomUUID();
}

type ConversationLockResult = {
  acquired: boolean;
  requestedLockUntil: string;
  currentLockUntil: string | null;
  error?: string | null;
};

type GuardianDelayDecision = {
  reasonCode: string;
  scheduledFor: string;
  finalDecision: "DELAY";
};

function isValidFutureIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function extractDelayDecision(
  run: GuardianRunResult,
  fallbackDelayMs = 10 * 60 * 1000,
): GuardianDelayDecision | null {
  const decision = run.blockingDecision;
  if (!decision) return null;
  const isDelay =
    decision.decision === "DELAY" ||
    String(decision.reason_code || "").includes("_DELAY") ||
    String(decision.reason_code || "").includes("_DELAYED");
  if (!isDelay) return null;

  const nextScheduled = isValidFutureIso(decision.evidence?.next_scheduled_for)
    ? String(decision.evidence.next_scheduled_for)
    : new Date(Date.now() + fallbackDelayMs).toISOString();

  return {
    reasonCode: decision.reason_code,
    guardianKey: decision.guardian_key || null,
    scheduledFor: nextScheduled,
    finalDecision: "DELAY",
  };
}

async function reschedulePendingByGuardian(params: {
  item: any;
  delay: GuardianDelayDecision;
  configVersionId: string | null;
}) {
  await supabase.from("pending_outbound").update({
    scheduled_for: params.delay.scheduledFor,
    failed_reason: params.delay.reasonCode,
    validation_status: "DELAYED",
    validation_reason_code: params.delay.reasonCode,
    final_guardian_checked_at: new Date().toISOString(),
    final_guardian_decision: params.delay.finalDecision,
    guardian_config_version_id: params.item.guardian_config_version_id || params.configVersionId,
  }).eq("id", params.item.id);
}

async function blockPendingByGuardian(params: {
  item: any;
  reasonCode: string;
  finalDecision: string;
  configVersionId: string | null;
}) {
  await supabase.from("pending_outbound").update({
    failed_at: new Date().toISOString(),
    failed_reason: params.reasonCode,
    validation_status: "BLOCKED",
    validation_reason_code: params.reasonCode,
    final_guardian_checked_at: new Date().toISOString(),
    final_guardian_decision: params.finalDecision,
    guardian_config_version_id: params.item.guardian_config_version_id || params.configVersionId,
  }).eq("id", params.item.id);
}

async function countActiveOutboundContactsLast30m(tenantId: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("messages")
    .select("conversation_id")
    .eq("tenant_id", tenantId)
    .eq("direction", "OUTBOUND")
    .gte("created_at", since)
    .limit(1000);

  return new Set((data || []).map((row: any) => row.conversation_id).filter(Boolean)).size;
}

async function getLastOutboundSentAt(conversationId: string): Promise<string | null> {
  const { data } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "OUTBOUND")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.created_at || null;
}

async function countFollowupsWithoutReply(conversationId: string, lastInboundAt: string | null): Promise<number> {
  let query = supabase
    .from("pending_outbound")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("message_type", "COMMERCIAL_FOLLOWUP")
    .is("failed_at", null);

  if (lastInboundAt) {
    query = query.gt("created_at", lastInboundAt);
  }

  const { count } = await query;
  return count || 0;
}

async function loadReusableFirstTouchConversation(tenantId: string, leadId: string): Promise<any | null> {
  const { data } = await supabase
    .from("conversations")
    .select("id, message_count, started_at")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .eq("status", "ACTIVE")
    .eq("ai_handling", true)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

async function countFirstTouchAttemptsForLead(tenantId: string, leadId: string): Promise<number> {
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId);

  const conversationIds = (conversations || []).map((row: any) => row.id).filter(Boolean);
  if (conversationIds.length === 0) return 0;

  const { count } = await supabase
    .from("pending_outbound")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("message_type", "OUTBOUND_START")
    .in("conversation_id", conversationIds);

  return count || 0;
}

async function acquireConversationLock(params: {
  tenantId: string;
  conversationId: string;
  ttlSeconds: number;
}): Promise<ConversationLockResult> {
  const nowIso = new Date().toISOString();
  const requestedLockUntil = new Date(Date.now() + Math.max(15, params.ttlSeconds) * 1000).toISOString();

  try {
    const { data, error } = await supabase.rpc("try_acquire_conversation_lock", {
      p_conversation_id: params.conversationId,
      p_tenant_id: params.tenantId,
      p_lock_until: requestedLockUntil,
      p_now: nowIso,
    });

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return {
        acquired: row?.acquired === true,
        requestedLockUntil,
        currentLockUntil: row?.current_lock_until || null,
      };
    }
  } catch (_err) {
    // Fallback below keeps deployment tolerant while the migration is rolling out.
  }

  const { data: updated, error: updateError } = await supabase
    .from("conversations")
    .update({ conversation_lock_until: requestedLockUntil })
    .eq("id", params.conversationId)
    .eq("tenant_id", params.tenantId)
    .or(`conversation_lock_until.is.null,conversation_lock_until.lt.${nowIso}`)
    .select("conversation_lock_until")
    .maybeSingle();

  if (updateError || !updated) {
    const { data: current } = await supabase
      .from("conversations")
      .select("conversation_lock_until")
      .eq("id", params.conversationId)
      .eq("tenant_id", params.tenantId)
      .maybeSingle();

    return {
      acquired: false,
      requestedLockUntil,
      currentLockUntil: current?.conversation_lock_until || null,
      error: updateError?.message || null,
    };
  }

  return {
    acquired: true,
    requestedLockUntil,
    currentLockUntil: updated.conversation_lock_until || requestedLockUntil,
  };
}

async function releaseConversationLock(tenantId: string, conversationId: string, lockUntil: string | null) {
  if (!lockUntil) return;
  const { error } = await supabase
    .from("conversations")
    .update({ conversation_lock_until: null })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .eq("conversation_lock_until", lockUntil);

  if (error) {
    console.warn("  [Guardian V3] Falha ao liberar conversation lock:", redactText(error.message));
  }
}

/** Get current hour in BRT (UTC-3) */
function getBrtHour(): number {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.getUTCHours();
}

/** Get current date string in BRT (YYYY-MM-DD) */
function getBrtDateStr(): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().split("T")[0];
}

// ── Evolution API Config ────────────────────────────────────────────────────
interface EvoConfig {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
}

async function loadEvoConfig(tenantId: string): Promise<EvoConfig | null> {
  try {
    const { data, error } = await supabase
      .from("tenant_secrets")
      .select("evolution_base_url, evolution_instance_name, evolution_api_key_encrypted")
      .eq("tenant_id", tenantId)
      .single();

    if (error || !data?.evolution_instance_name) return null;

    return {
      baseUrl: data.evolution_base_url || "https://evolution-evolution-api.qr4jgl.easypanel.host",
      instanceName: data.evolution_instance_name,
      apiKey: data.evolution_api_key_encrypted || Deno.env.get("EVOLUTION_GUILDS_API_KEY") || "",
    };
  } catch (_e) {
    return null;
  }
}

type GuardMode = "OFF" | "OBSERVE" | "WARN" | "BLOCK";

interface ExternalConnectionStatus {
  ok: boolean;
  state: string | null;
  reasonCode: string;
  critical: boolean;
  rawError: Record<string, unknown>;
}

interface ConnectionGuardDecision {
  allowSend: boolean;
  allowNewActive: boolean;
  reasonCode: string;
  externalState: string | null;
  isQuarantined: boolean;
  quarantinedUntil: string | null;
  numberState: string;
}

function getGuardMode(name: string, fallback: GuardMode): GuardMode {
  const raw = (Deno.env.get(name) || fallback).toUpperCase();
  if (raw === "OFF" || raw === "OBSERVE" || raw === "WARN" || raw === "BLOCK") return raw;
  return fallback;
}

function getNumberEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function isBlockingMode(mode: GuardMode): boolean {
  return mode === "BLOCK";
}

function statusAfterHealthyExternalState(guardianStatus: any, externalState?: string | null): string {
  const current = guardianStatus?.status || "NORMAL";
  const guardReason = guardianStatus?.last_disconnect_reason_code;
  if ((current === "PAUSED" || current === "SUSPENDED") && guardReason) return "COLD";
  if (shouldMoveColdToRecovery({
    guardianStatus,
    externalState,
    quarantineMinutes: getNumberEnv("WA_POST_RECONNECT_QUARANTINE_MINUTES", 60),
  })) return "RECOVERY";
  return current;
}

function toLoggableText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch (_err) {
    return String(value ?? "");
  }
}

function redactText(value: unknown): string {
  return toLoggableText(value)
    .replace(/55\d{10,13}/g, "[PHONE_REDACTED]")
    .replace(/[A-Za-z0-9_=-]{48,}/g, "[TOKEN_REDACTED]")
    .slice(0, 500);
}

function redactPayload(value: unknown): Record<string, unknown> {
  try {
    return { preview: redactText(JSON.stringify(value ?? {})) };
  } catch (_err) {
    return { preview: redactText(value) };
  }
}

async function shortHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value || "unknown");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractState(payload: any): string | null {
  return payload?.instance?.state
    || payload?.state
    || payload?.connectionState?.state
    || payload?.connectionStatus
    || payload?.status
    || null;
}

function extractDisconnectionPayload(instance: any): unknown {
  return instance?.disconnectionObject
    || instance?.instance?.disconnectionObject
    || instance?.error
    || instance?.response
    || null;
}

function classifyExternalConnection(state: string | null, raw: unknown): { reasonCode: string; critical: boolean } {
  const rawText = redactText(raw).toLowerCase();
  const normalized = String(state || "").toLowerCase();

  if (rawText.includes("device_removed")) return { reasonCode: "WA_DEVICE_REMOVED", critical: true };
  if (rawText.includes("stream errored") || rawText.includes("stream:error")) return { reasonCode: "WA_STREAM_ERRORED", critical: true };
  if (rawText.includes("conflict")) return { reasonCode: "WA_SESSION_CONFLICT", critical: true };
  if (rawText.includes("401") || rawText.includes("unauthorized")) return { reasonCode: "WA_UNAUTHORIZED", critical: true };
  if (normalized && normalized !== "open") return { reasonCode: "WA_EXTERNAL_NOT_OPEN", critical: false };
  if (!normalized) return { reasonCode: "WA_CONNECTION_STATE_UNAVAILABLE", critical: false };
  return { reasonCode: "WA_CONNECTION_HEALTHY", critical: false };
}

async function fetchExternalConnectionStatus(evoConfig: EvoConfig): Promise<ExternalConnectionStatus> {
  let state: string | null = null;
  let rawError: unknown = {};

  try {
    const stateResp = await fetch(`${evoConfig.baseUrl}/instance/connectionState/${evoConfig.instanceName}`, {
      headers: { apikey: evoConfig.apiKey },
      signal: AbortSignal.timeout(4000),
    });
    const stateText = await stateResp.text();
    let statePayload: any = null;
    try { statePayload = JSON.parse(stateText); } catch (_err) {}
    state = extractState(statePayload);
    if (!stateResp.ok) rawError = statePayload || stateText;
  } catch (err: any) {
    rawError = { error: err.message };
  }

  if (state === "open") {
    return { ok: true, state, reasonCode: "WA_CONNECTION_HEALTHY", critical: false, rawError: {} };
  }

  try {
    const instancesResp = await fetch(`${evoConfig.baseUrl}/instance/fetchInstances`, {
      headers: { apikey: evoConfig.apiKey },
      signal: AbortSignal.timeout(5000),
    });
    const instancesText = await instancesResp.text();
    let instancesPayload: any = null;
    try { instancesPayload = JSON.parse(instancesText); } catch (_err) {}
    const records = Array.isArray(instancesPayload) ? instancesPayload : [];
    const record = records.find((item: any) => {
      const instance = item?.instance || item;
      return instance?.instanceName === evoConfig.instanceName
        || instance?.name === evoConfig.instanceName
        || item?.instanceName === evoConfig.instanceName
        || item?.name === evoConfig.instanceName;
    });
    const instance = record?.instance || record;
    state = extractState(instance) || state;
    rawError = extractDisconnectionPayload(record) || rawError || instance || instancesPayload || instancesText;
  } catch (err: any) {
    rawError = rawError || { error: err.message };
  }

  const classification = classifyExternalConnection(state, rawError);
  return {
    ok: state === "open",
    state,
    reasonCode: classification.reasonCode,
    critical: classification.critical,
    rawError: redactPayload(rawError),
  };
}

async function countDuePending(tenantId: string): Promise<number> {
  const { count } = await supabase
    .from("pending_outbound")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("sent_at", null)
    .is("failed_at", null)
    .lte("scheduled_for", new Date().toISOString());

  return count || 0;
}

async function countSuccessfulRecoverySends(tenantId: string, sinceIso: string | null): Promise<number> {
  let query = supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("direction", "OUTBOUND")
    .eq("sender", "AI");

  if (sinceIso) query = query.gte("created_at", sinceIso);

  const { count } = await query;
  return count || 0;
}

async function countCriticalConnectionEvents(tenantId: string, sinceIso: string | null): Promise<number> {
  const criticalReasonCodes = [
    "WA_DEVICE_REMOVED",
    "WA_STREAM_ERRORED",
    "WA_SESSION_CONFLICT",
    "WA_UNAUTHORIZED",
    "SEND_CRITICAL_DEVICE_REMOVED",
    "SEND_CRITICAL_STREAM_ERRORED",
    "SEND_CRITICAL_SESSION_CONFLICT",
    "SEND_CRITICAL_UNAUTHORIZED",
    "SEND_CRITICAL_CONNECTION_CLOSED",
    "SEND_EVOLUTION_INTERNAL_ERROR",
    "SEND_CRITICAL_INSTANCE_NOT_FOUND",
  ];

  let query = supabase
    .from("whatsapp_connection_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("reason_code", criticalReasonCodes);

  if (sinceIso) query = query.gte("created_at", sinceIso);

  const { count } = await query;
  return count || 0;
}

async function loadRecoveryEvidence(tenantId: string, guardianStatus: any) {
  const sinceIso = guardianStatus?.state_entered_at || guardianStatus?.updated_at || null;
  const [successfulSends, criticalEvents, duePending] = await Promise.all([
    countSuccessfulRecoverySends(tenantId, sinceIso),
    countCriticalConnectionEvents(tenantId, sinceIso),
    countDuePending(tenantId),
  ]);

  return {
    sinceIso,
    successfulSends,
    criticalEvents,
    duePending,
  };
}

async function triggerAdminMonitoringDue(source: string): Promise<void> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-monitoring-dispatcher`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ mode: "due", limit: 5, source }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("[admin-monitoring] dispatcher returned HTTP " + response.status + ": " + redactText(text).slice(0, 240));
    }
  } catch (err: any) {
    console.warn("[admin-monitoring] dispatcher trigger failed:", redactText(err?.message || err).slice(0, 240));
  }
}

function enqueueAdminMonitoringDue(source: string): void {
  const promise = triggerAdminMonitoringDue(source);
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
    edgeRuntime.waitUntil(promise);
    return;
  }

  promise.catch((err) => {
    console.warn("[admin-monitoring] dispatcher fallback failed:", redactText(err?.message || err).slice(0, 240));
  });
}

async function recordConnectionEvent(params: {
  tenantId: string;
  instanceName: string;
  eventType: string;
  externalState: string | null;
  reasonCode: string;
  rawError?: Record<string, unknown>;
  localStatusBefore?: string | null;
  localStatusAfter?: string | null;
  pendingDueCount?: number | null;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("whatsapp_connection_events")
      .insert({
        tenant_id: params.tenantId,
        instance_hash: await shortHash(params.instanceName),
        event_type: params.eventType,
        external_state: params.externalState,
        reason_code: params.reasonCode,
        raw_error_redacted: params.rawError || {},
        local_status_before: params.localStatusBefore || null,
        local_status_after: params.localStatusAfter || null,
        pending_due_count: params.pendingDueCount ?? null,
      })
      .select("id")
      .maybeSingle();

    if (error) throw error;
    return data?.id || null;
  } catch (err) {
    console.warn("Falha ao registrar whatsapp_connection_events:", err);
    return null;
  }
}

async function createCriticalConnectionAlert(
  tenantId: string,
  reasonCode: string,
  message: string,
  context: Record<string, unknown>,
): Promise<string | null> {
  const dedupKey = `whatsapp_connection:${tenantId}:${reasonCode}`;
  const { data: existingAlert } = await supabase
    .from("operational_alerts")
    .select("id")
    .eq("dedup_key", dedupKey)
    .maybeSingle();

  if (existingAlert) return existingAlert.id;

  const alertId = uuid();
  const { error: alertError } = await supabase.from("operational_alerts").insert({
    id: alertId,
    type: "whatsapp_connection_guard",
    severity: "CRITICAL",
    tenant_id: tenantId,
    title: "WhatsApp bloqueado pelo guardiao de conexao",
    message,
    context,
    dedup_key: dedupKey,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (alertError) {
    console.warn("Falha ao criar operational_alerts:", alertError);
    return null;
  }

  const { data: userAdmin } = await supabase
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (userAdmin?.id) {
    await supabase.from("notifications").insert({
      id: uuid(),
      tenant_id: tenantId,
      user_id: userAdmin.id,
      type: "whatsapp_connection_guard",
      title: "WhatsApp pausado por seguranca",
      body: "O envio foi interrompido porque a conexao real do WhatsApp nao esta saudavel. Reconecte o aparelho e aguarde a quarentena antes de retomar.",
      data: { reason_code: reasonCode },
      created_at: new Date().toISOString(),
    });
  }

  return alertId;
}

async function updateGuardianConnectionState(
  tenantId: string,
  status: string,
  externalState: string | null,
  reasonCode: string | null,
  extra: Record<string, unknown> = {},
) {
  const nowIso = new Date().toISOString();
  const { data: previousStatus } = await supabase
    .from("whatsapp_guardian_status")
    .select("status, state_entered_at, quarantined_until, circuit_open_until")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const statePatch = buildGuardianStatePatch({
    previousStatus: previousStatus?.status || null,
    nextStatus: status,
    reasonCode,
    source: String(extra.state_source || "send-messages"),
    nowIso,
    previousStateEnteredAt: previousStatus?.state_entered_at || null,
  });
  const payload = {
    status,
    external_state: externalState,
    external_checked_at: nowIso,
    last_disconnect_reason_code: reasonCode,
    updated_at: nowIso,
    state_entered_at: statePatch.state_entered_at,
    ...(statePatch.state_reason_code !== undefined ? { state_reason_code: statePatch.state_reason_code } : {}),
    ...(statePatch.state_source !== undefined ? { state_source: statePatch.state_source } : {}),
    ...extra,
  };

  const { error } = await supabase
    .from("whatsapp_guardian_status")
    .update(payload)
    .eq("tenant_id", tenantId);

  if (error) {
    await supabase
      .from("whatsapp_guardian_status")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId);
  }

  if (!error) {
    await recordGuardianStateTransition({
      supabase,
      tenantId,
      previousStatus: previousStatus?.status || null,
      nextStatus: status,
      externalState,
      reasonCode,
      source: String(extra.state_source || "send-messages"),
      enteredAt: nowIso,
      metadata: {
        quarantined_until: extra.quarantined_until || previousStatus?.quarantined_until || null,
        circuit_open_until: extra.circuit_open_until || previousStatus?.circuit_open_until || null,
      },
    });
  }
}

async function runConnectionHealthGuard(
  tenantId: string,
  evoConfig: EvoConfig | null,
  guardianStatus: any,
  guardianConfig: any,
): Promise<ConnectionGuardDecision> {
  const mode = getGuardMode("WA_PRE_SEND_HEALTH_CHECK_MODE", "BLOCK");
  const quarantineUntil = guardianStatus?.quarantined_until || null;
  const isQuarantined = quarantineUntil ? new Date(quarantineUntil).getTime() > Date.now() : false;

  if (mode === "OFF") {
    return {
      allowSend: true,
      allowNewActive: !isQuarantined,
      reasonCode: "WA_CONNECTION_GUARD_OFF",
      externalState: guardianStatus?.external_state || null,
      isQuarantined,
      quarantinedUntil: quarantineUntil,
      numberState: guardianStatus?.status || "NORMAL",
    };
  }

  if (!evoConfig || !evoConfig.apiKey) {
    const pendingDueCount = await countDuePending(tenantId);
    await recordConnectionEvent({
      tenantId,
      instanceName: evoConfig?.instanceName || "missing",
      eventType: "PRE_SEND_HEALTH_CHECK",
      externalState: null,
      reasonCode: "WA_CONFIG_MISSING",
      rawError: { error: "Evolution config missing" },
      localStatusBefore: guardianStatus?.status,
      localStatusAfter: "PAUSED",
      pendingDueCount,
    });

    if (isBlockingMode(mode)) {
      await updateGuardianConnectionState(tenantId, "PAUSED", null, "WA_CONFIG_MISSING");
    }

    return {
      allowSend: !isBlockingMode(mode),
      allowNewActive: false,
      reasonCode: "WA_CONFIG_MISSING",
      externalState: null,
      isQuarantined,
      quarantinedUntil: quarantineUntil,
      numberState: "PAUSED",
    };
  }

  const external = await fetchExternalConnectionStatus(evoConfig);
  const pendingDueCount = await countDuePending(tenantId);

  if (external.ok) {
    const previousStatus = guardianStatus?.status || null;
    let healthyStatus = statusAfterHealthyExternalState(guardianStatus, external.state);
    let transitionReasonCode: string | null = null;
    const recoveryGuardian = getGuardianByKey(guardianConfig, "G25_WHATSAPP_RECOVERY_REALIGNMENT");

    if (String(previousStatus || "").toUpperCase() === "RECOVERY") {
      const recoveryEvidence = await loadRecoveryEvidence(tenantId, guardianStatus);
      const minDurationMinutes = guardianNumber(recoveryGuardian, "recovery_min_duration_minutes", 120);
      const minSuccessfulSends = guardianNumber(recoveryGuardian, "recovery_min_successful_sends", 8);

      if (shouldPromoteRecoveryToNormal({
        guardianStatus: { ...guardianStatus, status: healthyStatus },
        externalState: external.state,
        minDurationMinutes,
        minSuccessfulSends,
        successfulSends: recoveryEvidence.successfulSends,
        criticalEvents: recoveryEvidence.criticalEvents,
        duePending: recoveryEvidence.duePending,
      })) {
        healthyStatus = "NORMAL";
        transitionReasonCode = "WA_RECOVERY_PROMOTED_TO_NORMAL";
      }
    } else if (healthyStatus === "RECOVERY") {
      transitionReasonCode = "WA_RECOVERY_STARTED";
    }

    await updateGuardianConnectionState(tenantId, healthyStatus, external.state, transitionReasonCode, {
      connected_at: guardianStatus?.connected_at || new Date().toISOString(),
    });
    if (previousStatus === "COLD" && healthyStatus === "RECOVERY") {
      await recordConnectionEvent({
        tenantId,
        instanceName: evoConfig.instanceName,
        eventType: "STATE_TRANSITION",
        externalState: external.state,
        reasonCode: "WA_RECOVERY_STARTED",
        rawError: {
          message: "Quarentena encerrada; retomada segura iniciada automaticamente.",
          connected_at: guardianStatus?.connected_at || null,
          quarantined_until: guardianStatus?.quarantined_until || null,
          circuit_open_until: guardianStatus?.circuit_open_until || null,
          source: "send-messages:pre-send-health",
        },
        localStatusBefore: previousStatus,
        localStatusAfter: healthyStatus,
        pendingDueCount,
      });
    }
    if (previousStatus === "RECOVERY" && healthyStatus === "NORMAL") {
      await recordConnectionEvent({
        tenantId,
        instanceName: evoConfig.instanceName,
        eventType: "STATE_TRANSITION",
        externalState: external.state,
        reasonCode: "WA_RECOVERY_PROMOTED_TO_NORMAL",
        rawError: {
          message: "Retomada segura concluida; operacao normal restaurada automaticamente.",
          connected_at: guardianStatus?.connected_at || null,
          quarantined_until: guardianStatus?.quarantined_until || null,
          circuit_open_until: guardianStatus?.circuit_open_until || null,
          source: "send-messages:pre-send-health",
        },
        localStatusBefore: previousStatus,
        localStatusAfter: healthyStatus,
        pendingDueCount,
      });
    }
    return {
      allowSend: true,
      allowNewActive: !isQuarantined,
      reasonCode: "WA_CONNECTION_HEALTHY",
      externalState: external.state,
      isQuarantined,
      quarantinedUntil: quarantineUntil,
      numberState: healthyStatus,
    };
  }

  const nextStatus = external.critical ? "SUSPENDED" : "PAUSED";
  const connectionEventId = await recordConnectionEvent({
    tenantId,
    instanceName: evoConfig.instanceName,
    eventType: "PRE_SEND_HEALTH_CHECK",
    externalState: external.state,
    reasonCode: external.reasonCode,
    rawError: external.rawError,
    localStatusBefore: guardianStatus?.status,
    localStatusAfter: isBlockingMode(mode) ? nextStatus : guardianStatus?.status,
    pendingDueCount,
  });

  if (isBlockingMode(mode)) {
    const circuitMinutes = external.critical
      ? getNumberEnv("WA_CRITICAL_CIRCUIT_OPEN_MINUTES", 60)
      : getNumberEnv("WA_TRANSIENT_CIRCUIT_OPEN_MINUTES", 15);
    await updateGuardianConnectionState(tenantId, nextStatus, external.state, external.reasonCode, {
      locked_at: null,
      circuit_open_until: new Date(Date.now() + circuitMinutes * 60 * 1000).toISOString(),
    });

    if (external.critical) {
      const operationalAlertId = await createCriticalConnectionAlert(
        tenantId,
        external.reasonCode,
        `Envio bloqueado: conexao Evolution/WhatsApp em estado ${external.state || "desconhecido"}.`,
        { reason_code: external.reasonCode, external_state: external.state, pending_due_count: pendingDueCount },
      );
      try {
        await dispatchAdminDisconnectAlert({
          supabase,
          tenantId,
          reasonCode: external.reasonCode,
          externalState: external.state,
          connectionEventId,
          operationalAlertId,
          pendingDueCount,
          source: "send-messages:pre-send-health",
        });
      } catch (err) {
        console.warn("Falha ao disparar alerta admin de desconexao:", err);
      }
    }
  }

  return {
    allowSend: !isBlockingMode(mode),
    allowNewActive: false,
    reasonCode: external.reasonCode,
    externalState: external.state,
    isQuarantined,
    quarantinedUntil: quarantineUntil,
    numberState: nextStatus,
  };
}

function classifySendFailure(error: string): { critical: boolean; status: "PAUSED" | "SUSPENDED"; reasonCode: string } {
  const errText = (error || "").toLowerCase();

  if (errText.includes("device_removed")) return { critical: true, status: "SUSPENDED", reasonCode: "SEND_CRITICAL_DEVICE_REMOVED" };
  if (errText.includes("stream errored") || errText.includes("stream:error")) return { critical: true, status: "SUSPENDED", reasonCode: "SEND_CRITICAL_STREAM_ERRORED" };
  if (errText.includes("conflict")) return { critical: true, status: "SUSPENDED", reasonCode: "SEND_CRITICAL_SESSION_CONFLICT" };
  if (errText.includes("401") || errText.includes("unauthorized")) return { critical: true, status: "SUSPENDED", reasonCode: "SEND_CRITICAL_UNAUTHORIZED" };
  if (errText.includes("connection closed")) return { critical: true, status: "PAUSED", reasonCode: "SEND_CRITICAL_CONNECTION_CLOSED" };
  if (errText.includes("cannot read properties of undefined")) return { critical: true, status: "PAUSED", reasonCode: "SEND_EVOLUTION_INTERNAL_ERROR" };
  if (errText.includes("instance does not exist") || errText.includes("not found")) return { critical: true, status: "SUSPENDED", reasonCode: "SEND_CRITICAL_INSTANCE_NOT_FOUND" };

  return { critical: false, status: "PAUSED", reasonCode: "SEND_TRANSIENT_ERROR" };
}

// ── OpenAI Helper ───────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt: string, userMessage: string, maxTokens = 100): Promise<string> {
  try {
    const payload = {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    };

    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) return "";
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.error("OpenAI Error:", err);
    return "";
  }
}

// ── Intelligence: Pré-Abordagem (Icebreaker) ────────────────────────────────
async function generateIcebreaker(lead: any): Promise<string> {
  // If the lead is generic and has no QSA, fallback to standard
  const hasQsa = lead.metadata?.cnpj_info?.qsa?.length > 0;
  if (!hasQsa && !lead.metadata?.cnpj_info?.cnae_principal) return "";

  const qsaNames = lead.metadata?.cnpj_info?.qsa?.map((q: any) => q.nome).join(", ");
  const cnaeDesc = lead.metadata?.cnpj_info?.cnae_principal?.descricao || lead.profession || "empresa";
  const empresaNome = lead.metadata?.cnpj_info?.nomeFantasia || lead.metadata?.cnpj_info?.razaoSocial || lead.name;
  const dataAbertura = lead.metadata?.cnpj_info?.dataAbertura || "";

  const systemPrompt = `Você é um SDR gerador de quebra-gelos curtos.
Sua missão é ler os dados públicos de uma empresa e gerar UMA ÚNICA FRASE de elogio ou reconhecimento profissional para iniciar uma conversa no WhatsApp.
Exemplo: "Vi que vocês já estão há 5 anos consolidados no mercado de advocacia em São Paulo..." ou "Parabéns pelo trabalho na Amorim Assessoria!".
NÃO faça perguntas, NÃO se apresente. APENAS gere a frase (curta, simpática e profissional).`;

  const userPrompt = `Empresa: ${empresaNome}\nRamo/CNAE: ${cnaeDesc}\nSócios: ${qsaNames}\nData de Abertura: ${dataAbertura}`;

  const icebreaker = await callOpenAI(systemPrompt, userPrompt, 50);
  return icebreaker;
}

// ── Send WhatsApp Message via Evolution API ─────────────────────────────────
async function sendWhatsApp(
  evoConfig: EvoConfig,
  phone: string,
  text: string,
  mediaUrl?: string | null,
  mediaType?: string | null
): Promise<{ ok: boolean; whatsappMsgId?: string; error?: string }> {
  try {
    let url = `${evoConfig.baseUrl}/message/sendText/${evoConfig.instanceName}`;
    let body: any = { number: phone, text };

    if (mediaUrl) {
      url = `${evoConfig.baseUrl}/message/sendMedia/${evoConfig.instanceName}`;
      body = {
        number: phone,
        mediatype: mediaType || "document",
        mimetype: "application/pdf",
        caption: text,
        media: mediaUrl,
        fileName: "Apresentacao_Prospix.pdf"
      };
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evoConfig.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return { ok: false, error: `HTTP ${resp.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await resp.json();
    // Evolution API returns: { key: { id: "whatsapp_msg_id" }, ... }
    const whatsappMsgId = data?.key?.id || data?.messageId || null;
    return { ok: true, whatsappMsgId };
  } catch (err: any) {
    return { ok: false, error: err.message?.slice(0, 200) };
  }
}

// Helper para inferir o gênero a partir do primeiro nome para fins de saudação (Dr./Dra.)
function getGenderFromFirstName(name: string): 'M' | 'F' {
  if (!name) return 'M';
  const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const masculineExceptions = [
    'luca', 'lucas', 'jean', 'george', 'andre', 'felipe', 'alexandre', 'guilherme', 'henrique',
    'mateus', 'matheus', 'jonas', 'isaias', 'elias', 'josias', 'messias', 'natan', 'natanael',
    'samuel', 'daniel', 'gabriel', 'rafael', 'miguel', 'murilo', 'danilo', 'angelo', 'otavio',
    'caio', 'heitor', 'igor', 'yuri', 'enzo', 'davi', 'arthur', 'artur', 'ian', 'caua', 'bento'
  ];

  const feminineExceptions = [
    'beatriz', 'alice', 'yasmin', 'iasmin', 'raquel', 'rachel', 'irene', 'miriam', 'ester', 'esther',
    'carol', 'caroline', 'carolina', 'nair', 'ines', 'cleide', 'suely', 'sueli', 'elisabeth',
    'elizabeth', 'elis', 'elisregina', 'ruth', 'rose', 'roseli', 'rosely', 'marlene', 'solange',
    'gisele', 'giselle', 'lourdes', 'margarida', 'vivian', 'viviane', 'tati', 'tatiane', 'carmen',
    'carminha', 'luiza', 'luisa', 'isis', 'yara', 'iara', 'ellen', 'helen', 'helena', 'eliane',
    'elisangela', 'simone', 'denise', 'marise', 'rosane', 'cristiane', 'adriana'
  ];

  if (feminineExceptions.includes(cleanName)) return 'F';
  if (masculineExceptions.includes(cleanName)) return 'M';
  if (cleanName.endsWith('a')) return 'F';
  if (cleanName.endsWith('y') && !['wesley', 'valdecy', 'roney', 'rudy', 'darcy'].includes(cleanName)) return 'F';

  return 'M';
}

// ── Variable Substitution ───────────────────────────────────────────────────
async function substituteVariables(message: string, lead: any): Promise<string> {
  let result = message;

  // Try to find a real person's name (Partner/Socio) in the enriched CNPJ QSA
  let personName = "";
  if (lead.metadata && lead.metadata.cnpj_info && lead.metadata.cnpj_info.qsa && lead.metadata.cnpj_info.qsa.length > 0) {
    const socio = lead.metadata.cnpj_info.qsa[0].nome;
    if (socio) personName = socio;
  }

  // If no socio found, check if lead.name looks like a generic company name
  const leadName = lead.name || "";
  let firstName = "";

  if (personName) {
    // Take the first name of the partner and capitalize it
    const parts = personName.split(" ");
    firstName = parts[0];
    firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  } else {
    // Fallback logic
    const lowerName = leadName.toLowerCase();
    const genericTerms = ['advocacia', 'advogado', 'advogados', 'assessoria', 'consultoria', 'escritório', 'clínica', 'centro', 'instituto', 'odontologia', 'saúde'];
    const isGeneric = genericTerms.some(term => lowerName.includes(term));

    if (isGeneric) {
      firstName = "Responsável"; // Fallback to "Responsável" if it's a generic company name
    } else {
      // Remove prefixos Dr./Dra. se presentes no nome original do lead para evitar duplicações
      const cleanLeadName = leadName.replace(/^(dr\.|dra\.|dr|dra)\s+/gi, "");
      firstName = cleanLeadName.split(" ")[0] || "";
      firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    }
  }

  const company = lead.metadata?.cnpj_info?.nomeFantasia || lead.metadata?.cnpj_info?.razaoSocial || lead.name || "";
  const city = lead.address?.city?.split(" - ")?.[0]?.trim() || "";

  // Inferir o gênero do nome destinatário
  const gender = getGenderFromFirstName(firstName);

  // Ajustar dinamicamente o prefixo Dr. ou Dra. se estiver logo antes do placeholder de Nome
  if (gender === 'F') {
    result = result.replace(/Dr\.\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dra. ');
    result = result.replace(/Dr\b(?!\.)\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dra ');
  } else {
    result = result.replace(/Dra\.\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dr. ');
    result = result.replace(/Dra\b(?!\.)\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dr ');
  }

  // Support both [Nome], [nome], {Nome}, {nome}, {{Nome}}, {{nome}} (one or more curly braces/brackets)
  result = result.replace(/(\[|\{)+Nome(\]|\})+/gi, firstName || leadName);
  result = result.replace(/(\[|\{)+Empresa(\]|\})+/gi, company);
  result = result.replace(/(\[|\{)+Cidade(\]|\})+/gi, city);

  // Icebreaker Logic
  if (result.match(/(\[|\{)+Icebreaker(\]|\})+/gi) || result.match(/(\[|\{)+Quebra-gelo(\]|\})+/gi)) {
    const icebreaker = await generateIcebreaker(lead);
    result = result.replace(/(\[|\{)+Icebreaker(\]|\})+/gi, icebreaker);
    result = result.replace(/(\[|\{)+Quebra-gelo(\]|\})+/gi, icebreaker);
  }

  return result;
}

// ── Weighted Variation Selection ────────────────────────────────────────────
function pickVariation(variations: any[]): any {
  const active = variations.filter((v: any) => v.active);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  const totalWeight = active.reduce((sum: number, v: any) => sum + (v.weight || 0), 0);
  if (totalWeight <= 0) return active[0];

  let rand = Math.random() * totalWeight;
  for (const v of active) {
    rand -= v.weight || 0;
    if (rand <= 0) return v;
  }
  return active[active.length - 1];
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 1: Send first-touch messages to ENRICHED leads
// ══════════════════════════════════════════════════════════════════════════════
async function processFirstTouch(
  tenantId: string,
  processedLeadIds: Set<string>,
  guardianConfig: Awaited<ReturnType<typeof GuardianRunner.loadConfig>>,
  options: { maxToQueue?: number; selectiveRetryOnly?: boolean } = {},
): Promise<{ queued: number; failed: number }> {
  let queued = 0, failed = 0;
  const maxToQueue = Math.max(0, Math.floor(options.maxToQueue ?? Number.POSITIVE_INFINITY));
  if (maxToQueue === 0) return { queued, failed };

  const brtHour = getBrtHour();
  const brtDate = getBrtDateStr();

  // Get campaign for this tenant (only ACTIVE campaigns)
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "ACTIVE");

  if (!campaigns?.length) {
    return { queued, failed };
  }

  for (const campaign of campaigns) {
    if (queued >= maxToQueue) break;

    // ── Check hour window (BRT) ──────────────────────────────
    const windowStart = campaign.hour_window_start ?? 8;
    const windowEnd = campaign.hour_window_end ?? 20;
    if (brtHour < windowStart || brtHour >= windowEnd) {
      continue;
    }

    // ── Check daily limit ────────────────────────────────────
    const { count: sentToday } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("direction", "OUTBOUND")
      .eq("sender", "AI")
      .gte("created_at", brtDate + "T00:00:00-03:00")
      .lte("created_at", brtDate + "T23:59:59-03:00");

    const dailyLimit = campaign.daily_limit || 50;
    const alreadySent = sentToday || 0;
    const remaining = Math.max(0, dailyLimit - alreadySent);

    if (remaining <= 0) {
      continue;
    }

    // ── Find script for this campaign ────────────────────────
    let scriptId = campaign.active_script_id;
    let script: any = null;

    if (scriptId) {
      const { data: s } = await supabase
        .from("scripts")
        .select("*")
        .eq("id", scriptId)
        .eq("tenant_id", tenantId)
        .eq("status", "ACTIVE")
        .eq("category", "APPROACH")
        .maybeSingle();
      script = s;
    }

    if (!script && scriptId) {
      failed++;
      continue;
    }

    if (!script) {
      const { data: scripts } = await supabase
        .from("scripts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "ACTIVE")
        .eq("category", "APPROACH")
        .order("total_usages", { ascending: false });

      if (scripts?.length) {
        const compatibleScripts = scripts.filter((s: any) => !s.target_profession || s.target_profession === campaign.profession);
        script = compatibleScripts.find((s: any) => s.target_profession === campaign.profession)
          || compatibleScripts.find((s: any) => !s.target_profession)
          || null;
      }
    }

    if (!script) {
      failed++;
      continue;
    }

    // ── Load script variations ───────────────────────────────
    const { data: variations } = await supabase
      .from("script_variations")
      .select("*")
      .eq("script_id", script.id)
      .eq("active", true);

    if (!variations?.length) {
      failed++;
      continue;
    }

    // ── Find canonically eligible ENRICHED leads for this campaign ────────────────
    let eligibilityQuery = supabase
      .from("first_touch_lead_eligibility")
      .select("lead_id, fit_score, created_at, has_failed_first_touch_queue")
      .eq("campaign_id", campaign.id)
      .eq("tenant_id", tenantId)
      .eq("script_id", script.id)
      .eq("is_eligible_now", true);

    if (options.selectiveRetryOnly) {
      eligibilityQuery = eligibilityQuery.eq("has_failed_first_touch_queue", true);
    }

    if (processedLeadIds.size > 0) {
      eligibilityQuery = eligibilityQuery.not("lead_id", "in", `(${Array.from(processedLeadIds).map(id => `'${id}'`).join(",")})`);
    }

    const { data: eligibleRows, error: eligibilityError } = await eligibilityQuery
      .order("fit_score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(5);

    let leads: any[] | null = null;

    if (eligibilityError) {
      if (options.selectiveRetryOnly) {
        console.warn("  [First Touch] Canonical eligibility view unavailable; RECOVERY legacy fallback blocked to avoid broad reprocessing.");
        continue;
      }

      console.warn("  [First Touch] Canonical eligibility view unavailable, using legacy candidate query. Error: " + eligibilityError.message);

      let query = supabase
        .from("leads")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("tenant_id", tenantId)
        .eq("status", "ENRICHED")
        .is("contacted_at", null)
        .is("queued_first_touch_at", null)
        .not("whatsapp", "is", null)
        .or("whatsapp_valid.is.null,whatsapp_valid.eq.true");

      if (processedLeadIds.size > 0) {
        query = query.not("id", "in", `(${Array.from(processedLeadIds).map(id => `'${id}'`).join(",")})`);
      }

      const { data: legacyLeads } = await query
        .order("fit_score", { ascending: false })
        .limit(5);
      leads = legacyLeads || [];
    } else if (eligibleRows?.length) {
      const eligibleLeadIds = eligibleRows.map((row: any) => row.lead_id).filter(Boolean);
      const { data: leadRows, error: leadFetchError } = await supabase
        .from("leads")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("id", eligibleLeadIds);

      if (leadFetchError) {
        console.error("  [First Touch] Erro ao carregar leads elegiveis canonicos: " + leadFetchError.message);
        failed++;
        continue;
      }

      const leadById = new Map((leadRows || []).map((lead: any) => [lead.id, lead]));
      leads = eligibleLeadIds.map((leadId: string) => leadById.get(leadId)).filter(Boolean);
    } else {
      leads = [];
    }

    if (!leads?.length) {
      continue;
    }

    // Iterar sobre os candidatos encontrados até achar um válido
    for (const lead of leads) {
      const phone = lead.whatsapp || "";
      const companyName = (lead.name || "").toLowerCase().trim();

      // A. Filtro de Telefone Celular Móvel (Regex)
      const cleanPhone = phone.replace(/\D/g, "");
      const isCelular = /^55\d{2}9\d{8}$/.test(cleanPhone);

      if (!isCelular) {
        console.log(`  🚫 [Filtro Celular] Lead "${lead.name}" (ID: ${lead.id}) pulado. Telefone fixo/inválido: ${phone}`);
        await supabase
          .from("leads")
          .update({
            status: "INVALID_NUMBER",
            updated_at: new Date().toISOString()
          })
          .eq("id", lead.id);

        processedLeadIds.add(lead.id); // Evita reprocessar no mesmo loop
        continue;
      }

      // B. Filtro de Nomes Comerciais/Empresas (Lista Negra)
      const scriptProfession = (script.target_profession || "").toLowerCase();
      const isTargetProfessionLiberal = scriptProfession.includes("médico") || scriptProfession.includes("medico") || scriptProfession.includes("doctor") || scriptProfession.includes("doutor") || scriptProfession.includes("advogado") || scriptProfession.includes("lawyer") || scriptProfession.includes("dentist") || scriptProfession.includes("dentista") || scriptProfession.includes("direito") || scriptProfession.includes("saúde") || scriptProfession.includes("saude");

      if (isTargetProfessionLiberal) {
        const blacklist = ['pousada', 'hotel', 'chácara', 'chacara', 'variedades', 'artesanato', 'imports', 'turismo', 'parque', 'restaurante', 'grill', 'picanha', 'tintas', 'loja', 'loteamento', 'auto', 'mecânica', 'mecanica', 'oficina', 'barbearia', 'salão', 'salao', 'construção', 'construcao', 'distribuidora', 'mercado', 'supermercado', 'padaria', 'confeitaria'];
        const hasCommercialTerm = blacklist.some(term => companyName.includes(term));

        if (hasCommercialTerm) {
          console.log(`  🚫 [Filtro Comercial] Lead "${lead.name}" (ID: ${lead.id}) pulado. Termo comercial incompatível com script liberal.`);
          await supabase
            .from("leads")
            .update({
              status: "COMMERCIAL_LEAD_SKIPPED",
              updated_at: new Date().toISOString()
            })
            .eq("id", lead.id);

          processedLeadIds.add(lead.id); // Evita reprocessar no mesmo loop
          continue;
        }
      }

      // C. Check optouts
      const { data: optout } = await supabase
        .from("optouts")
        .select("whatsapp")
        .eq("tenant_id", tenantId)
        .eq("whatsapp", phone)
        .maybeSingle();

      if (optout) {
        processedLeadIds.add(lead.id);
        continue;
      }

      // Se passou em todos os filtros, tentar enfileirar
      try {
        const variation = pickVariation(variations);
        if (!variation) {
          processedLeadIds.add(lead.id);
          continue;
        }

        const nowTime = new Date().toISOString();
        const firstTouchPreGenerationRun = await GuardianRunner.observe({
          supabase,
          config: guardianConfig,
          tenantId,
          leadId: lead.id,
          stage: "PRE_GENERATION",
          functionScope: "send-messages",
          input: {
            source: "first_touch",
            campaign_id: campaign.id,
            script_id: script.id,
            variation_id: variation.id,
          },
          facts: {
            ai_handling: true,
            conversation_status: "OPENING_READY",
            lead_status: lead.status || null,
            relevance_score: lead.relevance_score ?? null,
            relevance_status: lead.relevance_status ?? null,
            fit_score: lead.fit_score ?? null,
            phone_validation_status: lead.phone_validation_status ?? null,
            phone_validation_confidence: lead.phone_validation_confidence ?? null,
            entity_type: lead.entity_type ?? null,
            identity_confidence: lead.identity_confidence ?? null,
            target_profession: script.target_profession || null,
            campaign_profession: campaign.profession || null,
          },
        });

        if (!firstTouchPreGenerationRun.allow) {
          const reasonCode = firstTouchPreGenerationRun.blockingDecision?.reason_code || "GUARDIAN_PHASE5_FIRST_TOUCH_PRE_GENERATION_BLOCKED";
          const guardianKey = firstTouchPreGenerationRun.blockingDecision?.guardian_key || null;

          await supabase.from("leads").update({
            queued_first_touch_at: nowTime,
            lead_guardian_flags: {
              ...(
                lead.lead_guardian_flags && typeof lead.lead_guardian_flags === "object"
                  ? lead.lead_guardian_flags
                  : {}
              ),
              guardian_engine_v3: {
                phase: firstTouchPreGenerationRun.summary.phase,
                blocked_at: nowTime,
                stage: "PRE_GENERATION",
                reason_code: reasonCode,
                guardian_key: guardianKey,
                campaign_id: campaign.id,
                script_id: script.id,
                variation_id: variation.id,
              },
            },
            updated_at: nowTime,
          }).eq("id", lead.id);

          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: "guardian_blocked_first_touch",
            payload: {
              source: "first_touch",
              stage: "PRE_GENERATION",
              guardian_key: guardianKey,
              reason_code: reasonCode,
              validation_summary: firstTouchPreGenerationRun.summary,
              reason: "Guardian Engine V3 bloqueou primeira abordagem antes de gerar/enfileirar por relevancia ou estado.",
            },
            created_at: nowTime,
          });

          processedLeadIds.add(lead.id);
          console.warn("  [Guardian V3] Primeira abordagem bloqueada antes da geracao. Lead: " + lead.id + " Reason: " + reasonCode);
          continue;
        }

        const messageContent = await substituteVariables(variation.message, lead);
        const reusableConversation = await loadReusableFirstTouchConversation(tenantId, lead.id);
        const conversationId = reusableConversation?.id || uuid();
        const firstTouchAttemptCount = await countFirstTouchAttemptsForLead(tenantId, lead.id);
        const firstTouchIdempotencyKey = firstTouchAttemptCount > 0
          ? `active-retry-${lead.id}-${firstTouchAttemptCount + 1}`
          : `active-${lead.id}`;
        const firstTouchCandidatePayload = buildCandidatePayload({
          messages: [messageContent],
          intent: "OTHER",
          leadName: lead.name,
        });
        const firstTouchGuardianRun = await GuardianRunner.observe({
          supabase,
          config: guardianConfig,
          tenantId,
          leadId: lead.id,
          stage: "POST_GENERATION",
          functionScope: "send-messages",
          input: {
            source: "first_touch",
            script_id: script.id,
            variation_id: variation.id,
          },
          output: firstTouchCandidatePayload,
          facts: {
            lead_name: lead.name || null,
            title_verified: lead.title_verified ?? null,
            identity_confidence: lead.identity_confidence ?? null,
            gender_confidence: lead.gender_confidence ?? null,
            entity_type: lead.entity_type ?? null,
            lead_status: lead.status || null,
            relevance_score: lead.relevance_score ?? null,
            relevance_status: lead.relevance_status ?? null,
            fit_score: lead.fit_score ?? null,
            phone_validation_status: lead.phone_validation_status ?? null,
            phone_validation_confidence: lead.phone_validation_confidence ?? null,
            target_profession: script.target_profession || null,
            campaign_profession: campaign.profession || null,
          },
        });

        if (!firstTouchGuardianRun.allow) {
          const reasonCode = firstTouchGuardianRun.blockingDecision?.reason_code || "GUARDIAN_PHASE5_FIRST_TOUCH_BLOCKED";
          const guardianKey = firstTouchGuardianRun.blockingDecision?.guardian_key || null;

          await supabase.from("leads").update({
            queued_first_touch_at: nowTime,
            lead_guardian_flags: {
              ...(
                lead.lead_guardian_flags && typeof lead.lead_guardian_flags === "object"
                  ? lead.lead_guardian_flags
                  : {}
              ),
              guardian_engine_v3: {
                phase: firstTouchGuardianRun.summary.phase,
                blocked_at: nowTime,
                stage: "POST_GENERATION",
                reason_code: reasonCode,
                guardian_key: guardianKey,
                script_id: script.id,
                variation_id: variation.id,
              },
            },
            updated_at: nowTime,
          }).eq("id", lead.id);

          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: "guardian_blocked_outbound",
            payload: {
              source: "first_touch",
              guardian_key: guardianKey,
              reason_code: reasonCode,
              validation_summary: firstTouchGuardianRun.summary,
              reason: "Guardian Engine V3 bloqueou primeira abordagem antes da fila.",
            },
            created_at: nowTime,
          });

          processedLeadIds.add(lead.id);
          console.warn("  [Guardian V3] Primeira abordagem bloqueada antes da fila. Lead: " + lead.id + " Reason: " + reasonCode);
          continue;
        }

        const g18Guardian = getGuardianByKey(guardianConfig, "G18_BUSINESS_HOURS");
        const g20Guardian = getGuardianByKey(guardianConfig, "G20_CONTACT_CADENCE");
        let plannedScheduledFor = computeFirstResponseScheduledFor(g20Guardian, nowTime, `first-touch:${tenantId}:${lead.id}`);
        let queueValidationStatus = "APPROVED";
        let queueValidationReasonCode = firstTouchGuardianRun.summary.warn > 0 ? "GUARDIAN_PHASE5_WARN_OBSERVED" : "GUARDIAN_PHASE5_PASS";
        let queueFinalDecision = firstTouchGuardianRun.summary.warn > 0 ? "WARN" : "PASS";

        const firstTouchPreEnqueueRun = await GuardianRunner.observe({
          supabase,
          config: guardianConfig,
          tenantId,
          leadId: lead.id,
          conversationId,
          stage: "PRE_ENQUEUE",
          functionScope: "send-messages",
          input: {
            source: "first_touch",
            campaign_id: campaign.id,
            script_id: script.id,
            variation_id: variation.id,
          },
          output: firstTouchCandidatePayload,
          facts: {
            now_iso: nowTime,
            scheduled_for: plannedScheduledFor,
            message_type: "OUTBOUND_START",
            bucket_key: `first-touch:${tenantId}:${lead.id}`,
          },
        });

        const firstTouchDelay = extractDelayDecision(firstTouchPreEnqueueRun);
        if (firstTouchDelay) {
          plannedScheduledFor = firstTouchDelay.scheduledFor;
          queueValidationStatus = "DELAYED";
          queueValidationReasonCode = firstTouchDelay.reasonCode;
          queueFinalDecision = "DELAY";
        } else if (!firstTouchPreEnqueueRun.allow) {
          const reasonCode = firstTouchPreEnqueueRun.blockingDecision?.reason_code || "GUARDIAN_PHASE6_FIRST_TOUCH_PRE_ENQUEUE_BLOCKED";
          const guardianKey = firstTouchPreEnqueueRun.blockingDecision?.guardian_key || null;

          await supabase.from("leads").update({
            queued_first_touch_at: nowTime,
            lead_guardian_flags: {
              ...(
                lead.lead_guardian_flags && typeof lead.lead_guardian_flags === "object"
                  ? lead.lead_guardian_flags
                  : {}
              ),
              guardian_engine_v3: {
                phase: firstTouchPreEnqueueRun.summary.phase,
                blocked_at: nowTime,
                stage: "PRE_ENQUEUE",
                reason_code: reasonCode,
                guardian_key: guardianKey,
                script_id: script.id,
                variation_id: variation.id,
              },
            },
            updated_at: nowTime,
          }).eq("id", lead.id);

          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: "guardian_blocked_outbound",
            payload: {
              source: "first_touch",
              guardian_key: guardianKey,
              reason_code: reasonCode,
              validation_summary: firstTouchPreEnqueueRun.summary,
              reason: "Guardian Engine V3 bloqueou primeira abordagem antes de entrar na fila.",
            },
            created_at: nowTime,
          });

          processedLeadIds.add(lead.id);
          console.warn("  [Guardian V3] Primeira abordagem bloqueada no pre-enfileiramento. Lead: " + lead.id + " Reason: " + reasonCode);
          continue;
        }

        const conversationPayload = {
          script_id: script.id,
          status: "ACTIVE",
          ai_handling: true,
          current_node_id: null,
          last_message: messageContent.substring(0, 200),
          last_message_at: nowTime,
          last_outbound_at: nowTime,
        };

        if (reusableConversation) {
          const { error: convErr } = await supabase.from("conversations")
            .update(conversationPayload)
            .eq("id", conversationId)
            .eq("tenant_id", tenantId);
          if (convErr) throw new Error("Erro ao reutilizar conversa para retentativa: " + convErr.message);
        } else {
          const { error: convErr } = await supabase.from("conversations").insert({
            id: conversationId,
            tenant_id: tenantId,
            lead_id: lead.id,
            ...conversationPayload,
            message_count: 1,
            started_at: nowTime,
          });
          if (convErr) throw new Error("Erro ao criar conversa: " + convErr.message);
        }

        const { error: queueErr } = await supabase.from("pending_outbound").insert({
          id: uuid(),
          tenant_id: tenantId,
          conversation_id: conversationId,
          content: messageContent,
          idempotency_key: firstTouchIdempotencyKey,
          scheduled_for: plannedScheduledFor,
          attempts: 0,
          message_type: "OUTBOUND_START",
          priority: 6,
          guardian_config_version_id: firstTouchPreEnqueueRun.configVersionId || firstTouchGuardianRun.configVersionId,
          validation_status: queueValidationStatus,
          validation_reason_code: queueValidationReasonCode,
          final_guardian_checked_at: nowTime,
          final_guardian_decision: queueFinalDecision,
        });
        if (queueErr) throw new Error("Erro ao enfileirar mensagem: " + queueErr.message);

        if (firstTouchAttemptCount > 0) {
          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: "first_touch_retry_queued",
            payload: {
              conversation_id: conversationId,
              campaign_id: campaign.id,
              script_id: script.id,
              variation_id: variation.id,
              previous_attempt_count: firstTouchAttemptCount,
              attempt_number: firstTouchAttemptCount + 1,
              idempotency_key: firstTouchIdempotencyKey,
              reason: "Retentativa segura de primeiro contato apos falha recuperavel anterior.",
            },
            created_at: nowTime,
          });
        }

        const { error: leadErr } = await supabase.from("leads").update({
          queued_first_touch_at: nowTime,
          updated_at: nowTime,
        }).eq("id", lead.id);
        if (leadErr) throw new Error("Erro ao atualizar lead: " + leadErr.message);

        const { error: scriptErr } = await supabase.from("scripts").update({
          total_usages: (script.total_usages || 0) + 1,
        }).eq("id", script.id);
        if (scriptErr) throw new Error("Erro ao atualizar script: " + scriptErr.message);

        const { error: variationErr } = await supabase.from("script_variations").update({
          total_sent: (variation.total_sent || 0) + 1,
          updated_at: nowTime,
        }).eq("id", variation.id);
        if (variationErr) throw new Error("Erro ao atualizar variação de script: " + variationErr.message);

        processedLeadIds.add(lead.id);
        queued++;
        if (queued >= maxToQueue) return { queued, failed };
        break; // Processou 1 lead com sucesso para esta campanha, sai do loop de leads
      } catch (err: any) {
        console.error("  💥 Erro ao enfileirar lead: " + err.message);
        failed++;
        processedLeadIds.add(lead.id);
      }
    }
  }

  return { queued, failed };
}

async function runGuardianWorkerForTenant(tenantId: string, runEndTime: number): Promise<{ sent: number; queued: number; failed: number }> {
  let sent = 0, queued = 0, failed = 0;

  // 1. Tentar Lock Lógico Persistente (timeout de 2 min)
  const nowTime = new Date().toISOString();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data: lockUpdate, error: lockErr } = await supabase
    .from("whatsapp_guardian_status")
    .update({ locked_at: nowTime })
    .eq("tenant_id", tenantId)
    .or(`locked_at.is.null,locked_at.lt.${twoMinutesAgo}`)
    .select();

  if (lockErr || !lockUpdate || lockUpdate.length === 0) {
    console.log("  🔒 [Lock Lógico] Worker para tenant " + tenantId + " já está rodando em outra instância.");
    return { sent: 0, queued: 0, failed: 0 };
  }

  console.log("  🚀 [Lock Lógico] Lock adquirido com sucesso para tenant " + tenantId + ". Iniciando processamento...");

  // Inicializar caches locais de memória para esta rodada contra race conditions
  const processedLeadIds = new Set<string>();
  const processedConversationIds = new Set<string>();
  const guardianConfig = await GuardianRunner.loadConfig({ supabase, tenantId });

  try {
    while (Date.now() < runEndTime) {
      // 1. Carregar status do Guardião do Tenant
      let { data: guardianStatus } = await supabase
        .from("whatsapp_guardian_status")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!guardianStatus) {
        const { data: newStatus } = await supabase
          .from("whatsapp_guardian_status")
          .insert({ tenant_id: tenantId, status: "NORMAL", locked_at: nowTime })
          .select("*")
          .single();
        guardianStatus = newStatus;
      }

      const evoConfig = await loadEvoConfig(tenantId);
      const healthDecision = await runConnectionHealthGuard(tenantId, evoConfig, guardianStatus, guardianConfig);

      if (!healthDecision.allowSend) {
        console.log("  [WhatsApp Guard] Envio bloqueado para tenant " + tenantId + ". Motivo: " + healthDecision.reasonCode);
        await sleep(5000);
        continue;
      }

      const numberState = healthDecision.numberState || (
        healthDecision.reasonCode === "WA_CONNECTION_HEALTHY"
          ? statusAfterHealthyExternalState(guardianStatus, healthDecision.externalState)
          : guardianStatus?.status || "NORMAL"
      );

      if (numberState === "PAUSED" || numberState === "SUSPENDED") {
        console.log("  ⏸️ Guardião do tenant " + tenantId + " está pausado ou suspenso. Estado: " + numberState);
        await sleep(5000);
        continue;
      }

      // 2. Coletar estatísticas dinâmicas
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const startOfDay = new Date(new Date().setHours(0,0,0,0)).toISOString();

      const { count: sentLastMinute } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("direction", "OUTBOUND")
        .gte("created_at", oneMinuteAgo);

      const { count: sentLastHour } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("direction", "OUTBOUND")
        .gte("created_at", oneHourAgo);

      const { count: newChatsToday } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("started_at", startOfDay);

      const { count: newChatsLastHour } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("started_at", oneHourAgo);

      const msgsLastMin = sentLastMinute || 0;
      const msgsLastHr = sentLastHour || 0;
      let chatsLastHr = newChatsLastHour || 0;
      let chatsToday = newChatsToday || 0;

      // 3. Definir limites conforme o Estado do Número
      let globalMinDelay = 12;
      let globalDelayRange = { min: 18, max: 45 };
      let maxMsgsPerMin = 3;
      let maxMsgsPerHr = 90;
      let maxNewChatsPerHr = 6;
      let maxNewChatsPerDay = 80;

      if (numberState === "COLD") {
        globalMinDelay = 20;
        globalDelayRange = { min: 45, max: 120 };
        maxMsgsPerMin = 2;
        maxMsgsPerHr = 45;
        maxNewChatsPerHr = 3;
        maxNewChatsPerDay = 20;
      } else if (numberState === "RECOVERY") {
        const recoveryGuardian = getGuardianByKey(guardianConfig, "G25_WHATSAPP_RECOVERY_REALIGNMENT");
        globalMinDelay = guardianNumber(recoveryGuardian, "recovery_min_global_delay_seconds", 18);
        globalDelayRange = {
          min: guardianNumber(recoveryGuardian, "recovery_base_delay_min_seconds", 30),
          max: guardianNumber(recoveryGuardian, "recovery_base_delay_max_seconds", 90),
        };
        maxMsgsPerMin = guardianNumber(recoveryGuardian, "recovery_max_messages_per_minute", 2);
        maxMsgsPerHr = guardianNumber(recoveryGuardian, "recovery_max_messages_per_hour", 60);
        maxNewChatsPerHr = guardianNumber(recoveryGuardian, "recovery_max_new_chats_per_hour", 4);
        maxNewChatsPerDay = guardianNumber(recoveryGuardian, "recovery_max_new_chats_per_day", 30);
      } else if (numberState === "HIGH_LOAD") {
        globalMinDelay = 15;
        globalDelayRange = { min: 25, max: 70 };
        maxMsgsPerMin = 3;
        maxMsgsPerHr = 90;
        maxNewChatsPerHr = 0;
      } else if (numberState === "COOLDOWN") {
        globalMinDelay = 60;
        globalDelayRange = { min: 120, max: 600 };
        maxMsgsPerMin = 1;
        maxMsgsPerHr = 15;
        maxNewChatsPerHr = 0;
      }

      // 4. Verificar se há respostas reativas pendentes na fila
      const { count: reactivePendingCount } = await supabase
        .from("pending_outbound")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("sent_at", null)
        .is("failed_at", null)
        .in("message_type", ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"]);

      const hasReactivePending = (reactivePendingCount || 0) > 0;

      // 5. Enfileiramento de Novas Abordagens Ativas (se puder)
      const canQueueNewActive =
        healthDecision.allowNewActive &&
        numberState !== "COOLDOWN" &&
        numberState !== "PAUSED" &&
        numberState !== "SUSPENDED" &&
        !hasReactivePending &&
        msgsLastHr < maxMsgsPerHr &&
        chatsLastHr < maxNewChatsPerHr &&
        chatsToday < maxNewChatsPerDay;

      if (canQueueNewActive) {
        const remainingNewChatsThisHour = Math.max(0, maxNewChatsPerHr - chatsLastHr);
        const remainingNewChatsToday = Math.max(0, maxNewChatsPerDay - chatsToday);
        const { queued: q } = await processFirstTouch(tenantId, processedLeadIds, guardianConfig, {
          maxToQueue: Math.min(remainingNewChatsThisHour, remainingNewChatsToday),
          selectiveRetryOnly: numberState === "RECOVERY",
        });
        queued += q;
        chatsLastHr += q;
        chatsToday += q;
      }

      // 6. Buscar a mensagem mais prioritária na fila a enviar
      let queueQuery = supabase
        .from("pending_outbound")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("sent_at", null)
        .is("failed_at", null)
        .lte("scheduled_for", new Date().toISOString())
        .lt("attempts", 3);

      if (processedConversationIds.size > 0) {
        queueQuery = queueQuery.not("conversation_id", "in", `(${Array.from(processedConversationIds).map(id => `'${id}'`).join(",")})`);
      }

      const { data: queueItems } = await queueQuery
        .order("priority", { ascending: true })
        .order("scheduled_for", { ascending: true })
        .limit(1);


      if (!queueItems || queueItems.length === 0) {
        await sleep(2000);
        continue;
      }

      const item = queueItems[0];
      processedConversationIds.add(item.conversation_id);

      if (healthDecision.isQuarantined && item.message_type === "OUTBOUND_START") {
        const newScheduled = healthDecision.quarantinedUntil || new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await supabase.from("pending_outbound").update({
          scheduled_for: newScheduled,
          failed_reason: "WA_NEW_NUMBER_QUARANTINE",
        }).eq("id", item.id);

        await recordConnectionEvent({
          tenantId,
          instanceName: evoConfig?.instanceName || "missing",
          eventType: "QUEUE_QUARANTINE_DELAY",
          externalState: healthDecision.externalState,
          reasonCode: "WA_NEW_NUMBER_QUARANTINE",
          localStatusBefore: numberState,
          localStatusAfter: numberState,
          pendingDueCount: await countDuePending(tenantId),
        });

        console.log("  [WhatsApp Guard] OUTBOUND_START adiado por quarentena ate " + newScheduled);
        await sleep(2000);
        continue;
      }

      // Obter detalhes da conversa/telefone do lead
      const { data: conversation } = await supabase
        .from("conversations")
        .select("*, leads!conversations_lead_id_fkey(whatsapp, name, id, status, title_verified, identity_confidence, gender_confidence, entity_type, relevance_score, relevance_status, fit_score, phone_validation_status, phone_validation_confidence)")
        .eq("id", item.conversation_id)
        .single();

      if (!conversation?.leads?.whatsapp) {
        await supabase.from("pending_outbound").update({
          failed_at: new Date().toISOString(),
          failed_reason: "Telefone do lead não encontrado",
          attempts: (item.attempts || 0) + 1
        }).eq("id", item.id);
        failed++;
        continue;
      }

      const phone = (conversation.leads as any).whatsapp;
      const leadName = (conversation.leads as any).name || "Lead";
      const leadId = (conversation.leads as any).id || null;
      const leadRecord = conversation.leads as any;

      const preGenerationGuardianRun = await GuardianRunner.observe({
        supabase,
        config: guardianConfig,
        tenantId,
        leadId,
        conversationId: item.conversation_id,
        pendingOutboundId: item.id,
        candidateId: item.candidate_id || null,
        stage: "PRE_GENERATION",
        functionScope: "send-messages",
        input: {
          pending_outbound_id: item.id,
          source: "pre_send_state_relevance_gate",
          message_type: item.message_type,
          scheduled_for: item.scheduled_for,
          attempts: item.attempts || 0,
        },
        output: {
          content: item.content,
          has_media: Boolean(item.media_url),
          media_type: item.media_type || null,
        },
        facts: {
          ai_handling: conversation.ai_handling === true,
          conversation_status: conversation.status || null,
          lead_status: leadRecord.status || null,
          relevance_score: leadRecord.relevance_score ?? null,
          relevance_status: leadRecord.relevance_status ?? null,
          fit_score: leadRecord.fit_score ?? null,
          phone_validation_status: leadRecord.phone_validation_status ?? null,
          phone_validation_confidence: leadRecord.phone_validation_confidence ?? null,
          entity_type: leadRecord.entity_type ?? null,
          identity_confidence: leadRecord.identity_confidence ?? null,
        },
      });

      if (!preGenerationGuardianRun.allow) {
        const reasonCode = preGenerationGuardianRun.blockingDecision?.reason_code || "GUARDIAN_PHASE5_PRE_SEND_PRE_GENERATION_BLOCKED";
        const finalDecision = preGenerationGuardianRun.blockingDecision?.decision || "BLOCK";
        await supabase.from("pending_outbound").update({
          failed_at: new Date().toISOString(),
          failed_reason: reasonCode,
          validation_status: "BLOCKED",
          validation_reason_code: reasonCode,
          final_guardian_checked_at: new Date().toISOString(),
          final_guardian_decision: finalDecision,
          guardian_config_version_id: item.guardian_config_version_id || preGenerationGuardianRun.configVersionId,
        }).eq("id", item.id);

        await supabase.from("lead_events").insert({
          tenant_id: tenantId,
          lead_id: leadId,
          event_type: "guardian_blocked_pre_send",
          payload: {
            pending_outbound_id: item.id,
            conversation_id: item.conversation_id,
            guardian_key: preGenerationGuardianRun.blockingDecision?.guardian_key || null,
            reason_code: reasonCode,
            final_decision: finalDecision,
            validation_summary: preGenerationGuardianRun.summary,
            reason: "Guardian Engine V3 bloqueou mensagem ja enfileirada antes do envio por relevancia ou estado.",
          },
          created_at: new Date().toISOString(),
        });

        failed++;
        console.warn("  [Guardian V3] Mensagem bloqueada antes do envio por relevancia/estado. Pending: " + item.id + " Reason: " + reasonCode);
        await sleep(500);
        continue;
      }

      const nowForPhase6 = new Date().toISOString();
      const preEnqueueGuardianRun = await GuardianRunner.observe({
        supabase,
        config: guardianConfig,
        tenantId,
        leadId,
        conversationId: item.conversation_id,
        pendingOutboundId: item.id,
        candidateId: item.candidate_id || null,
        stage: "PRE_ENQUEUE",
        functionScope: "send-messages",
        input: {
          pending_outbound_id: item.id,
          source: "pre_send_wake_spread_gate",
          message_type: item.message_type,
          current_scheduled_for: item.scheduled_for,
        },
        output: {
          content: item.content,
          has_media: Boolean(item.media_url),
          media_type: item.media_type || null,
        },
        facts: {
          now_iso: nowForPhase6,
          scheduled_for: item.scheduled_for,
          current_scheduled_for: item.scheduled_for,
          pre_send_current_window_required: true,
          message_type: item.message_type,
          bucket_key: `pending:${tenantId}:${item.id}`,
        },
      });

      const wakeSpreadDelay = extractDelayDecision(preEnqueueGuardianRun);
      if (wakeSpreadDelay) {
        await reschedulePendingByGuardian({
          item,
          delay: wakeSpreadDelay,
          configVersionId: preEnqueueGuardianRun.configVersionId,
        });
        console.log("  [Guardian V3] Mensagem reagendada por G18 para " + wakeSpreadDelay.scheduledFor + ". Pending: " + item.id);
        await sleep(500);
        continue;
      }

      if (!preEnqueueGuardianRun.allow) {
        const reasonCode = preEnqueueGuardianRun.blockingDecision?.reason_code || "GUARDIAN_PHASE6_PRE_ENQUEUE_BLOCKED";
        const finalDecision = preEnqueueGuardianRun.blockingDecision?.decision || "BLOCK";
        await blockPendingByGuardian({
          item,
          reasonCode,
          finalDecision,
          configVersionId: preEnqueueGuardianRun.configVersionId,
        });
        failed++;
        console.warn("  [Guardian V3] Mensagem bloqueada no pre-enfileiramento tardio. Pending: " + item.id + " Reason: " + reasonCode);
        await sleep(500);
        continue;
      }

      const [
        lastOutboundSentAt,
        followupCountWithoutReply,
        activeContacts30m,
      ] = await Promise.all([
        getLastOutboundSentAt(item.conversation_id),
        countFollowupsWithoutReply(item.conversation_id, conversation.last_inbound_at || null),
        countActiveOutboundContactsLast30m(tenantId),
      ]);

      const g21Guardian = getGuardianByKey(guardianConfig, "G21_CONCURRENCY_LOCK");
      const conversationLockTtlSeconds = guardianNumber(g21Guardian, "conversation_lock_ttl_seconds", 120);
      const conversationLock = await acquireConversationLock({
        tenantId,
        conversationId: item.conversation_id,
        ttlSeconds: conversationLockTtlSeconds,
      });

      if (!conversationLock.acquired) {
        const lockGuardianRun = await GuardianRunner.observe({
          supabase,
          config: guardianConfig,
          tenantId,
          leadId,
          conversationId: item.conversation_id,
          pendingOutboundId: item.id,
          candidateId: item.candidate_id || null,
          stage: "PRE_SEND",
          functionScope: "send-messages",
          input: {
            pending_outbound_id: item.id,
            source: "conversation_lock_acquire",
            message_type: item.message_type,
            scheduled_for: item.scheduled_for,
            attempts: item.attempts || 0,
          },
          output: {
            content: item.content,
            has_media: Boolean(item.media_url),
            media_type: item.media_type || null,
          },
          facts: {
            now_iso: new Date().toISOString(),
            number_state: numberState,
            message_type: item.message_type,
            conversation_lock_acquired: false,
            conversation_lock_until: conversationLock.currentLockUntil,
            active_contacts_30m: activeContacts30m,
            followup_count_without_reply: followupCountWithoutReply,
            last_outbound_sent_at: lastOutboundSentAt,
            last_inbound_at: conversation.last_inbound_at || null,
            ai_handling: conversation.ai_handling === true,
            conversation_status: conversation.status || null,
            lead_status: leadRecord.status || null,
          },
        });

        const retryDelay: GuardianDelayDecision = {
          reasonCode: lockGuardianRun.blockingDecision?.reason_code || "G21_CONCURRENCY_LOCK_BLOCKED",
          scheduledFor: new Date(Date.now() + 15 * 1000).toISOString(),
          finalDecision: "DELAY",
        };
        await reschedulePendingByGuardian({
          item,
          delay: retryDelay,
          configVersionId: lockGuardianRun.configVersionId,
        });
        console.log("  [Guardian V3] Conversation lock ocupado. Mensagem reagendada sem envio. Pending: " + item.id);
        await sleep(500);
        continue;
      }

      try {
      const preSendGuardianRun = await GuardianRunner.observe({
        supabase,
        config: guardianConfig,
        tenantId,
        leadId,
        conversationId: item.conversation_id,
        pendingOutboundId: item.id,
        candidateId: item.candidate_id || null,
        stage: "PRE_SEND",
        functionScope: "send-messages",
        input: {
          pending_outbound_id: item.id,
          message_type: item.message_type,
          scheduled_for: item.scheduled_for,
          attempts: item.attempts || 0,
        },
        output: {
          content: item.content,
          has_media: Boolean(item.media_url),
          media_type: item.media_type || null,
        },
        facts: {
          now_iso: new Date().toISOString(),
          number_state: numberState,
          message_type: item.message_type,
          sent_last_minute: msgsLastMin,
          sent_last_hour: msgsLastHr,
          new_chats_today: chatsToday,
          active_contacts_30m: activeContacts30m,
          followup_count_without_reply: followupCountWithoutReply,
          last_outbound_sent_at: lastOutboundSentAt,
          last_inbound_at: conversation.last_inbound_at || null,
          conversation_lock_acquired: true,
          conversation_lock_until: conversationLock.requestedLockUntil,
          ai_handling: conversation.ai_handling === true,
          conversation_status: conversation.status || null,
          lead_status: leadRecord.status || null,
          relevance_score: leadRecord.relevance_score ?? null,
          relevance_status: leadRecord.relevance_status ?? null,
          fit_score: leadRecord.fit_score ?? null,
          phone_validation_status: leadRecord.phone_validation_status ?? null,
          phone_validation_confidence: leadRecord.phone_validation_confidence ?? null,
          entity_type: leadRecord.entity_type ?? null,
        },
      });

      try {
        const finalDecision = preSendGuardianRun.summary.warn > 0 ? "WARN" : "PASS";
        const { error: finalGuardErr } = await supabase.from("pending_outbound").update({
          guardian_config_version_id: item.guardian_config_version_id || preSendGuardianRun.configVersionId,
          validation_status: "APPROVED",
          validation_reason_code: preSendGuardianRun.summary.warn > 0 ? "GUARDIAN_PHASE6_PRE_SEND_WARN_OBSERVED" : "GUARDIAN_PHASE6_PRE_SEND_PASS",
          final_guardian_checked_at: new Date().toISOString(),
          final_guardian_decision: finalDecision,
        }).eq("id", item.id);

        if (finalGuardErr) {
          console.warn("  [Guardian V3] Final pre-send metadata update failed:", redactText(finalGuardErr.message));
        }
      } catch (err) {
        console.warn("  [Guardian V3] Final pre-send metadata update exception:", redactText(err));
      }

      const preSendDelay = extractDelayDecision(preSendGuardianRun);
      if (preSendDelay) {
        await reschedulePendingByGuardian({
          item,
          delay: preSendDelay,
          configVersionId: preSendGuardianRun.configVersionId,
        });
        console.log("  [Guardian V3] Mensagem reagendada por cadencia. Pending: " + item.id + " Reason: " + preSendDelay.reasonCode);
        await sleep(500);
        continue;
      }

      if (!preSendGuardianRun.allow) {
        const reasonCode = preSendGuardianRun.blockingDecision?.reason_code || "GUARDIAN_PHASE6_PRE_SEND_BLOCKED";
        const finalDecision = preSendGuardianRun.blockingDecision?.decision || "BLOCK";
        await blockPendingByGuardian({
          item,
          reasonCode,
          finalDecision,
          configVersionId: preSendGuardianRun.configVersionId,
        });
        failed++;
        console.warn("  [Guardian V3] Mensagem bloqueada antes do envio. Pending: " + item.id + " Reason: " + reasonCode);
        await sleep(500);
        continue;
      }

      const finalContentCandidatePayload = buildCandidatePayload({
        messages: [item.content],
        intent: "OTHER",
        leadName,
      });
      const finalContentGuardianRun = await GuardianRunner.observe({
        supabase,
        config: guardianConfig,
        tenantId,
        leadId,
        conversationId: item.conversation_id,
        pendingOutboundId: item.id,
        candidateId: item.candidate_id || null,
        stage: "POST_GENERATION",
        functionScope: "send-messages",
        input: {
          pending_outbound_id: item.id,
          source: "pre_send_final_content_gate",
          message_type: item.message_type,
        },
        output: finalContentCandidatePayload,
        facts: {
          lead_name: leadRecord.name || null,
          title_verified: leadRecord.title_verified ?? null,
          identity_confidence: leadRecord.identity_confidence ?? null,
          gender_confidence: leadRecord.gender_confidence ?? null,
          entity_type: leadRecord.entity_type ?? null,
          lead_status: leadRecord.status || null,
          relevance_score: leadRecord.relevance_score ?? null,
          relevance_status: leadRecord.relevance_status ?? null,
          fit_score: leadRecord.fit_score ?? null,
          phone_validation_status: leadRecord.phone_validation_status ?? null,
          phone_validation_confidence: leadRecord.phone_validation_confidence ?? null,
        },
      });

      if (!finalContentGuardianRun.allow) {
        const reasonCode = finalContentGuardianRun.blockingDecision?.reason_code || "GUARDIAN_PHASE5_PRE_SEND_BLOCKED";
        const finalDecision = finalContentGuardianRun.blockingDecision?.decision || "HARD_BLOCK";
        await supabase.from("pending_outbound").update({
          failed_at: new Date().toISOString(),
          failed_reason: reasonCode,
          validation_status: "BLOCKED",
          validation_reason_code: reasonCode,
          final_guardian_checked_at: new Date().toISOString(),
          final_guardian_decision: finalDecision,
          guardian_config_version_id: item.guardian_config_version_id || finalContentGuardianRun.configVersionId,
        }).eq("id", item.id);

        failed++;
        console.warn("  [Guardian V3] Mensagem bloqueada no pre-envio. Pending: " + item.id + " Reason: " + reasonCode);
        await sleep(500);
        continue;
      }

      // 7. Validar limites antes do envio
      const limitsExceeded =
        msgsLastMin >= maxMsgsPerMin ||
        msgsLastHr >= maxMsgsPerHr ||
        (item.message_type === "OUTBOUND_START" && chatsToday >= maxNewChatsPerDay);

      if (limitsExceeded) {
        const newScheduled = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        await supabase.from("pending_outbound").update({
          scheduled_for: newScheduled,
          failed_reason: "Limites de envio excedidos. Adiado pelo Guardião."
        }).eq("id", item.id);

        console.log("  ⚠️ Limites excedidos para tenant " + tenantId + ". Mensagem reagendada para " + newScheduled);
        await sleep(2000);
        continue;
      }

      // 8. Aplicar delay global
      const minRange = globalDelayRange.min;
      const maxRange = globalDelayRange.max;

      let calculatedDelay = Math.floor(Math.random() * (maxRange - minRange + 1)) + minRange;
      const roll = Math.random() * 100;
      if (roll > 80 && roll <= 95) {
        calculatedDelay = Math.floor(calculatedDelay * 1.5);
      } else if (roll > 95) {
        calculatedDelay = Math.floor(calculatedDelay * 2.5);
      }

      calculatedDelay = Math.max(globalMinDelay, calculatedDelay);

      if (guardianStatus.last_global_send_at) {
        const lastSend = new Date(guardianStatus.last_global_send_at).getTime();
        const diffSec = (Date.now() - lastSend) / 1000;

        if (diffSec < calculatedDelay) {
          const sleepSec = Math.ceil(calculatedDelay - diffSec);
          console.log("  ⏱️ Guardião: Aguardando " + sleepSec + "s de delay global...");
          await sleep(sleepSec * 1000);
        }
      }

      // 9. Enviar via Evolution API
      if (!evoConfig) {
        await supabase.from("pending_outbound").update({
          failed_at: new Date().toISOString(),
          failed_reason: "Evolution API Key não configurada",
          attempts: (item.attempts || 0) + 1
        }).eq("id", item.id);
        failed++;
        continue;
      }

      const sendResult = await sendWhatsApp(evoConfig, phone, item.content, item.media_url, item.media_type);
      const sendTime = new Date().toISOString();

      if (sendResult.ok) {
        await supabase.from("pending_outbound").update({
          sent_at: sendTime,
          attempts: (item.attempts || 0) + 1
        }).eq("id", item.id);

        const messageId = uuid();

        let scriptVariationId: string | null = null;
        try {
          const { data: firstOutbound } = await supabase
            .from("messages")
            .select("script_variation_id")
            .eq("conversation_id", item.conversation_id)
            .not("script_variation_id", "is", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (firstOutbound?.script_variation_id) {
            scriptVariationId = firstOutbound.script_variation_id;
          }
        } catch (_) {}

        await supabase.from("messages").insert({
          id: messageId,
          tenant_id: tenantId,
          conversation_id: item.conversation_id,
          direction: "OUTBOUND",
          sender: "AI",
          content: item.content,
          media_url: item.media_url,
          media_type: item.media_type,
          delivery_status: "SENT",
          whatsapp_message_id: sendResult.whatsappMsgId || null,
          script_id: conversation.script_id || null,
          script_node_id: conversation.current_node_id || null,
          script_variation_id: scriptVariationId || null,
          created_at: sendTime,
        });

        await supabase.from("conversations").update({
          last_message: item.content.substring(0, 200),
          last_message_at: sendTime,
          last_outbound_at: sendTime,
          message_count: (conversation.message_count || 0) + 1,
        }).eq("id", item.conversation_id);

        if (item.message_type === "OUTBOUND_START" && conversation.leads?.status === "ENRICHED") {
          await supabase.from("leads").update({
            status: "CONTACTED",
            contacted_at: sendTime,
            updated_at: sendTime,
          }).eq("id", conversation.leads.id);

          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: conversation.leads.id,
            event_type: "message_sent",
            payload: {
              conversation_id: item.conversation_id,
              message_id: messageId,
              delivery_status: "SENT",
              reason: "Primeira mensagem ativa enviada com sucesso pelo Guardião",
            },
            created_at: sendTime,
          });

          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: conversation.leads.id,
            event_type: "status_changed",
            payload: { from: "ENRICHED", to: "CONTACTED", reason: "Lead contatado pelo Guardião" },
            created_at: sendTime,
          });
        }

        await supabase.rpc("increment_tenant_usage", {
          p_tenant_id: tenantId,
          p_llm_tokens_input: 0,
          p_llm_tokens_output: 0,
          p_whatsapp_msgs: 1,
          p_maps_calls: 0
        });

        await supabase.from("whatsapp_guardian_status").update({
          last_global_send_at: sendTime,
          updated_at: sendTime,
        }).eq("tenant_id", tenantId);

        sent++;
        console.log("  ✅ [Guard] Mensagem enviada para " + leadName + " (Tipo: " + item.message_type + ")");

        // Registrar Telemetria
        try {
          await supabase.from("whatsapp_guardian_telemetry").insert({
            tenant_id: tenantId,
            message_id: messageId,
            conversation_id: item.conversation_id,
            message_type: item.message_type,
            queued_at: item.created_at,
            scheduled_for: item.scheduled_for,
            sent_at: sendTime,
            delay_applied: calculatedDelay,
            delay_reason: "Delay global de " + calculatedDelay + "s respeitado orgonicamente",
            number_state: numberState,
            queue_position: 1,
            is_reactive: ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"].includes(item.message_type || ""),
            is_followup: item.message_type === "COMMERCIAL_FOLLOWUP",
            sent_last_minute: msgsLastMin + 1,
            sent_last_hour: msgsLastHr + 1,
            new_chats_today: chatsToday + (item.message_type === "OUTBOUND_START" ? 1 : 0),
          });
        } catch (telErr) {
          console.warn("  ⚠️ Falha ao registrar telemetria:", telErr);
        }

      } else {
        const failure = classifySendFailure(sendResult.error || "");

        if (failure.critical) {
          console.error("  [WhatsApp Guard] Falha critica no envio para tenant " + tenantId + ". Motivo: " + failure.reasonCode);

          // 1. Atualizar o status do Guardião do Tenant para SUSPENDED e resetar locked_at
          const retryDelayMinutes = getNumberEnv("WA_CRITICAL_RETRY_DELAY_MINUTES", 60);
          const retryAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString();
          const circuitMinutes = failure.status === "SUSPENDED"
            ? getNumberEnv("WA_CRITICAL_CIRCUIT_OPEN_MINUTES", 60)
            : getNumberEnv("WA_TRANSIENT_CIRCUIT_OPEN_MINUTES", 15);

          await updateGuardianConnectionState(tenantId, failure.status, healthDecision.externalState, failure.reasonCode, {
            locked_at: null,
            circuit_open_until: new Date(Date.now() + circuitMinutes * 60 * 1000).toISOString(),
          });

          const connectionEventId = await recordConnectionEvent({
            tenantId,
            instanceName: evoConfig.instanceName,
            eventType: "SEND_FAILURE_GUARD",
            externalState: healthDecision.externalState,
            reasonCode: failure.reasonCode,
            rawError: redactPayload(sendResult.error),
            localStatusBefore: numberState,
            localStatusAfter: failure.status,
            pendingDueCount: await countDuePending(tenantId),
          });

          const operationalAlertId = await createCriticalConnectionAlert(
            tenantId,
            failure.reasonCode,
            "Envio interrompido por falha critica da conexao WhatsApp/Evolution.",
            {
              reason_code: failure.reasonCode,
              conversation_id: item.conversation_id,
              pending_outbound_id: item.id,
              error_redacted: redactText(sendResult.error),
            },
          );
          try {
            await dispatchAdminDisconnectAlert({
              supabase,
              tenantId,
              reasonCode: failure.reasonCode,
              externalState: healthDecision.externalState,
              connectionEventId,
              operationalAlertId,
              pendingDueCount: await countDuePending(tenantId),
              source: "send-messages:send-failure",
            });
          } catch (err) {
            console.warn("Falha ao disparar alerta admin de desconexao:", err);
          }

          // Registrar falha na telemetria (marcar como duplicado = false, mas com erro)
          try {
            await supabase.from("whatsapp_guardian_telemetry").insert({
              tenant_id: tenantId,
              conversation_id: item.conversation_id,
              message_type: item.message_type,
              queued_at: item.created_at,
              scheduled_for: item.scheduled_for,
              error: failure.reasonCode,
              number_state: failure.status,
              is_reactive: ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"].includes(item.message_type || ""),
              is_followup: item.message_type === "COMMERCIAL_FOLLOWUP",
            });
          } catch (_) {}

          // Adiar item atual durante o circuito aberto sem consumir tentativa por falha de conexao.
          await supabase.from("pending_outbound").update({
            scheduled_for: retryAt,
            failed_reason: failure.reasonCode,
          }).eq("id", item.id);
          failed++;

          // 4. Abortar fila do tenant atual
          break;
        }

        // Fluxo de erro normal (que não é suspensão)
        const attempts = (item.attempts || 0) + 1;
        const updateData: any = {
          attempts,
          failed_reason: sendResult.error
        };
        if (attempts >= 3) {
          updateData.failed_at = sendTime;
        }
        await supabase.from("pending_outbound").update(updateData).eq("id", item.id);
        failed++;

        try {
          await supabase.from("whatsapp_guardian_telemetry").insert({
            tenant_id: tenantId,
            conversation_id: item.conversation_id,
            message_type: item.message_type,
            queued_at: item.created_at,
            scheduled_for: item.scheduled_for,
            error: sendResult.error,
            number_state: numberState,
            is_reactive: ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"].includes(item.message_type || ""),
            is_followup: item.message_type === "COMMERCIAL_FOLLOWUP",
          });
        } catch (_) {}

        console.log("  ❌ Falha no envio para " + leadName + " (Tentativa " + attempts + "): " + sendResult.error);
      }

      } finally {
        await releaseConversationLock(tenantId, item.conversation_id, conversationLock.requestedLockUntil);
      }

      await sleep(1500);
    }
  } finally {
    try {
      await supabase
        .from("whatsapp_guardian_status")
        .update({ locked_at: null })
        .eq("tenant_id", tenantId)
        .eq("locked_at", nowTime);
      console.log("  🔓 [Lock Lógico] Lock liberado para tenant " + tenantId + ".");
    } catch (errUnlock) {
      console.error("  ⚠️ Erro ao liberar lock lógico:", errUnlock);
    }
  }

  return { sent, queued, failed };
}

serve(async (req: Request) => {
  try {
    console.log("📤 ProspIX WhatsApp Guardian Worker");
    console.log("   Time: " + new Date().toISOString());

    const runEndTime = Date.now() + 50 * 1000; // Loop dura até 50 segundos

    // Ler payload para saber se processamos um tenant específico ou todos os tenants ativos
    let targetTenantId: string | null = null;
    try {
      const body = await req.json();
      if (body?.tenant_id) targetTenantId = body.tenant_id;
    } catch (_) {}

    let tenantIds: string[] = [];

    if (targetTenantId) {
      tenantIds = [targetTenantId];
    } else {
      // Obter todos os tenants ativos que possuem campanhas ativas
      const { data: activeCampaigns } = await supabase
        .from("campaigns")
        .select("tenant_id")
        .eq("status", "ACTIVE");

      if (activeCampaigns?.length) {
        tenantIds = Array.from(new Set(activeCampaigns.map((c: any) => String(c.tenant_id)).filter(Boolean)));
      }
    }

    if (tenantIds.length === 0) {
      enqueueAdminMonitoringDue("send-messages:no-active-tenants");
      return new Response(JSON.stringify({ ok: true, message: "No active tenants to process", admin_monitoring: "queued" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("   Processando tenants: " + tenantIds.join(", "));

    const results = [];
    for (const tenantId of tenantIds) {
      const result = await runGuardianWorkerForTenant(tenantId, runEndTime);
      results.push({ tenant_id: tenantId, ...result });
    }

    const summary = {
      ok: true,
      timestamp: new Date().toISOString(),
      results,
      admin_monitoring: "queued"
    };

    enqueueAdminMonitoringDue("send-messages:cron");

    console.log("\n🏁 Worker finalizado: " + JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Fatal:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
