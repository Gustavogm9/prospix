export type GuardianMode = "OFF" | "OBSERVE" | "WARN" | "BLOCK" | "HARD_BLOCK";

export type GuardianFailPolicy = "FAIL_OPEN" | "FAIL_CLOSED" | "USE_LAST_KNOWN_GOOD_CONFIG";

export type GuardianDecision =
  | "PASS"
  | "WARN"
  | "DELAY"
  | "REWRITE"
  | "ESCALATE"
  | "BLOCK"
  | "HARD_BLOCK";

export type GuardianStage =
  | "CONFIG_LOAD"
  | "INBOUND_PRE_CLASSIFICATION"
  | "PRE_GENERATION"
  | "GENERATION"
  | "POST_GENERATION"
  | "PRE_ENQUEUE"
  | "QUEUE_SELECTION"
  | "PRE_SEND"
  | "POST_SEND_ERROR"
  | "ALL_STAGES"
  | "ADMIN_VALIDATE"
  | "SIMULATION";

export interface GuardianVariableValue {
  variable_key: string;
  label: string;
  description: string;
  value_type:
    | "boolean"
    | "integer"
    | "decimal"
    | "string"
    | "string_array"
    | "json"
    | "regex"
    | "time"
    | "duration_seconds"
    | "enum";
  value: unknown;
  default_value: unknown;
  min_value: number | null;
  max_value: number | null;
  allowed_values: unknown[] | null;
  validation_regex: string | null;
  unit: string | null;
  is_required: boolean;
  is_sensitive: boolean;
  requires_confirmation: boolean;
  requires_owner: boolean;
}

export interface EffectiveGuardian {
  guardian_key: string;
  name: string;
  description: string;
  layer: string;
  execution_stage: GuardianStage | string;
  function_scope: "webhook-evolution" | "send-messages" | "admin" | "shared";
  enabled: boolean;
  mode: GuardianMode;
  fail_policy: GuardianFailPolicy;
  is_system_critical: boolean;
  sort_order: number;
  variables: GuardianVariableValue[];
}

export interface EffectiveGuardianConfig {
  tenant_id: string;
  active_version: {
    id: string;
    version_number: number;
    config_hash: string;
    activated_at: string | null;
  };
  draft_version: {
    id: string;
    version_number: number;
    config_hash: string;
    created_at: string;
  } | null;
  guardians: EffectiveGuardian[];
}

export interface GuardianRunContext {
  tenantId: string;
  leadId?: string | null;
  conversationId?: string | null;
  pendingOutboundId?: string | null;
  candidateId?: string | null;
  stage: GuardianStage;
  functionScope: EffectiveGuardian["function_scope"];
  input?: unknown;
  output?: unknown;
  facts?: Record<string, unknown>;
}

export interface GuardianValidationResult {
  decision: GuardianDecision;
  reason_code: string;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
}

export interface GuardianLoggedDecision extends GuardianValidationResult {
  guardian_key: string;
  execution_stage: GuardianStage | string;
  mode_applied: GuardianMode;
}

export interface GuardianRunResult {
  config: EffectiveGuardianConfig | null;
  configVersionId: string | null;
  decisions: GuardianLoggedDecision[];
  errors: string[];
  summary: {
    total: number;
    pass: number;
    warn: number;
    block: number;
    hard_block: number;
    phase: "PHASE_3_OBSERVE_ONLY";
  };
}
