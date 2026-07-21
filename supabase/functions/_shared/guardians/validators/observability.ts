import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence } from "../evidence.ts";

export function validateObservability(
  _guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G23_OBSERVABILITY_LOGGED,
    confidence: 1,
    evidence: compactEvidence({
      stage: context.stage,
      function_scope: context.functionScope,
      has_lead_id: Boolean(context.leadId),
      has_conversation_id: Boolean(context.conversationId),
      has_pending_outbound_id: Boolean(context.pendingOutboundId),
      has_candidate_id: Boolean(context.candidateId),
    }),
  };
}
