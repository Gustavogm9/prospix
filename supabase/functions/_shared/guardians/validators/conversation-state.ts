import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, normalizeText, variableValue } from "../evidence.ts";

const CLOSED_STATES = new Set(["CLOSED", "CLOSED_WON", "CLOSED_LOST"]);
const ESCALATED_STATES = new Set(["ESCALATED", "HUMAN_TAKEOVER"]);
const BLOCKED_STATES = new Set(["BLOCKED", "LOCKED"]);

function factString(context: GuardianRunContext, key: string): string | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function factBoolean(context: GuardianRunContext, key: string): boolean | null {
  const value = context.facts?.[key];
  if (value === true || value === false) return value;
  return null;
}

function normalizedState(value: string | null): string | null {
  if (!value) return null;
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || null;
}

export function validateConversationState(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const conversationStatus = normalizedState(factString(context, "conversation_status"));
  const leadStatus = normalizedState(factString(context, "lead_status"));
  const aiHandling = factBoolean(context, "ai_handling");
  const scheduledAutoReplyAllowed = variableValue(guardian, "scheduled_conversation_auto_reply_allowed", false) === true;
  const closedConversationAction = String(variableValue(guardian, "closed_conversation_action", "BLOCK")).toUpperCase();
  const escalatedConversationAction = String(variableValue(guardian, "escalated_conversation_action", "BLOCK")).toUpperCase();

  const reasons: string[] = [];

  if (aiHandling === false) {
    reasons.push("ai_handling_disabled");
  }

  if (conversationStatus && CLOSED_STATES.has(conversationStatus) && closedConversationAction === "BLOCK") {
    reasons.push("closed_conversation");
  }

  if (conversationStatus && ESCALATED_STATES.has(conversationStatus) && escalatedConversationAction === "BLOCK") {
    reasons.push("escalated_conversation");
  }

  if (conversationStatus && BLOCKED_STATES.has(conversationStatus)) {
    reasons.push("blocked_conversation");
  }

  if (conversationStatus === "SCHEDULED" && !scheduledAutoReplyAllowed) {
    reasons.push("scheduled_conversation_auto_reply_not_allowed");
  }

  if (leadStatus && CLOSED_STATES.has(leadStatus)) {
    reasons.push("closed_lead_status");
  }

  if (reasons.length > 0) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G05_CONVERSATION_STATE_BLOCKED,
      confidence: 0.98,
      evidence: compactEvidence({
        reasons,
        conversation_status: conversationStatus,
        lead_status: leadStatus,
        ai_handling: aiHandling,
        scheduled_conversation_auto_reply_allowed: scheduledAutoReplyAllowed,
        closed_conversation_action: closedConversationAction,
        escalated_conversation_action: escalatedConversationAction,
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G05_CONVERSATION_STATE_PASS,
    confidence: 0.96,
    evidence: compactEvidence({
      conversation_status: conversationStatus,
      lead_status: leadStatus,
      ai_handling: aiHandling,
      scheduled_conversation_auto_reply_allowed: scheduledAutoReplyAllowed,
    }),
  };
}
