import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import {
  compactEvidence,
  normalizeText,
  numberVariable,
  stringArrayVariable,
  variableValue,
} from "../evidence.ts";

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

function normalizedToken(value: string | null): string | null {
  if (!value) return null;
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || null;
}

function normalizeScore(value: number | null): number | null {
  if (value === null) return null;
  if (value < 0) return 0;
  if (value <= 1) return value;
  if (value <= 10) return value / 10;
  if (value <= 100) return value / 100;
  return null;
}

function targetLooksLikeIndividualProfession(target: string | null): boolean {
  const normalized = normalizeText(target || "");
  return /\b(medico|medica|doctor|doutor|doutora|advogado|advogada|lawyer|dentista|odontologo|odontologa|profissional|profissional liberal|psicologo|psicologa|nutricionista|fisioterapeuta)\b/.test(normalized);
}

function cleanPhone(value: string | null): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || null;
}

function matchesConfiguredRegex(value: string, pattern: string, fallbackPattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch (_err) {
    return new RegExp(fallbackPattern).test(value);
  }
}

export function validatePhoneEntity(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const phone = cleanPhone(
    factString(context, "lead_whatsapp") ||
      factString(context, "whatsapp") ||
      factString(context, "phone"),
  );
  const phoneStatus = normalizedToken(factString(context, "phone_validation_status"));
  const entityType = normalizedToken(factString(context, "entity_type"));
  const targetProfession = factString(context, "target_profession") || factString(context, "campaign_profession");
  const confidence = normalizeScore(factNumber(context, "phone_validation_confidence"));
  const confidenceMin = numberVariable(guardian, "phone_validation_confidence_min", 0.95);
  const requireE164 = variableValue(guardian, "require_e164", true) !== false;
  const acceptUnknownType = variableValue(guardian, "accept_unknown_type", false) === true;
  const fallbackMobileRegex = "^55\\d{2}9\\d{8}$";
  const mobileRegex = String(variableValue(guardian, "legacy_br_mobile_regex", fallbackMobileRegex));
  const commercialBlacklistEnabled = variableValue(guardian, "commercial_blacklist_enabled", true) !== false;
  const commercialTerms = stringArrayVariable(guardian, "commercial_blacklist_terms", []);
  const leadName = normalizeText(factString(context, "lead_name") || "");
  const reasons: string[] = [];

  if (phoneStatus && INVALID_PHONE_STATUSES.has(phoneStatus)) {
    reasons.push("invalid_phone_validation_status");
  }

  if (phone) {
    const isMobile = matchesConfiguredRegex(phone, mobileRegex, fallbackMobileRegex);
    if (!isMobile) reasons.push("phone_not_mobile_shape");
    if (requireE164 && !phone.startsWith("55")) reasons.push("phone_not_br_e164");
  }

  if (phoneStatus === "UNKNOWN" && !acceptUnknownType) {
    reasons.push("unknown_phone_type_not_allowed");
  }

  if (confidence !== null && confidence < confidenceMin) {
    reasons.push("phone_validation_confidence_below_min");
  }

  if (
    entityType &&
    BUSINESS_ENTITY_TYPES.has(entityType) &&
    targetLooksLikeIndividualProfession(targetProfession)
  ) {
    reasons.push("business_entity_for_individual_profession");
  }

  if (
    commercialBlacklistEnabled &&
    targetLooksLikeIndividualProfession(targetProfession) &&
    commercialTerms.some((term) => leadName.includes(normalizeText(String(term))))
  ) {
    reasons.push("commercial_name_for_individual_profession");
  }

  if (reasons.length > 0) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G03_PHONE_ENTITY_BLOCKED,
      confidence: 0.92,
      evidence: compactEvidence({
        reasons,
        phone_present: Boolean(phone),
        phone_validation_status: phoneStatus,
        phone_validation_confidence: confidence,
        confidence_min: confidenceMin,
        entity_type: entityType,
        target_profession_present: Boolean(targetProfession),
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G03_PHONE_ENTITY_PASS,
    confidence: phone || phoneStatus || entityType ? 0.86 : 0.6,
    evidence: compactEvidence({
      phone_present: Boolean(phone),
      phone_validation_status: phoneStatus,
      phone_validation_confidence: confidence,
      entity_type: entityType,
      target_profession_present: Boolean(targetProfession),
      explicit_phone_entity_evidence_present: Boolean(phone || phoneStatus || entityType),
    }),
  };
}
