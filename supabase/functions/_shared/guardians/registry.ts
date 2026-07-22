import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "./types.ts";
import { GuardianReasonCodes } from "./reason-codes.ts";
import { validateConversationState } from "./validators/conversation-state.ts";
import {
  validateBusinessHoursWakeSpread,
  validateConcurrencyLock,
  validateContactCadence,
} from "./validators/cadence.ts";
import { validateLeadRelevance } from "./validators/lead-relevance.ts";
import { validatePromptInjection } from "./validators/prompt-injection.ts";
import {
  validateIdentityPersonalization,
  validateInternalLeak,
  validateNaturalness,
  validatePlaceholderLeak,
  validateSemanticScope,
  validateStructuredOutput,
} from "./validators/post-generation.ts";
import { validateObservability } from "./validators/observability.ts";

export const ACTIVE_GUARDIAN_KEYS = new Set([
  "G02_LEAD_RELEVANCE",
  "G04_IDENTITY_PERSONALIZATION",
  "G05_CONVERSATION_STATE",
  "G12_STRUCTURED_OUTPUT",
  "G13_PLACEHOLDER_LEAK",
  "G14_INTERNAL_LEAK",
  "G15_PROMPT_INJECTION",
  "G16_SEMANTIC_SCOPE",
  "G17_NATURALNESS",
  "G18_BUSINESS_HOURS",
  "G20_CONTACT_CADENCE",
  "G21_CONCURRENCY_LOCK",
  "G25_WHATSAPP_RECOVERY_REALIGNMENT",
  "G23_OBSERVABILITY",
]);

type GuardianValidator = (
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
) => GuardianValidationResult | Promise<GuardianValidationResult>;

const validators: Record<string, GuardianValidator> = {
  G02_LEAD_RELEVANCE: validateLeadRelevance,
  G04_IDENTITY_PERSONALIZATION: validateIdentityPersonalization,
  G05_CONVERSATION_STATE: validateConversationState,
  G12_STRUCTURED_OUTPUT: validateStructuredOutput,
  G13_PLACEHOLDER_LEAK: validatePlaceholderLeak,
  G14_INTERNAL_LEAK: validateInternalLeak,
  G15_PROMPT_INJECTION: validatePromptInjection,
  G16_SEMANTIC_SCOPE: validateSemanticScope,
  G17_NATURALNESS: validateNaturalness,
  G18_BUSINESS_HOURS: validateBusinessHoursWakeSpread,
  G20_CONTACT_CADENCE: validateContactCadence,
  G21_CONCURRENCY_LOCK: validateConcurrencyLock,
  G23_OBSERVABILITY: validateObservability,
};

export async function runRegisteredGuardian(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): Promise<GuardianValidationResult> {
  const validator = validators[guardian.guardian_key];
  if (!validator) {
    return {
      decision: "PASS",
      reason_code: GuardianReasonCodes.PASS,
      confidence: 1,
      evidence: { validator_registered: false },
    };
  }

  return await validator(guardian, context);
}
