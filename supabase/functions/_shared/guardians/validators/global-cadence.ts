import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, variableValue } from "../evidence.ts";

function factNumber(context: GuardianRunContext, key: string): number | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function factString(context: GuardianRunContext, key: string): string | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function stateConfig(guardian: EffectiveGuardian, numberState: string): Record<string, number> | null {
  const states = variableValue<Record<string, Record<string, number>> | null>(guardian, "states", null);
  if (!states || typeof states !== "object") return null;
  return states[numberState] || states.NORMAL || null;
}

function limitNumber(config: Record<string, number> | null, key: string): number | null {
  const parsed = Number(config?.[key]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateGlobalCadence(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const numberState = String(factString(context, "number_state") || "NORMAL").toUpperCase();
  if (numberState === "RECOVERY") {
    return {
      decision: "PASS",
      reason_code: GuardianReasonCodes.G19_GLOBAL_CADENCE_PASS,
      confidence: 0.84,
      evidence: compactEvidence({
        number_state: numberState,
        delegated_to: "G25_WHATSAPP_RECOVERY_REALIGNMENT",
      }),
    };
  }

  const config = stateConfig(guardian, numberState);
  const sentLastMinute = factNumber(context, "sent_last_minute");
  const sentLastHour = factNumber(context, "sent_last_hour");
  const newChatsToday = factNumber(context, "new_chats_today");
  const messageType = factString(context, "message_type");
  const maxMessagesPerMinute = limitNumber(config, "max_messages_per_minute");
  const maxMessagesPerHour = limitNumber(config, "max_messages_per_hour");
  const maxNewChatsPerDay = limitNumber(config, "max_new_chats_per_day");
  const reasons: string[] = [];

  if (sentLastMinute !== null && maxMessagesPerMinute !== null && sentLastMinute >= maxMessagesPerMinute) {
    reasons.push("max_messages_per_minute_reached");
  }

  if (sentLastHour !== null && maxMessagesPerHour !== null && sentLastHour >= maxMessagesPerHour) {
    reasons.push("max_messages_per_hour_reached");
  }

  if (
    messageType === "OUTBOUND_START" &&
    newChatsToday !== null &&
    maxNewChatsPerDay !== null &&
    newChatsToday >= maxNewChatsPerDay
  ) {
    reasons.push("max_new_chats_per_day_reached");
  }

  if (reasons.length > 0) {
    return {
      decision: "DELAY",
      reason_code: GuardianReasonCodes.G19_GLOBAL_CADENCE_DELAYED,
      confidence: 0.96,
      evidence: compactEvidence({
        reasons,
        number_state: numberState,
        sent_last_minute: sentLastMinute,
        sent_last_hour: sentLastHour,
        new_chats_today: newChatsToday,
        message_type: messageType,
        max_messages_per_minute: maxMessagesPerMinute,
        max_messages_per_hour: maxMessagesPerHour,
        max_new_chats_per_day: maxNewChatsPerDay,
        next_scheduled_for: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G19_GLOBAL_CADENCE_PASS,
    confidence: config ? 0.9 : 0.65,
    evidence: compactEvidence({
      number_state: numberState,
      state_config_present: Boolean(config),
      sent_last_minute: sentLastMinute,
      sent_last_hour: sentLastHour,
      new_chats_today: newChatsToday,
      message_type: messageType,
    }),
  };
}
