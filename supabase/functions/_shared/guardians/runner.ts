import { GuardianConfigLoader } from "./config-loader.ts";
import type {
  EffectiveGuardian,
  EffectiveGuardianConfig,
  GuardianDecision,
  GuardianLoggedDecision,
  GuardianRunContext,
  GuardianRunResult,
  GuardianValidationResult,
} from "./types.ts";
import { PHASE3_GUARDIAN_KEYS, runRegisteredGuardian } from "./registry.ts";
import { GuardianReasonCodes } from "./reason-codes.ts";
import { compactEvidence, redactGuardianText, sha256Hex } from "./evidence.ts";

type SupabaseGuardianClient = {
  rpc: (functionName: "get_guardian_active_config", args: { p_tenant_id: string }) => Promise<{ data: unknown; error: any }>;
  from: (table: string) => {
    insert: (payload: unknown) => Promise<{ data?: unknown; error: any }>;
  };
};

const BLOCKING_MODES = new Set(["BLOCK", "HARD_BLOCK"]);

function matchesStage(guardian: EffectiveGuardian, context: GuardianRunContext): boolean {
  return guardian.execution_stage === context.stage || guardian.execution_stage === "ALL_STAGES";
}

function matchesFunctionScope(guardian: EffectiveGuardian, context: GuardianRunContext): boolean {
  return guardian.function_scope === context.functionScope || guardian.function_scope === "shared";
}

function shouldRunGuardian(guardian: EffectiveGuardian, context: GuardianRunContext): boolean {
  if (!PHASE3_GUARDIAN_KEYS.has(guardian.guardian_key)) return false;
  if (!guardian.enabled || guardian.mode === "OFF") return false;
  return matchesStage(guardian, context) && matchesFunctionScope(guardian, context);
}

function applyMode(guardian: EffectiveGuardian, result: GuardianValidationResult): GuardianDecision {
  if (result.decision === "PASS") return "PASS";
  if (guardian.mode === "OBSERVE" || guardian.mode === "WARN") return "WARN";
  if (guardian.mode === "BLOCK") return "BLOCK";
  if (guardian.mode === "HARD_BLOCK") return "HARD_BLOCK";
  return "WARN";
}

function summarize(decisions: GuardianLoggedDecision[]): GuardianRunResult["summary"] {
  return {
    total: decisions.length,
    pass: decisions.filter((decision) => decision.decision === "PASS").length,
    warn: decisions.filter((decision) => decision.decision === "WARN").length,
    block: decisions.filter((decision) => decision.decision === "BLOCK").length,
    hard_block: decisions.filter((decision) => decision.decision === "HARD_BLOCK").length,
    phase: "PHASE_4_STRUCTURAL_ENFORCEMENT",
  };
}

async function buildDecisionRow(params: {
  context: GuardianRunContext;
  configVersionId: string;
  guardian: EffectiveGuardian;
  result: GuardianValidationResult;
  inputHash: string | null;
  outputHash: string | null;
}): Promise<Record<string, unknown>> {
  const persistedDecision = applyMode(params.guardian, params.result);
  const blocksFlow = persistedDecision === "BLOCK" || persistedDecision === "HARD_BLOCK";

  return {
    tenant_id: params.context.tenantId,
    lead_id: params.context.leadId || null,
    conversation_id: params.context.conversationId || null,
    pending_outbound_id: params.context.pendingOutboundId || null,
    candidate_id: params.context.candidateId || null,
    guardian_key: params.guardian.guardian_key,
    execution_stage: params.context.stage,
    decision: persistedDecision,
    reason_code: params.result.reason_code,
    mode_applied: params.guardian.mode,
    config_version_id: params.configVersionId,
    input_hash: params.inputHash,
    output_hash: params.outputHash,
    evidence: compactEvidence({
      ...(params.result.evidence || {}),
      phase: "PHASE_4_STRUCTURAL_ENFORCEMENT",
      validator_decision: params.result.decision,
      persisted_decision: persistedDecision,
      effective_action: blocksFlow ? "BLOCK_FLOW" : "ALLOW_FLOW",
      function_scope: params.context.functionScope,
    }),
  };
}

export class GuardianRunner {
  static async loadConfig(params: {
    supabase: SupabaseGuardianClient;
    tenantId: string;
  }): Promise<EffectiveGuardianConfig | null> {
    try {
      return await GuardianConfigLoader.loadActive({
        supabase: params.supabase,
        tenantId: params.tenantId,
        required: false,
      });
    } catch (err) {
      console.warn("[GuardianRunner] config load failed", redactGuardianText(err));
      return null;
    }
  }

  static async observe(params: GuardianRunContext & {
    supabase: SupabaseGuardianClient;
    config?: EffectiveGuardianConfig | null;
  }): Promise<GuardianRunResult> {
    const errors: string[] = [];
    const config = params.config === undefined
      ? await GuardianRunner.loadConfig({ supabase: params.supabase, tenantId: params.tenantId })
      : params.config;

    if (!config?.active_version?.id) {
      return {
        allow: true,
        blockingDecision: null,
        config: null,
        configVersionId: null,
        decisions: [],
        errors: [GuardianReasonCodes.CONFIG_UNAVAILABLE_OBSERVED],
        summary: summarize([]),
      };
    }

    const context: GuardianRunContext = {
      tenantId: params.tenantId,
      leadId: params.leadId || null,
      conversationId: params.conversationId || null,
      pendingOutboundId: params.pendingOutboundId || null,
      candidateId: params.candidateId || null,
      stage: params.stage,
      functionScope: params.functionScope,
      input: params.input,
      output: params.output,
      facts: params.facts || {},
    };

    const guardians = config.guardians
      .filter((guardian) => shouldRunGuardian(guardian, context))
      .sort((a, b) => a.sort_order - b.sort_order);

    const inputHash = params.input === undefined ? null : await sha256Hex(params.input);
    const outputHash = params.output === undefined ? null : await sha256Hex(params.output);
    const decisions: GuardianLoggedDecision[] = [];
    const rows: Record<string, unknown>[] = [];
    let blockingDecision: GuardianLoggedDecision | null = null;

    for (const guardian of guardians) {
      let validation: GuardianValidationResult;
      try {
        validation = await runRegisteredGuardian(guardian, context);
      } catch (err) {
        validation = {
          decision: "WARN",
          reason_code: GuardianReasonCodes.VALIDATOR_ERROR_OBSERVED,
          confidence: null,
          evidence: {
            error_preview_redacted: redactGuardianText(err, 240),
            fail_policy: guardian.fail_policy,
          },
        };
      }

      const row = await buildDecisionRow({
        context,
        configVersionId: config.active_version.id,
        guardian,
        result: validation,
        inputHash,
        outputHash,
      });

      decisions.push({
        guardian_key: guardian.guardian_key,
        execution_stage: context.stage,
        mode_applied: guardian.mode,
        decision: row.decision as GuardianDecision,
        reason_code: validation.reason_code,
        confidence: validation.confidence,
        evidence: row.evidence as Record<string, unknown>,
      });
      const latestDecision = decisions[decisions.length - 1];
      if (
        !blockingDecision &&
        BLOCKING_MODES.has(guardian.mode) &&
        (latestDecision.decision === "BLOCK" || latestDecision.decision === "HARD_BLOCK")
      ) {
        blockingDecision = latestDecision;
      }
      rows.push(row);
    }

    if (rows.length > 0) {
      const { error } = await params.supabase.from("guardian_decisions").insert(rows);
      if (error) {
        const message = String(error.message || error);
        errors.push(message);
        console.warn("[GuardianRunner] guardian_decisions insert failed", redactGuardianText(message, 240));
      }
    }

    return {
      allow: !blockingDecision,
      blockingDecision,
      config,
      configVersionId: config.active_version.id,
      decisions,
      errors,
      summary: summarize(decisions),
    };
  }
}
