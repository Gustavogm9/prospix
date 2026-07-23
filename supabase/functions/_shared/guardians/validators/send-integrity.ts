import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, stringArrayVariable } from "../evidence.ts";

function factString(context: GuardianRunContext, key: string): string | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function factBoolean(context: GuardianRunContext, key: string): boolean {
  const value = context.facts?.[key];
  return value === true || value === "true";
}

function matchesAnyTerm(text: string, terms: string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(String(term).toLowerCase()));
}

export function validateSendIntegrity(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const errorText = factString(context, "send_error") || "";
  const reasonCode = factString(context, "send_failure_reason_code");
  const status = factString(context, "send_failure_status");
  const critical = factBoolean(context, "send_failure_critical");
  const shouldBackoff = factBoolean(context, "send_failure_should_backoff");
  const criticalTerms = stringArrayVariable(guardian, "critical_errors", [
    "401",
    "conflict",
    "device_removed",
    "stream errored",
  ]);
  const transientTerms = stringArrayVariable(guardian, "transient_errors", [
    "timeout",
    "429",
    "500",
    "502",
    "503",
    "504",
  ]);
  const criticalMatched = critical || matchesAnyTerm(errorText, criticalTerms);

  if (criticalMatched) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G22_SEND_INTEGRITY_CRITICAL,
      confidence: 0.98,
      evidence: compactEvidence({
        send_failure_reason_code: reasonCode,
        send_failure_status: status,
        critical,
        matched_critical_terms: criticalTerms.filter((term) =>
          errorText.toLowerCase().includes(String(term).toLowerCase()),
        ),
        effective_action: "SUSPEND_OR_PAUSE_NUMBER",
      }),
    };
  }

  if (shouldBackoff || matchesAnyTerm(errorText, transientTerms)) {
    return {
      decision: "DELAY",
      reason_code: GuardianReasonCodes.G22_SEND_INTEGRITY_TRANSIENT,
      confidence: 0.9,
      evidence: compactEvidence({
        send_failure_reason_code: reasonCode,
        send_failure_status: status,
        should_backoff: shouldBackoff,
        matched_transient_terms: transientTerms.filter((term) =>
          errorText.toLowerCase().includes(String(term).toLowerCase()),
        ),
        next_scheduled_for:
          factString(context, "retry_at") || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G22_SEND_INTEGRITY_PASS,
    confidence: 0.75,
    evidence: compactEvidence({
      send_failure_reason_code: reasonCode,
      send_failure_status: status,
      classified: Boolean(reasonCode),
      error_present: Boolean(errorText),
    }),
  };
}
