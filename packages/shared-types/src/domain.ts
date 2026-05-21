/**
 * Tipos de domínio · não dependem do Prisma nem do OpenAPI.
 * Estes tipos NUNCA mudam sem PR aprovado pela Frente A.
 */

// ── Worker job payload base ─────────────────────────────────────────────────
export interface BaseJobPayload {
  tenant_id: string;
  trace_id: string;
  idempotency_key?: string;
}

// ── Result type (sucesso ou erro tipado) ────────────────────────────────────
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface AppError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  trace_id?: string;
}

// ── Códigos de erro padronizados (espelham OpenAPI) ─────────────────────────
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'RESOURCE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'TENANT_QUOTA_EXCEEDED'
  | 'INVITATION_INVALID'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_ALREADY_USED'
  | 'EXTERNAL_SERVICE_DOWN'
  | 'INTERNAL_ERROR';

// ── AI provider abstraction ─────────────────────────────────────────────────
export type AIProviderName = 'openai' | 'anthropic' | 'google';

export type AIUseCase = 'system' | 'classifier' | 'guardrail';

export interface AICallParams {
  use_case: AIUseCase;
  system_prompt: string;
  user_messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_output_tokens?: number;
}

export interface AICallResult {
  content: string;
  provider: AIProviderName;
  model: string;
  tokens_input: number;
  tokens_output: number;
  cost_cents: number;
  latency_ms: number;
}

// ── Intent classifier output ────────────────────────────────────────────────
export type Intent =
  | 'interested'
  | 'has_other_insurance'
  | 'price_objection'
  | 'no_time_now'
  | 'asking_callback'
  | 'scheduling'
  | 'rescheduling'
  | 'not_interested'
  | 'optout_request'
  | 'off_topic'
  | 'complaint'
  | 'unclear';

export interface IntentClassification {
  intent: Intent;
  confidence: number;
  rationale: string;
}

// ── Invitation code helpers ─────────────────────────────────────────────────
export const INVITATION_CODE_REGEX = /^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export type InvitationCode = string & { readonly __brand: 'InvitationCode' };
