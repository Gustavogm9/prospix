import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCandidatePayload } from "../_shared/guardians/candidate.ts";
import { GuardianRunner } from "../_shared/guardians/runner.ts";
import type { EffectiveGuardianConfig, GuardianRunResult } from "../_shared/guardians/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MESSAGE_TYPE = "REFERRAL_REQUEST";
const SOURCE = "cron-referrals";

type ReferralGuardianDecision = {
  status: "APPROVED" | "DELAYED";
  reasonCode: string;
  finalDecision: "PASS" | "WARN" | "DELAY";
  scheduledFor: string;
  configVersionId: string;
};

const GUARDIAN_CONFIG_CACHE_TTL_MS = 60_000;
const guardianConfigCache = new Map<string, { loadedAt: number; config: EffectiveGuardianConfig | null }>();

function buildMessage(leadName: string | null) {
  const firstName = leadName ? leadName.split(" ")[0] : "tudo bem";
  return `Oi ${firstName}, tudo bem? Queria agradecer pela confiança! A propósito, você tem o contato de 2 ou 3 colegas ou sócios no mesmo perfil que o seu, que também poderiam se beneficiar dessa proteção? Pode me passar os nomes e números por aqui mesmo.`;
}

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

async function countReferralRequestsWithoutReply(conversationId: string, lastInboundAt: string | null): Promise<number> {
  let query = supabase
    .from("pending_outbound")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("message_type", MESSAGE_TYPE)
    .is("failed_at", null);

  if (lastInboundAt) query = query.gt("created_at", lastInboundAt);
  const { count } = await query;
  return count || 0;
}

async function logGuardianBlock(params: {
  tenantId: string;
  leadId: string;
  conversationId: string;
  reasonCode: string;
  run: GuardianRunResult | null;
  dryRun: boolean;
}) {
  if (params.dryRun) return;

  await supabase.from("lead_events").insert({
    tenant_id: params.tenantId,
    lead_id: params.leadId,
    event_type: "guardian_blocked_referral_request",
    payload: {
      source: SOURCE,
      conversation_id: params.conversationId,
      guardian_key: params.run?.blockingDecision?.guardian_key || null,
      reason_code: params.reasonCode,
      validation_summary: params.run?.summary || null,
    },
    created_at: new Date().toISOString(),
  });
}

async function buildReferralGuardianDecision(params: {
  tenantId: string;
  lead: any;
  conversation: any;
  content: string;
  baseScheduledFor: string;
  dryRun: boolean;
}): Promise<ReferralGuardianDecision | null> {
  const config = await loadGuardianConfig(params.tenantId);
  if (!config?.active_version?.id) {
    await logGuardianBlock({
      tenantId: params.tenantId,
      leadId: params.lead.id,
      conversationId: params.conversation.id,
      reasonCode: "GUARDIAN_CONFIG_UNAVAILABLE_REFERRAL_REQUEST",
      run: null,
      dryRun: params.dryRun,
    });
    return null;
  }

  let scheduledFor = params.baseScheduledFor;
  let status: ReferralGuardianDecision["status"] = "APPROVED";
  let reasonCode = "GUARDIAN_REFERRAL_REQUEST_PASS";
  let finalDecision: ReferralGuardianDecision["finalDecision"] = "PASS";
  let configVersionId = config.active_version.id;
  const activeContacts30m = await countActiveOutboundContactsLast30m(params.tenantId);
  const referralCountWithoutReply = await countReferralRequestsWithoutReply(
    params.conversation.id,
    params.conversation.last_inbound_at || null,
  );

  const candidatePayload = buildCandidatePayload({
    messages: [params.content],
    intent: "FOLLOW_UP",
    leadName: params.lead.name,
  });

  const contentRun = await GuardianRunner.observe({
    supabase,
    config,
    tenantId: params.tenantId,
    leadId: params.lead.id,
    conversationId: params.conversation.id,
    stage: "POST_GENERATION",
    functionScope: "send-messages",
    input: {
      source: SOURCE,
      message_type: MESSAGE_TYPE,
      lead_closed_at: params.lead.closed_at,
    },
    output: {
      content: params.content,
      candidate: candidatePayload,
    },
    facts: {
      now_iso: new Date().toISOString(),
      message_type: MESSAGE_TYPE,
      lead_name: params.lead.name || null,
      lead_id: params.lead.id,
      conversation_status: params.conversation.status || null,
      ai_handling: params.conversation.ai_handling === true,
      relevance_score: params.lead.relevance_score ?? null,
      relevance_status: params.lead.relevance_status ?? null,
      phone_validation_status: params.lead.phone_validation_status ?? null,
      phone_validation_confidence: params.lead.phone_validation_confidence ?? null,
      entity_type: params.lead.entity_type ?? null,
      title_verified: params.lead.title_verified ?? null,
      identity_confidence: params.lead.identity_confidence ?? null,
      gender_confidence: params.lead.gender_confidence ?? null,
    },
  });
  configVersionId = contentRun.configVersionId || configVersionId;

  if (!contentRun.allow) {
    await logGuardianBlock({
      tenantId: params.tenantId,
      leadId: params.lead.id,
      conversationId: params.conversation.id,
      reasonCode: contentRun.blockingDecision?.reason_code || "GUARDIAN_REFERRAL_CONTENT_BLOCKED",
      run: contentRun,
      dryRun: params.dryRun,
    });
    return null;
  }

  const cadenceRun = await GuardianRunner.observe({
    supabase,
    config,
    tenantId: params.tenantId,
    leadId: params.lead.id,
    conversationId: params.conversation.id,
    stage: "PRE_SEND",
    functionScope: "send-messages",
    input: {
      source: SOURCE,
      message_type: MESSAGE_TYPE,
      scheduled_for: scheduledFor,
    },
    output: { content: params.content },
    facts: {
      now_iso: new Date().toISOString(),
      message_type: MESSAGE_TYPE,
      followup_count_without_reply: referralCountWithoutReply,
      last_outbound_sent_at: params.conversation.last_outbound_at || null,
      last_inbound_at: params.conversation.last_inbound_at || null,
      active_contacts_30m: activeContacts30m,
      ai_handling: params.conversation.ai_handling === true,
      conversation_status: params.conversation.status || null,
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
    await logGuardianBlock({
      tenantId: params.tenantId,
      leadId: params.lead.id,
      conversationId: params.conversation.id,
      reasonCode: cadenceRun.blockingDecision?.reason_code || "GUARDIAN_REFERRAL_CADENCE_BLOCKED",
      run: cadenceRun,
      dryRun: params.dryRun,
    });
    return null;
  }

  const wakeRun = await GuardianRunner.observe({
    supabase,
    config,
    tenantId: params.tenantId,
    leadId: params.lead.id,
    conversationId: params.conversation.id,
    stage: "PRE_ENQUEUE",
    functionScope: "send-messages",
    input: {
      source: SOURCE,
      message_type: MESSAGE_TYPE,
      scheduled_for: scheduledFor,
    },
    output: { content: params.content },
    facts: {
      now_iso: new Date().toISOString(),
      scheduled_for: scheduledFor,
      message_type: MESSAGE_TYPE,
      bucket_key: `referral:${params.tenantId}:${params.conversation.id}:${params.lead.id}`,
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
    await logGuardianBlock({
      tenantId: params.tenantId,
      leadId: params.lead.id,
      conversationId: params.conversation.id,
      reasonCode: wakeRun.blockingDecision?.reason_code || "GUARDIAN_REFERRAL_PRE_ENQUEUE_BLOCKED",
      run: wakeRun,
      dryRun: params.dryRun,
    });
    return null;
  }

  return { status, reasonCode, finalDecision, scheduledFor, configVersionId };
}

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";
    console.log(`Cron Referrals Loop triggered at ${new Date().toISOString()} dry_run=${dryRun}`);

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from("leads")
      .select(`
        id,
        tenant_id,
        name,
        whatsapp,
        metadata,
        closed_at,
        relevance_score,
        relevance_status,
        phone_validation_status,
        phone_validation_confidence,
        entity_type,
        title_verified,
        identity_confidence,
        gender_confidence
      `)
      .not("closed_at", "is", null)
      .lt("closed_at", oneDayAgo)
      .gt("closed_at", twoDaysAgo);

    if (error) throw error;

    if (!leads || leads.length === 0) {
      return new Response(JSON.stringify({ ok: true, dryRun, processed: 0, blocked: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let blocked = 0;

    for (const lead of leads) {
      const meta = lead.metadata || {};
      if (meta.referral_loop_triggered) continue;

      const { data: conversations, error: convError } = await supabase
        .from("conversations")
        .select("id, lead_id, status, ai_handling, last_inbound_at, last_outbound_at")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (convError) throw convError;

      const conversation = conversations && conversations.length > 0 ? conversations[0] : null;
      if (!conversation) {
        blocked++;
        if (!dryRun) {
          await supabase.from("lead_events").insert({
            tenant_id: lead.tenant_id,
            lead_id: lead.id,
            event_type: "guardian_blocked_referral_request",
            payload: {
              source: SOURCE,
              reason_code: "REFERRAL_REQUEST_CONVERSATION_MISSING",
            },
            created_at: new Date().toISOString(),
          });
        }
        continue;
      }

      const message = buildMessage(lead.name);
      const decision = await buildReferralGuardianDecision({
        tenantId: lead.tenant_id,
        lead,
        conversation,
        content: message,
        baseScheduledFor: new Date().toISOString(),
        dryRun,
      });

      if (!decision) {
        blocked++;
        continue;
      }

      if (!dryRun) {
        const { error: queueError } = await supabase.from("pending_outbound").insert({
          id: crypto.randomUUID(),
          tenant_id: lead.tenant_id,
          conversation_id: conversation.id,
          content: message,
          idempotency_key: `ref_loop_${lead.id}`,
          scheduled_for: decision.scheduledFor,
          attempts: 0,
          message_type: MESSAGE_TYPE,
          priority: 5,
          guardian_config_version_id: decision.configVersionId,
          validation_status: decision.status,
          validation_reason_code: decision.reasonCode,
          final_guardian_checked_at: new Date().toISOString(),
          final_guardian_decision: decision.finalDecision,
        });

        if (queueError) throw queueError;

        meta.referral_loop_triggered = true;
        meta.referral_asked_at = new Date().toISOString();

        const { error: leadUpdateError } = await supabase
          .from("leads")
          .update({ metadata: meta })
          .eq("id", lead.id);

        if (leadUpdateError) throw leadUpdateError;

        await supabase.from("lead_events").insert({
          tenant_id: lead.tenant_id,
          lead_id: lead.id,
          event_type: "referral_loop_triggered",
          payload: {
            source: SOURCE,
            conversation_id: conversation.id,
            message_type: MESSAGE_TYPE,
            validation_status: decision.status,
            validation_reason_code: decision.reasonCode,
            final_guardian_decision: decision.finalDecision,
            scheduled_for: decision.scheduledFor,
            guardian_config_version_id: decision.configVersionId,
          },
          created_at: new Date().toISOString(),
        });
      }

      processed++;
    }

    return new Response(JSON.stringify({ ok: true, dryRun, processed, blocked }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Error in cron-referrals:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
