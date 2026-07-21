import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, normalizeText, numberVariable, redactGuardianText } from "../evidence.ts";

const PROMPT_INJECTION_PATTERNS = [
  /ignore (all )?(previous|above|prior) instructions?/i,
  /forget (all )?(previous|above|prior) instructions?/i,
  /system prompt|developer message|prompt interno|regras internas|instrucoes internas/i,
  /api[_ -]?key|access token|secret|senha|credencial|supabase|edge function/i,
  /tenant_id|lead_id|conversation_id|guardian_key|pending_outbound/i,
  /modo desenvolvedor|jailbreak|roleplay|finja que voce/i,
];

export function validatePromptInjection(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const text = normalizeText(context.input || "");
  const matched = PROMPT_INJECTION_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source)
    .slice(0, 8);

  const warnMin = numberVariable(guardian, "injection_score_warn_min", 0.4);
  const blockMin = numberVariable(guardian, "injection_score_block_min", 0.6);
  const score = Math.min(1, matched.length * 0.25);

  if (score >= warnMin) {
    return {
      decision: score >= blockMin ? "BLOCK" : "WARN",
      reason_code: GuardianReasonCodes.G15_PROMPT_INJECTION_OBSERVED,
      confidence: score,
      evidence: compactEvidence({
        matched_patterns: matched,
        score,
        warn_min: warnMin,
        block_min: blockMin,
        input_preview_redacted: redactGuardianText(context.input, 240),
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.PASS,
    confidence: 0.95,
    evidence: { score, checked_patterns: PROMPT_INJECTION_PATTERNS.length },
  };
}
