import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { v4 as uuid } from "https://esm.sh/uuid@9.0.1";
import { GuardianRunner } from "../_shared/guardians/runner.ts";
import type { EffectiveGuardianConfig, GuardianRunResult } from "../_shared/guardians/types.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const supabase = createClient(supabaseUrl, supabaseKey);

type FollowupGuardianDecision = {
  status: "APPROVED" | "DELAYED";
  reasonCode: string;
  finalDecision: "PASS" | "WARN" | "DELAY";
  scheduledFor: string;
  configVersionId: string | null;
};

const GUARDIAN_CONFIG_CACHE_TTL_MS = 60_000;
const guardianConfigCache = new Map<string, { loadedAt: number; config: EffectiveGuardianConfig | null }>();

async function loadGuardianConfig(tenantId: string): Promise<EffectiveGuardianConfig | null> {
  const cached = guardianConfigCache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < GUARDIAN_CONFIG_CACHE_TTL_MS) {
    return cached.config;
  }

  const config = await GuardianRunner.loadConfig({ supabase, tenantId });
  guardianConfigCache.set(tenantId, { loadedAt: Date.now(), config });
  return config;
}

function validFutureIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function extractDelayDecision(run: GuardianRunResult): string | null {
  const decision = run.blockingDecision;
  if (!decision) return null;
  if (decision.decision !== "DELAY" && !String(decision.reason_code || "").includes("_DELAY")) return null;
  return validFutureIso(decision.evidence?.next_scheduled_for)
    ? String(decision.evidence.next_scheduled_for)
    : new Date(Date.now() + 10 * 60 * 1000).toISOString();
}

async function countFollowupsWithoutReply(conversationId: string, lastInboundAt: string | null): Promise<number> {
  let query = supabase
    .from("pending_outbound")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("message_type", "COMMERCIAL_FOLLOWUP")
    .is("failed_at", null);

  if (lastInboundAt) query = query.gt("created_at", lastInboundAt);
  const { count } = await query;
  return count || 0;
}

async function countOpenFollowups(conversationId: string): Promise<number> {
  const { count } = await supabase
    .from("pending_outbound")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("message_type", "COMMERCIAL_FOLLOWUP")
    .is("sent_at", null)
    .is("failed_at", null);

  return count || 0;
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

async function buildFollowupGuardianDecision(params: {
  tenantId: string;
  conversation: any;
  leadId: string | null;
  content: string;
  baseScheduledFor: string;
  followupCountWithoutReply: number;
  lastOutboundSentAt: string | null;
}): Promise<FollowupGuardianDecision | null> {
  const config = await loadGuardianConfig(params.tenantId);
  let scheduledFor = params.baseScheduledFor;
  let status: FollowupGuardianDecision["status"] = "APPROVED";
  let reasonCode = "GUARDIAN_PHASE6_FOLLOWUP_PASS";
  let finalDecision: FollowupGuardianDecision["finalDecision"] = "PASS";
  let configVersionId = config?.active_version?.id || null;
  const activeContacts30m = await countActiveOutboundContactsLast30m(params.tenantId);

  const cadenceRun = await GuardianRunner.observe({
    supabase,
    config,
    tenantId: params.tenantId,
    leadId: params.leadId,
    conversationId: params.conversation.id,
    stage: "PRE_SEND",
    functionScope: "send-messages",
    input: {
      source: "process-followups",
      message_type: "COMMERCIAL_FOLLOWUP",
      scheduled_for: scheduledFor,
    },
    output: { content: params.content },
    facts: {
      now_iso: new Date().toISOString(),
      message_type: "COMMERCIAL_FOLLOWUP",
      followup_count_without_reply: params.followupCountWithoutReply,
      last_outbound_sent_at: params.lastOutboundSentAt,
      last_inbound_at: params.conversation.last_inbound_at || null,
      active_contacts_30m: activeContacts30m,
      ai_handling: params.conversation.ai_handling === true,
      conversation_status: params.conversation.status || null,
      lead_name: params.conversation.leads?.name || null,
      lead_whatsapp: params.conversation.leads?.whatsapp || null,
    },
  });
  configVersionId = cadenceRun.configVersionId || configVersionId;

  const cadenceDelay = extractDelayDecision(cadenceRun);
  if (cadenceDelay) {
    scheduledFor = cadenceDelay;
    status = "DELAYED";
    reasonCode = cadenceRun.blockingDecision?.reason_code || "G20_CONTACT_CADENCE_DELAYED";
    finalDecision = "DELAY";
  } else if (!cadenceRun.allow) {
    const reason = cadenceRun.blockingDecision?.reason_code || "G20_CONTACT_CADENCE_BLOCKED";
    await supabase.from("conversations").update({
      ai_handling: false,
      status: "ESCALATED",
      escalated_reason: "Follow-up bloqueado por limite de cadencia do Guardian Engine V3",
    }).eq("id", params.conversation.id);

    await supabase.from("lead_events").insert({
      tenant_id: params.tenantId,
      lead_id: params.leadId,
      event_type: "guardian_blocked_followup",
      payload: {
        conversation_id: params.conversation.id,
        guardian_key: cadenceRun.blockingDecision?.guardian_key || null,
        reason_code: reason,
        validation_summary: cadenceRun.summary,
      },
      created_at: new Date().toISOString(),
    });
    return null;
  }

  const wakeRun = await GuardianRunner.observe({
    supabase,
    config,
    tenantId: params.tenantId,
    leadId: params.leadId,
    conversationId: params.conversation.id,
    stage: "PRE_ENQUEUE",
    functionScope: "send-messages",
    input: {
      source: "process-followups",
      message_type: "COMMERCIAL_FOLLOWUP",
      scheduled_for: scheduledFor,
    },
    output: { content: params.content },
    facts: {
      now_iso: new Date().toISOString(),
      scheduled_for: scheduledFor,
      message_type: "COMMERCIAL_FOLLOWUP",
      bucket_key: `followup:${params.tenantId}:${params.conversation.id}:${params.followupCountWithoutReply + 1}`,
    },
  });
  configVersionId = wakeRun.configVersionId || configVersionId;

  const wakeDelay = extractDelayDecision(wakeRun);
  if (wakeDelay) {
    scheduledFor = wakeDelay;
    status = "DELAYED";
    reasonCode = wakeRun.blockingDecision?.reason_code || "G18_WAKE_SPREAD_DELAYED";
    finalDecision = "DELAY";
  } else if (!wakeRun.allow) {
    const reason = wakeRun.blockingDecision?.reason_code || "GUARDIAN_PHASE6_FOLLOWUP_PRE_ENQUEUE_BLOCKED";
    await supabase.from("lead_events").insert({
      tenant_id: params.tenantId,
      lead_id: params.leadId,
      event_type: "guardian_blocked_followup",
      payload: {
        conversation_id: params.conversation.id,
        guardian_key: wakeRun.blockingDecision?.guardian_key || null,
        reason_code: reason,
        validation_summary: wakeRun.summary,
      },
      created_at: new Date().toISOString(),
    });
    return null;
  }

  return { status, reasonCode, finalDecision, scheduledFor, configVersionId };
}

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${Deno.env.get("CRON_SECRET")}` && !req.headers.get("x-local-dev")) {
      return new Response('Unauthorized', { status: 401 });
    }

    const now = new Date();
    // 24 hours ago
    const cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    console.log(`\n🔍 Searching for stalled conversations (last outbound before ${cutoffDate})...`);

    // We want active conversations where the AI sent the last message and lead hasn't replied for 24h.
    // Since we don't have a direct "last_sender" column on conversation, we can query conversations 
    // where last_message_at <= cutoffDate, and then check the last message.
    const { data: conversations, error: convError } = await supabase
      .from("conversations")
      .select("*, leads!conversations_lead_id_fkey(name, whatsapp)")
      .eq("status", "ACTIVE")
      .eq("ai_handling", true)
      .lte("last_message_at", cutoffDate)
      .limit(50);

    if (convError) throw convError;

    if (!conversations || conversations.length === 0) {
      console.log("✅ No stalled conversations found.");
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const conv of conversations) {
      // Fetch the last message to ensure it was from the AI
      const { data: lastMsg } = await supabase
        .from("messages")
        .select("direction, sender, content")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!lastMsg || lastMsg.direction !== "OUTBOUND" || lastMsg.sender !== "AI") {
        continue;
      }

      const openFollowups = await countOpenFollowups(conv.id);
      if (openFollowups > 0) {
        console.log(`Skipping ${conv.id}: follow-up already queued.`);
        continue;
      }

      const leadName = conv.leads?.name?.split(" ")[0] || "tudo bem";
      const leadId = conv.lead_id || null;
      const followupCountWithoutReply = await countFollowupsWithoutReply(conv.id, conv.last_inbound_at || null);
      const followUpMsg = `Oi ${leadName}, conseguiu dar uma olhadinha na minha última mensagem? Só pra eu saber se podemos prosseguir ou se deixo para falar com você em outro momento!`;

      const guardianDecision = await buildFollowupGuardianDecision({
        tenantId: conv.tenant_id,
        conversation: conv,
        leadId,
        content: followUpMsg,
        baseScheduledFor: now.toISOString(),
        followupCountWithoutReply,
        lastOutboundSentAt: conv.last_outbound_at || null,
      });

      if (!guardianDecision) {
        console.log(`Follow-up blocked by Guardian Engine V3 for conversation ${conv.id}.`);
        continue;
      }

      console.log(`Queueing Guardian-approved follow-up for ${conv.id} (Lead: ${leadName})`);
      const { error: insertError } = await supabase.from("pending_outbound").insert({
        id: uuid(),
        tenant_id: conv.tenant_id,
        conversation_id: conv.id,
        content: followUpMsg,
        idempotency_key: "followup_" + conv.id + "_" + (followupCountWithoutReply + 1),
        scheduled_for: guardianDecision.scheduledFor,
        attempts: 0,
        message_type: "COMMERCIAL_FOLLOWUP",
        priority: 5,
        guardian_config_version_id: guardianDecision.configVersionId,
        validation_status: guardianDecision.status,
        validation_reason_code: guardianDecision.reasonCode,
        final_guardian_checked_at: new Date().toISOString(),
        final_guardian_decision: guardianDecision.finalDecision,
      });
      if (insertError) {
        console.warn(`Failed to queue follow-up for ${conv.id}: ${insertError.message}`);
        continue;
      }
      processed++;
    }

    console.log(`\n🎉 Processed ${processed} follow-ups.`);

    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Error processing follow-ups:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
