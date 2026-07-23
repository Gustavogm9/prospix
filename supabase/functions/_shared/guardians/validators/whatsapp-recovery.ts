import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, numberVariable } from "../evidence.ts";

function factString(context: GuardianRunContext, key: string): string | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function factNumber(context: GuardianRunContext, key: string): number | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value: string | null): string {
  return String(value || "").toUpperCase();
}

export function validateWhatsappRecoveryRealignment(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const previousStatus = normalized(factString(context, "previous_status"));
  const currentStatus = normalized(factString(context, "current_status"));
  const proposedStatus = normalized(factString(context, "proposed_status"));
  const externalState = String(factString(context, "external_state") || "").toLowerCase();
  const transitionReason = factString(context, "transition_reason_code");
  const successfulSends = Math.max(0, factNumber(context, "successful_sends") || 0);
  const criticalEvents = Math.max(0, factNumber(context, "critical_events") || 0);
  const duePending = Math.max(0, factNumber(context, "due_pending") || 0);
  const minutesInRecovery = Math.max(0, factNumber(context, "minutes_in_recovery") || 0);
  const minDuration = numberVariable(guardian, "recovery_min_duration_minutes", 120);
  const minSuccessfulSends = numberVariable(guardian, "recovery_min_successful_sends", 8);

  if (externalState && externalState !== "open") {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G25_RECOVERY_BLOCKED,
      confidence: 0.98,
      evidence: compactEvidence({
        reason: "external_state_not_open",
        previous_status: previousStatus,
        current_status: currentStatus,
        proposed_status: proposedStatus,
        external_state: externalState,
      }),
    };
  }

  if (proposedStatus === "RECOVERY" && previousStatus === "COLD") {
    return {
      decision: "PASS",
      reason_code: GuardianReasonCodes.G25_RECOVERY_STARTED,
      confidence: 0.95,
      evidence: compactEvidence({
        previous_status: previousStatus,
        proposed_status: proposedStatus,
        external_state: externalState,
        transition_reason_code: transitionReason,
        status_flow: ["COLD", "RECOVERY", "NORMAL"],
      }),
    };
  }

  if (currentStatus === "RECOVERY" || proposedStatus === "NORMAL") {
    const blockers: string[] = [];
    if (minutesInRecovery < minDuration) blockers.push("minimum_recovery_duration_not_met");
    if (successfulSends < minSuccessfulSends) blockers.push("minimum_successful_sends_not_met");
    if (criticalEvents > 0) blockers.push("critical_connection_events_present");
    if (duePending > 0) blockers.push("due_queue_not_empty");

    if (blockers.length > 0) {
      return {
        decision: "PASS",
        reason_code: GuardianReasonCodes.G25_RECOVERY_HELD,
        confidence: 0.94,
        evidence: compactEvidence({
          blockers,
          current_status: currentStatus,
          proposed_status: proposedStatus,
          external_state: externalState,
          minutes_in_recovery: minutesInRecovery,
          recovery_min_duration_minutes: minDuration,
          successful_sends: successfulSends,
          recovery_min_successful_sends: minSuccessfulSends,
          critical_events: criticalEvents,
          due_pending: duePending,
          effective_action: "KEEP_RECOVERY",
        }),
      };
    }

    return {
      decision: "PASS",
      reason_code: GuardianReasonCodes.G25_RECOVERY_PROMOTED,
      confidence: 0.97,
      evidence: compactEvidence({
        current_status: currentStatus,
        proposed_status: proposedStatus,
        external_state: externalState,
        minutes_in_recovery: minutesInRecovery,
        successful_sends: successfulSends,
        critical_events: criticalEvents,
        due_pending: duePending,
        effective_action: "ALLOW_NORMAL",
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.PASS,
    confidence: 0.8,
    evidence: compactEvidence({
      previous_status: previousStatus,
      current_status: currentStatus,
      proposed_status: proposedStatus,
      external_state: externalState,
      recovery_evaluation_applicable: false,
    }),
  };
}
