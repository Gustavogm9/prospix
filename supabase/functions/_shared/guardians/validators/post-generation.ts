import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import {
  compactEvidence,
  normalizeText,
  numberVariable,
  redactGuardianText,
  safeRegex,
  stringArrayVariable,
  toLoggableText,
  variableValue,
} from "../evidence.ts";

function outputText(context: GuardianRunContext): string {
  if (typeof context.output === "string") return context.output;
  const output = context.output as Record<string, unknown> | undefined;
  const messages = Array.isArray(output?.messages) ? output?.messages : null;
  if (messages) {
    return messages
      .map((message) => {
        if (typeof message === "string") return message;
        if (message && typeof message === "object") return String((message as Record<string, unknown>).text || "");
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return toLoggableText(context.output || "");
}

function factNumber(context: GuardianRunContext, key: string): number | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function factBoolean(context: GuardianRunContext, key: string): boolean | null {
  const value = context.facts?.[key];
  if (value === true || value === false) return value;
  return null;
}

function candidateFlag(context: GuardianRunContext, key: string): boolean {
  const output = context.output as Record<string, unknown> | undefined;
  return output?.[key] === true;
}

function outputClaims(context: GuardianRunContext): unknown[] {
  const output = context.output as Record<string, unknown> | undefined;
  return Array.isArray(output?.claims) ? output.claims : [];
}

function hasClaimEvidence(claim: unknown, allowedSources: string[]): boolean {
  if (!claim || typeof claim !== "object") return false;
  const entry = claim as Record<string, unknown>;
  if (typeof entry.evidence_id === "string" && entry.evidence_id.trim().length > 0) return true;
  if (Array.isArray(entry.evidence_ids) && entry.evidence_ids.some((id) => typeof id === "string" && id.trim().length > 0)) {
    return true;
  }
  if (typeof entry.source === "string" && allowedSources.includes(entry.source)) return true;
  return false;
}

function unsupportedStructuredClaims(context: GuardianRunContext, allowedSources: string[]): string[] {
  return outputClaims(context)
    .map((claim, index) => ({ claim, index }))
    .filter(({ claim }) => !hasClaimEvidence(claim, allowedSources))
    .map(({ claim, index }) => {
      if (typeof claim === "string") return redactGuardianText(claim, 120);
      if (claim && typeof claim === "object") {
        const text = (claim as Record<string, unknown>).text || (claim as Record<string, unknown>).claim || "";
        return text ? redactGuardianText(text, 120) : `claim_${index}_missing_evidence`;
      }
      return `claim_${index}_invalid`;
    })
    .slice(0, 10);
}

function isBusinessLikeName(value: unknown): boolean {
  const normalized = normalizeText(value || "");
  return /\b(advocacia|advogados|assessoria|consultoria|clinica|clínica|centro|instituto|odontologia|saude|saúde|hotel|pousada|restaurante|loja|mercado|supermercado|distribuidora|construtora|imobiliaria|imobiliária)\b/i.test(normalized);
}

export function validateIdentityPersonalization(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const text = outputText(context);
  const normalized = normalizeText(text);
  const forbiddenTitles = stringArrayVariable(guardian, "forbidden_unverified_titles", [
    "Dr.",
    "Dra.",
    "Doutor",
    "Doutora",
    "Sr.",
    "Sra.",
    "Senhor",
    "Senhora",
  ]);
  const matchedTitles = forbiddenTitles
    .filter((term) => normalized.includes(normalizeText(term)))
    .slice(0, 10);
  const usedTitle = candidateFlag(context, "used_title") || matchedTitles.length > 0;
  const usedGenderedTerm = candidateFlag(context, "used_gendered_term");
  const usedName = candidateFlag(context, "used_name");
  const titleVerified = factBoolean(context, "title_verified");
  const identityConfidence = factNumber(context, "identity_confidence");
  const genderConfidence = factNumber(context, "gender_confidence");
  const reasons: string[] = [];

  if (usedTitle && variableValue(guardian, "title_verified_required", true) && titleVerified !== true) {
    reasons.push("title_unverified");
  }

  if (usedGenderedTerm && variableValue<boolean>(guardian, "allow_gendered_terms", false) !== true) {
    reasons.push("gendered_term_not_allowed");
  }

  if (
    usedGenderedTerm &&
    genderConfidence !== null &&
    genderConfidence < numberVariable(guardian, "gender_confidence_min", 0.98)
  ) {
    reasons.push("gender_confidence_below_min");
  }

  if (
    usedName &&
    identityConfidence !== null &&
    identityConfidence < numberVariable(guardian, "name_confidence_min", 0.9)
  ) {
    reasons.push("identity_confidence_below_min");
  }

  if (
    usedName &&
    variableValue(guardian, "block_business_like_name", true) === true &&
    isBusinessLikeName(context.facts?.lead_name)
  ) {
    reasons.push("business_like_name_used_as_person");
  }

  if (reasons.length > 0) {
    return {
      decision: "HARD_BLOCK",
      reason_code: GuardianReasonCodes.G04_IDENTITY_PERSONALIZATION_BLOCKED,
      confidence: 0.96,
      evidence: compactEvidence({
        reasons,
        matched_titles: matchedTitles,
        used_title: usedTitle,
        used_gendered_term: usedGenderedTerm,
        used_name: usedName,
        title_verified: titleVerified,
        identity_confidence: identityConfidence,
        gender_confidence: genderConfidence,
        lead_name_redacted: redactGuardianText(context.facts?.lead_name || "", 120),
        output_preview_redacted: redactGuardianText(text, 240),
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G04_IDENTITY_PERSONALIZATION_PASS,
    confidence: 0.94,
    evidence: compactEvidence({
      used_title: usedTitle,
      used_gendered_term: usedGenderedTerm,
      used_name: usedName,
      title_verified: titleVerified,
      identity_confidence: identityConfidence,
      gender_confidence: genderConfidence,
    }),
  };
}

export function validateStructuredOutput(
  _guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const output = context.output as Record<string, unknown> | undefined;
  const messages = Array.isArray(output?.messages) ? output.messages : [];
  const messageTexts = messages.map((message) => {
    if (typeof message === "string") return message.trim();
    if (!message || typeof message !== "object") return false;
    return typeof (message as Record<string, unknown>).text === "string"
      ? String((message as Record<string, unknown>).text).trim()
      : "";
  });
  const validMessages = messageTexts.filter((message): message is string => typeof message === "string" && message.length > 0);
  const invalidMessages = messageTexts.filter((message) => typeof message !== "string" || message.length === 0);
  const invalidCount = validMessages.length < 1 || validMessages.length > 3;

  if (validMessages.length === 0 || invalidMessages.length > 0 || invalidCount) {
    return {
      decision: "HARD_BLOCK",
      reason_code: GuardianReasonCodes.G12_STRUCTURED_OUTPUT_OBSERVED,
      confidence: 0.95,
      evidence: {
        missing: validMessages.length === 0 ? "messages" : null,
        schema_status: "invalid",
        message_count: validMessages.length,
        invalid_message_count: invalidMessages.length,
        invalid_count: invalidCount,
        effective_action: "block_when_enforced",
      },
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G12_STRUCTURED_OUTPUT_PASS,
    confidence: 0.99,
    evidence: {
      schema_status: "valid_derived_candidate",
      message_count: validMessages.length,
    },
  };
}

export function validatePlaceholderLeak(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const text = outputText(context);
  const configured = stringArrayVariable(guardian, "block_regexes", []);
  const patterns = configured.length > 0
    ? configured
    : ["\\[[^\\]]+\\]", "\\{\\{[^}]+\\}\\}", "<\\s*[a-zA-Z_][^>]{0,40}\\s*>", "\\$[A-Z_][A-Z0-9_]*", "%[A-Z_][A-Z0-9_]*%"];

  const matches: string[] = [];
  for (const pattern of patterns) {
    const regex = safeRegex(pattern);
    if (!regex) continue;
    for (const match of text.matchAll(regex)) {
      if (match[0]) matches.push(redactGuardianText(match[0], 80));
      if (matches.length >= 10) break;
    }
    if (matches.length >= 10) break;
  }

  if (matches.length > 0) {
    return {
      decision: "HARD_BLOCK",
      reason_code: GuardianReasonCodes.G13_PLACEHOLDER_LEAK_OBSERVED,
      confidence: 0.98,
      evidence: {
        match_count: matches.length,
        matches,
        output_preview_redacted: redactGuardianText(text, 240),
      },
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.PASS,
    confidence: 0.98,
    evidence: { checked_patterns: patterns.length },
  };
}

export function validateInternalLeak(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const text = outputText(context);
  const normalized = normalizeText(text);
  const blockedTerms = stringArrayVariable(guardian, "blocked_terms_case_insensitive", []);
  const matchedTerms = blockedTerms
    .filter((term) => normalized.includes(normalizeText(term)))
    .slice(0, 10);

  const jsonVisible = /\{[\s\S]{0,800}":[\s\S]{0,800}\}/.test(text) || /```json/i.test(text);
  const codeLike = /```|<script\b|<\/?[a-z][\w-]+[^>]*>/i.test(text);
  const uuidVisible = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text);

  if (matchedTerms.length > 0 || jsonVisible || codeLike || uuidVisible) {
    return {
      decision: "HARD_BLOCK",
      reason_code: GuardianReasonCodes.G14_INTERNAL_LEAK_OBSERVED,
      confidence: 0.94,
      evidence: compactEvidence({
        matched_terms: matchedTerms,
        json_visible: jsonVisible,
        code_like: codeLike,
        uuid_visible: uuidVisible,
        output_preview_redacted: redactGuardianText(text, 240),
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.PASS,
    confidence: 0.96,
    evidence: { checked_terms: blockedTerms.length },
  };
}

export function validateSemanticScope(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const text = outputText(context);
  const normalized = normalizeText(text);
  const allowedSources = stringArrayVariable(guardian, "allowed_sources", [
    "conversation_history",
    "lead_record",
    "script",
    "approved_objections",
    "approved_knowledge_base",
    "calendar_availability",
  ]);
  const unsupportedClaims = unsupportedStructuredClaims(context, allowedSources);
  const unsupportedClaimsMax = numberVariable(guardian, "unsupported_claims_max", 0);
  const risks: string[] = [];

  if (unsupportedClaims.length > unsupportedClaimsMax) {
    risks.push("unsupported_structured_claim");
  }
  if (variableValue(guardian, "forbid_unapproved_numbers", true) && /(?:\+?55)?\d{10,13}/.test(text)) {
    risks.push("phone_or_number_visible");
  }
  if (variableValue(guardian, "forbid_unapproved_promises", true) && /\b(garanto|garantimos|prometo|prometemos|100%|sem risco)\b/i.test(normalized)) {
    risks.push("promise_or_guarantee");
  }
  if (variableValue(guardian, "forbid_external_facts_without_source", true) && /https?:\/\/|www\./i.test(text)) {
    risks.push("external_link");
  }
  if (/r\$\s*[\d.,]+|\d+\s*reais/i.test(normalized)) {
    risks.push("price_claim");
  }
  if (/\b(lider|lideres|melhor|maior|premiado|premiada|certificado|certificada|comprovado|comprovada)\b/i.test(normalized)) {
    risks.push("unsupported_superlative_or_credential_claim");
  }
  if (/\b\d+\s*%/.test(normalized)) {
    risks.push("unsupported_percentage_claim");
  }
  if (/\b(mais de|ha|há)\s+\d+\s+(anos|clientes|projetos|casos|empresas)\b/i.test(normalized)) {
    risks.push("unsupported_quantified_claim");
  }

  if (risks.length > 0) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G16_SCOPE_RISK_OBSERVED,
      confidence: 0.82,
      evidence: {
        risks,
        unsupported_claims: unsupportedClaims,
        unsupported_claims_max: unsupportedClaimsMax,
        allowed_sources: allowedSources,
        output_preview_redacted: redactGuardianText(text, 240),
      },
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.PASS,
    confidence: 0.9,
    evidence: { checked_scope_rules: true },
  };
}

export function validateNaturalness(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const text = outputText(context);
  const normalized = normalizeText(text);
  const maxExclamation = numberVariable(guardian, "max_exclamation_marks", 1);
  const maxEmoji = numberVariable(guardian, "max_emoji_per_conversation_window", 1);
  const exclamationCount = (text.match(/!/g) || []).length;
  const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
  const risks: string[] = [];

  if (exclamationCount > maxExclamation) risks.push("excess_exclamation");
  if (emojiCount > maxEmoji) risks.push("excess_emoji");
  if (normalized.length > 320) risks.push("overlong_whatsapp_reply");
  if (/(sou uma ia|sou um bot|como assistente virtual|mensagem automatica|resposta automatica)/i.test(normalized)) {
    risks.push("robotic_disclosure");
  }
  if (/(incrivel oportunidade|imperdivel|nao perca essa chance|revolucionario)/i.test(normalized)) {
    risks.push("sales_cliche");
  }

  if (risks.length > 0) {
    return {
      decision: "WARN",
      reason_code: GuardianReasonCodes.G17_NATURALNESS_RISK_OBSERVED,
      confidence: 0.8,
      evidence: {
        risks,
        exclamation_count: exclamationCount,
        emoji_count: emojiCount,
        char_count: normalized.length,
        output_preview_redacted: redactGuardianText(text, 240),
      },
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.PASS,
    confidence: 0.88,
    evidence: {
      exclamation_count: exclamationCount,
      emoji_count: emojiCount,
      char_count: normalized.length,
    },
  };
}
