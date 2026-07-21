import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, normalizeText, numberVariable, redactGuardianText, variableValue } from "../evidence.ts";

const WEAK_RELEVANCE_STATUSES = new Set([
  "BLOCK_LOW_RELEVANCE",
  "BLOCK_ENTITY_MISMATCH",
  "COMMERCIAL_LEAD_SKIPPED",
  "DISQUALIFIED",
  "INVALID",
  "INVALID_NUMBER",
  "IRRELEVANT",
  "LOW_RELEVANCE",
  "NOT_RELEVANT",
  "REJECTED",
  "UNQUALIFIED",
  "WEAK",
]);

const TERMINAL_OR_UNSENDABLE_LEAD_STATUSES = new Set([
  "ARCHIVED",
  "BLOCKED",
  "COMMERCIAL_LEAD_SKIPPED",
  "INVALID_NUMBER",
  "LOST",
  "OPTED_OUT",
  "UNSUBSCRIBED",
]);

const INVALID_PHONE_STATUSES = new Set([
  "FIXED_LINE",
  "INVALID",
  "INVALID_NUMBER",
  "LANDLINE",
  "NO_WHATSAPP",
  "NOT_MOBILE",
  "OPTED_OUT",
  "UNREACHABLE",
]);

const BUSINESS_ENTITY_TYPES = new Set([
  "BUSINESS",
  "COMPANY",
  "ORGANIZATION",
  "PLACE",
  "VENUE",
]);

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

function normalizeScore(value: number | null): number | null {
  if (value === null) return null;
  if (value < 0) return 0;
  if (value <= 1) return value;
  if (value <= 10) return value / 10;
  if (value <= 100) return value / 100;
  return null;
}

function normalizedToken(value: string | null): string | null {
  if (!value) return null;
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || null;
}

function targetLooksLikeIndividualProfession(target: string | null): boolean {
  const normalized = normalizeText(target || "");
  return /\b(medico|medica|doctor|doutor|doutora|advogado|advogada|lawyer|dentista|odontologo|odontologa|profissional|profissional liberal|psicologo|psicologa|nutricionista|fisioterapeuta)\b/.test(normalized);
}

export function validateLeadRelevance(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const allowMin = numberVariable(guardian, "lead_relevance_allow_min", 0.85);
  const reviewMin = numberVariable(guardian, "lead_relevance_review_min", 0.7);
  const unknownEntityAction = String(variableValue(guardian, "unknown_entity_action", "BLOCK")).toUpperCase();
  const lowRelevanceAction = String(variableValue(guardian, "low_relevance_action", "BLOCK")).toUpperCase();

  const relevanceStatus = normalizedToken(factString(context, "relevance_status"));
  const leadStatus = normalizedToken(factString(context, "lead_status"));
  const phoneValidationStatus = normalizedToken(factString(context, "phone_validation_status"));
  const entityType = normalizedToken(factString(context, "entity_type"));
  const targetProfession = factString(context, "target_profession") || factString(context, "campaign_profession");

  const relevanceScore = normalizeScore(factNumber(context, "relevance_score"));
  const fitScore = normalizeScore(factNumber(context, "fit_score"));
  const phoneValidationConfidence = normalizeScore(factNumber(context, "phone_validation_confidence"));
  const identityConfidence = normalizeScore(factNumber(context, "identity_confidence"));

  const reasons: string[] = [];

  if (relevanceStatus && WEAK_RELEVANCE_STATUSES.has(relevanceStatus)) {
    reasons.push("weak_relevance_status");
  }

  if (leadStatus && TERMINAL_OR_UNSENDABLE_LEAD_STATUSES.has(leadStatus)) {
    reasons.push("terminal_or_unsendable_lead_status");
  }

  if (phoneValidationStatus && INVALID_PHONE_STATUSES.has(phoneValidationStatus)) {
    reasons.push("invalid_phone_validation_status");
  }

  if (entityType === "UNKNOWN" && unknownEntityAction === "BLOCK") {
    reasons.push("explicit_unknown_entity");
  }

  if (
    entityType &&
    BUSINESS_ENTITY_TYPES.has(entityType) &&
    targetLooksLikeIndividualProfession(targetProfession)
  ) {
    reasons.push("business_entity_for_individual_profession");
  }

  if (relevanceScore !== null && relevanceScore < reviewMin && lowRelevanceAction === "BLOCK") {
    reasons.push("relevance_score_below_review_min");
  }

  if (relevanceScore === null && fitScore !== null && fitScore < reviewMin && lowRelevanceAction === "BLOCK") {
    reasons.push("fit_score_below_review_min");
  }

  if (reasons.length > 0) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G02_LEAD_RELEVANCE_BLOCKED,
      confidence: 0.9,
      evidence: compactEvidence({
        reasons,
        relevance_status: relevanceStatus,
        lead_status: leadStatus,
        phone_validation_status: phoneValidationStatus,
        entity_type: entityType,
        target_profession_redacted: redactGuardianText(targetProfession || "", 120),
        relevance_score: relevanceScore,
        fit_score_normalized: fitScore,
        phone_validation_confidence: phoneValidationConfidence,
        identity_confidence: identityConfidence,
        review_min: reviewMin,
        allow_min: allowMin,
        low_relevance_action: lowRelevanceAction,
        unknown_entity_action: unknownEntityAction,
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G02_LEAD_RELEVANCE_PASS,
    confidence: 0.88,
    evidence: compactEvidence({
      relevance_status: relevanceStatus,
      lead_status: leadStatus,
      phone_validation_status: phoneValidationStatus,
      entity_type: entityType,
      target_profession_present: Boolean(targetProfession),
      relevance_score: relevanceScore,
      fit_score_normalized: fitScore,
      phone_validation_confidence: phoneValidationConfidence,
      identity_confidence: identityConfidence,
      review_min: reviewMin,
      allow_min: allowMin,
      explicit_relevance_data_present: relevanceScore !== null || relevanceStatus !== null,
    }),
  };
}
