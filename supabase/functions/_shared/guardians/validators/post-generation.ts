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
  const invalidLengthMessages = validMessages.filter((message) => message.length < 8 || message.length > 220);
  const invalidCount = validMessages.length < 1 || validMessages.length > 2;

  if (validMessages.length === 0 || invalidLengthMessages.length > 0 || invalidCount) {
    return {
      decision: "HARD_BLOCK",
      reason_code: GuardianReasonCodes.G12_STRUCTURED_OUTPUT_OBSERVED,
      confidence: 0.95,
      evidence: {
        missing: validMessages.length === 0 ? "messages" : null,
        schema_status: "invalid",
        message_count: validMessages.length,
        invalid_length_count: invalidLengthMessages.length,
        invalid_count: invalidCount,
        phase3_effective_action: "observe_only",
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
  const risks: string[] = [];

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

  if (risks.length > 0) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G16_SCOPE_RISK_OBSERVED,
      confidence: 0.82,
      evidence: {
        risks,
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
