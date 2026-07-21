import { normalizeText } from "./evidence.ts";

export function toCandidateIntent(intent: string): string {
  if (["QUESTION", "INTERESTED", "OBJECTION", "SCHEDULED", "NOT_INTERESTED"].includes(intent)) {
    return intent;
  }
  return "OTHER";
}

export function textHasTitle(text: string): boolean {
  return /\b(dr\.?|dra\.?|doutor|doutora|sr\.?|sra\.?|senhor|senhora)\b/i.test(text);
}

export function textHasGenderedTerm(text: string): boolean {
  return /\b(dra\.?|doutora|sra\.?|senhora|caro|cara|obrigado|obrigada)\b/i.test(text);
}

export function textUsesLeadName(text: string, leadName?: string | null): boolean {
  const firstName = String(leadName || "").trim().split(/\s+/)[0] || "";
  if (firstName.length < 3) return false;
  return normalizeText(text).includes(normalizeText(firstName));
}

export function buildCandidatePayload(params: {
  messages: string[];
  intent: string;
  leadName?: string | null;
}): Record<string, unknown> {
  const responseText = params.messages.join("\n\n");
  return {
    messages: params.messages,
    intent: toCandidateIntent(params.intent),
    used_name: textUsesLeadName(responseText, params.leadName),
    used_title: textHasTitle(responseText),
    used_gendered_term: textHasGenderedTerm(responseText),
    claims: [],
    handoff_required: params.intent === "CALLBACK_REQUEST",
  };
}
