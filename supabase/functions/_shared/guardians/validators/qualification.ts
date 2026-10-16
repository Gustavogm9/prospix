import type { EffectiveGuardian, GuardianRunContext, GuardianValidationResult } from '../types.ts';
import { GuardianReasonCodes } from '../reason-codes.ts';
import { redactGuardianText, toLoggableText } from '../evidence.ts';

function outputText(context: GuardianRunContext): string {
  if (typeof context.output === 'string') return context.output;
  const output = context.output as Record<string, unknown> | undefined;
  const messages = Array.isArray(output?.messages) ? output.messages : [];
  return messages.map((message) => {
    if (typeof message === 'string') return message;
    if (message && typeof message === 'object') return String((message as Record<string, unknown>).text || '');
    return '';
  }).filter(Boolean).join('\n');
}

function containsMeetingInvite(text: string): boolean {
  const directInvite = /\b(?:quer|gostaria|podemos|posso|vamos|topa|prefere|consegue|pode)\s+(?:(?:que|de)\s+)?(?:agend(?:ar|armos)|marc(?:ar|armos)|combin(?:ar|armos))\b/i;
  const schedulingAction = /\b(?:agend(?:ar|amos|e)|marc(?:ar|amos|o)|combin(?:ar|amos))\s+(?:(?:uma|um|a|o)\s+)?(?:reuni[aã]o|liga[cç][aã]o|conversa|papo|hor[aá]rio)\b/i;
  const timedConversation = /\b(?:reuni[aã]o|liga[cç][aã]o|conversa|papo)\s+(?:r[aá]pid[oa]\s+)?de\s+\d+\s*min(?:uto)?s?\b/i;
  const schedulingChoice = /\b(?:qual|que)\s+(?:dia|hor[aá]rio)\s+(?:funciona|prefere|fica\s+melhor|seria\s+melhor)\b/i;

  return [directInvite, schedulingAction, timedConversation, schedulingChoice].some((pattern) => pattern.test(text));
}

export function validateQualification(
  _guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const text = outputText(context);
  const questionCount = (text.match(/\?/g) || []).length;
  const status = String(context.facts?.qualification_status || 'IN_PROGRESS');
  const userRequestedHuman = context.facts?.user_requested_human === true;
  const agendaInvite = containsMeetingInvite(text);
  const healthDataQuestion = /\b(peso|altura|imc|doen[cç]a|diagn[oó]stico|tabag|fumante|hist[oó]rico familiar|medicamento|cirurgia)\b/i.test(text);
  const reasons: string[] = [];
  if (questionCount > 1) reasons.push('question_stack');
  if (agendaInvite && status !== 'QUALIFIED' && !userRequestedHuman) reasons.push('premature_agenda');
  if (healthDataQuestion) reasons.push('health_data_in_initial_qualification');

  if (reasons.length > 0) {
    return {
      decision: 'BLOCK',
      reason_code: GuardianReasonCodes.G09_QUALIFICATION_BLOCKED,
      confidence: 0.97,
      evidence: {
        reasons,
        question_count: questionCount,
        qualification_status: status,
        user_requested_human: userRequestedHuman,
        output_preview_redacted: redactGuardianText(text || toLoggableText(context.output), 240),
      },
    };
  }

  return {
    decision: 'PASS',
    reason_code: GuardianReasonCodes.G09_QUALIFICATION_PASS,
    confidence: 0.98,
    evidence: { question_count: questionCount, qualification_status: status },
  };
}
