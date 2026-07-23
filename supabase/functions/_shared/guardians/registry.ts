import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "./types.ts";
import { GuardianReasonCodes } from "./reason-codes.ts";
import { validateConversationState } from "./validators/conversation-state.ts";
import {
  validateBusinessHoursWakeSpread,
  validateConcurrencyLock,
  validateContactCadence,
} from "./validators/cadence.ts";
import { validateGlobalCadence } from "./validators/global-cadence.ts";
import { validateInboundIdempotency } from "./validators/inbound-idempotency.ts";
import { validateLeadRelevance } from "./validators/lead-relevance.ts";
import { validatePhoneEntity } from "./validators/phone-entity.ts";
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
import { validateSendIntegrity } from "./validators/send-integrity.ts";
import { validateWhatsappRecoveryRealignment } from "./validators/whatsapp-recovery.ts";

export const ACTIVE_GUARDIAN_KEYS = new Set([
  "G01_INBOUND_IDEMPOTENCY",
  "G02_LEAD_RELEVANCE",
  "G03_PHONE_ENTITY",
  "G04_IDENTITY_PERSONALIZATION",
  "G05_CONVERSATION_STATE",
  "G12_STRUCTURED_OUTPUT",
  "G13_PLACEHOLDER_LEAK",
  "G14_INTERNAL_LEAK",
  "G15_PROMPT_INJECTION",
  "G16_SEMANTIC_SCOPE",
  "G17_NATURALNESS",
  "G18_BUSINESS_HOURS",
  "G19_GLOBAL_CADENCE",
  "G20_CONTACT_CADENCE",
  "G21_CONCURRENCY_LOCK",
  "G22_SEND_INTEGRITY",
  "G25_WHATSAPP_RECOVERY_REALIGNMENT",
  "G23_OBSERVABILITY",
]);

type GuardianValidator = (
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
) => GuardianValidationResult | Promise<GuardianValidationResult>;

const validators: Record<string, GuardianValidator> = {
  G01_INBOUND_IDEMPOTENCY: validateInboundIdempotency,
  G02_LEAD_RELEVANCE: validateLeadRelevance,
  G03_PHONE_ENTITY: validatePhoneEntity,
  G04_IDENTITY_PERSONALIZATION: validateIdentityPersonalization,
  G05_CONVERSATION_STATE: validateConversationState,
  G12_STRUCTURED_OUTPUT: validateStructuredOutput,
  G13_PLACEHOLDER_LEAK: validatePlaceholderLeak,
  G14_INTERNAL_LEAK: validateInternalLeak,
  G15_PROMPT_INJECTION: validatePromptInjection,
  G16_SEMANTIC_SCOPE: validateSemanticScope,
  G17_NATURALNESS: validateNaturalness,
  G18_BUSINESS_HOURS: validateBusinessHoursWakeSpread,
  G19_GLOBAL_CADENCE: validateGlobalCadence,
  G20_CONTACT_CADENCE: validateContactCadence,
  G21_CONCURRENCY_LOCK: validateConcurrencyLock,
  G22_SEND_INTEGRITY: validateSendIntegrity,
  G25_WHATSAPP_RECOVERY_REALIGNMENT: validateWhatsappRecoveryRealignment,
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
