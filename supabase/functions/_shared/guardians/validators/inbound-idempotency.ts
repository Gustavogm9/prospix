import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, numberVariable, variableValue } from "../evidence.ts";

function inputString(context: GuardianRunContext, key: string): string | null {
  const input = context.input as Record<string, unknown> | undefined;
  const value = input?.[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function factBoolean(context: GuardianRunContext, key: string): boolean {
  const value = context.facts?.[key];
  return value === true || value === "true";
}

export function validateInboundIdempotency(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const duplicateDetected = factBoolean(context, "duplicate_inbound_detected");
  const ignoreDuplicate = variableValue(guardian, "ignore_duplicate_inbound", true) !== false;
  const whatsappMessageId = inputString(context, "whatsapp_message_id");
  const inboundMessageId = inputString(context, "inbound_message_id");
  const dedupWindowHours = numberVariable(guardian, "inbound_dedup_window_hours", 24);
  const sameTextWindowMinutes = numberVariable(guardian, "same_text_hash_window_minutes", 10);

  if (duplicateDetected && ignoreDuplicate) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G01_INBOUND_IDEMPOTENCY_DUPLICATE,
      confidence: 0.98,
      evidence: compactEvidence({
        duplicate_inbound_detected: true,
        whatsapp_message_id_present: Boolean(whatsappMessageId),
        inbound_message_id_present: Boolean(inboundMessageId),
        inbound_dedup_window_hours: dedupWindowHours,
        same_text_hash_window_minutes: sameTextWindowMinutes,
        effective_action: "IGNORE_DUPLICATE_INBOUND",
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G01_INBOUND_IDEMPOTENCY_PASS,
    confidence: whatsappMessageId || inboundMessageId ? 0.9 : 0.65,
    evidence: compactEvidence({
      duplicate_inbound_detected: duplicateDetected,
      whatsapp_message_id_present: Boolean(whatsappMessageId),
      inbound_message_id_present: Boolean(inboundMessageId),
      inbound_dedup_window_hours: dedupWindowHours,
      same_text_hash_window_minutes: sameTextWindowMinutes,
      ledger_processed_before_ai: true,
    }),
  };
}
