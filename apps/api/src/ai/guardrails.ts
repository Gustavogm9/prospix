import { AIRouter } from './router.js';
import { logger } from '../lib/logger.js';
import { AIQuotaExceededError } from './quota.js';

export type GuardrailFailureReason =
  | 'mentions_specific_money'
  | 'promised_coverage'
  | 'too_long'
  | 'too_many_lines'
  | 'unauthorized_link'
  | 'spam_language'
  | 'unsubstituted_variable';

export interface GuardrailResult {
  ok: boolean;
  reason?: GuardrailFailureReason;
}

export const GUARDRAILS = [
  // Guardrail 1: Sem valores financeiros específicos
  (msg: string): GuardrailResult => {
    const hasMoneyPattern = /R\$\s*\d|reais|mensalidade de \d|premio.*\d/i.test(msg);
    if (hasMoneyPattern) {
      return { ok: false, reason: 'mentions_specific_money' };
    }
    return { ok: true };
  },

  // Guardrail 2: Sem promessa de cobertura
  (msg: string): GuardrailResult => {
    if (/garantido|sem dúvida cobre|com certeza cobre|aprovado/i.test(msg)) {
      return { ok: false, reason: 'promised_coverage' };
    }
    return { ok: true };
  },

  // Guardrail 3: Tamanho máximo e número de linhas
  (msg: string): GuardrailResult => {
    if (msg.length > 800) {
      return { ok: false, reason: 'too_long' };
    }
    const lines = msg.split('\n').length;
    if (lines > 6) {
      return { ok: false, reason: 'too_many_lines' };
    }
    return { ok: true };
  },

  // Guardrail 4: Sem links externos não-MetLife
  (msg: string): GuardrailResult => {
    const urls = msg.match(/https?:\/\/\S+/g) || [];
    const invalid = urls.filter(
      (u) => !u.includes('metlife.com') && !u.includes('guilds.com.br')
    );
    if (invalid.length > 0) {
      return { ok: false, reason: 'unauthorized_link' };
    }
    return { ok: true };
  },

  // Guardrail 5: Linguagem proibida
  (msg: string): GuardrailResult => {
    const blocked = ['ganhe dinheiro', 'urgente', 'última chance', 'oferta exclusiva', 'desconto'];
    if (blocked.some((w) => msg.toLowerCase().includes(w))) {
      return { ok: false, reason: 'spam_language' };
    }
    return { ok: true };
  },

  // Guardrail 6: Variáveis não substituídas
  (msg: string): GuardrailResult => {
    if (/\{\{|\}\}/.test(msg)) {
      return { ok: false, reason: 'unsubstituted_variable' };
    }
    return { ok: true };
  },
];

export function validateAIResponse(msg: string): GuardrailResult {
  for (const guard of GUARDRAILS) {
    const result = guard(msg);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

export interface ExecSystemAIResult {
  intent_detected?: string;
  tool_calls?: any[];
  message_to_send: string;
  should_transition_to?: string;
  escalated: boolean;
  escalatedReason?: string;
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
  latencyMs: number;
  llmModel: string;
}

export async function callAIWithGuardrails(params: {
  tenantId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
}): Promise<ExecSystemAIResult> {
  const { tenantId, messages, temperature, maxTokens } = params;

  let attempt = 1;
  const activeMessages = [...messages];

  let cumulativeTokensInput = 0;
  let cumulativeTokensOutput = 0;
  let cumulativeCostCents = 0;
  let cumulativeLatencyMs = 0;
  let finalModel = '';

  while (attempt <= 2) {
    try {
      logger.info({ tenantId, attempt }, '🤖 Calling System AI with Guardrails active');
      
      const response = await AIRouter.call({
        tenantId,
        useCase: 'system',
        messages: activeMessages,
        temperature,
        maxTokens,
        responseFormat: 'json',
      });

      cumulativeTokensInput += response.tokensInput;
      cumulativeTokensOutput += response.tokensOutput;
      cumulativeCostCents += response.costCents;
      cumulativeLatencyMs += response.latencyMs;
      finalModel = response.model;

      let parsed: any;
      try {
        const cleaned = response.content.replace(/```json|```/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error('AI response is not valid JSON');
      }

      const msgToSend = parsed.message_to_send || '';
      
      // Perform Guardrail validations
      const guardResult = validateAIResponse(msgToSend);

      if (guardResult.ok) {
        logger.info({ tenantId, attempt }, '🛡️ Guardrails passed successfully');
        return {
          intent_detected: parsed.intent_detected,
          tool_calls: parsed.tool_calls || [],
          message_to_send: msgToSend,
          should_transition_to: parsed.should_transition_to,
          escalated: false,
          tokensInput: cumulativeTokensInput,
          tokensOutput: cumulativeTokensOutput,
          costCents: cumulativeCostCents,
          latencyMs: cumulativeLatencyMs,
          llmModel: finalModel,
        };
      }

      // Guardrail failed
      logger.warn(
        { tenantId, attempt, reason: guardResult.reason, outputLength: msgToSend.length },
        '🛡️ Guardrail validation failed'
      );

      if (attempt === 1) {
        // Corrective retry
        logger.info({ tenantId }, '🔄 Retrying AI with corrective feedback prompt');
        activeMessages.push({ role: 'assistant', content: response.content });
        activeMessages.push({
          role: 'user',
          content: `Sua resposta anterior foi rejeitada pelo sistema de segurança do Prospix devido à seguinte infração de guardrail: "${guardResult.reason}".
Por favor, gere uma nova resposta JSON em conformidade total com todas as Regras Absolutas, corrigindo esse problema e sem cometer nenhuma infração.`,
        });
        attempt++;
      } else {
        // Second attempt failed -> Escalate to human
        logger.error({ tenantId }, '❌ Second AI attempt also failed guardrail validations. Escalating to human...');
        return {
          message_to_send: 'Desculpe, vou pedir para o corretor responsável entrar em contato direto com você para esclarecermos todos os detalhes da melhor forma!',
          escalated: true,
          escalatedReason: `guardrail_failed_twice:${guardResult.reason}`,
          tokensInput: cumulativeTokensInput,
          tokensOutput: cumulativeTokensOutput,
          costCents: cumulativeCostCents,
          latencyMs: cumulativeLatencyMs,
          llmModel: finalModel,
        };
      }
    } catch (err: any) {
      if (err instanceof AIQuotaExceededError) {
        logger.warn(
          {
            tenantId,
            currentCostCents: err.currentCostCents,
            estimatedCostCents: err.estimatedCostCents,
            limitCents: err.limitCents,
          },
          'AI quota exceeded before provider call'
        );

        return {
          message_to_send: '',
          escalated: true,
          escalatedReason: 'ai_quota_exceeded',
          tokensInput: cumulativeTokensInput,
          tokensOutput: cumulativeTokensOutput,
          costCents: cumulativeCostCents,
          latencyMs: cumulativeLatencyMs,
          llmModel: finalModel,
        };
      }

      logger.error({ err: err.message, tenantId, attempt }, '❌ Exception in callAIWithGuardrails');
      if (attempt === 1) {
        attempt++;
      } else {
        return {
          message_to_send: 'Desculpe pela demora. Um corretor já vai falar com você!',
          escalated: true,
          escalatedReason: 'ai_exception_during_guardrails',
          tokensInput: cumulativeTokensInput,
          tokensOutput: cumulativeTokensOutput,
          costCents: cumulativeCostCents,
          latencyMs: cumulativeLatencyMs,
          llmModel: finalModel,
        };
      }
    }
  }

  return {
    message_to_send: 'Desculpe a demora, logo te respondo por aqui!',
    escalated: true,
    escalatedReason: 'guardrail_fallback_unknown',
    tokensInput: cumulativeTokensInput,
    tokensOutput: cumulativeTokensOutput,
    costCents: cumulativeCostCents,
    latencyMs: cumulativeLatencyMs,
    llmModel: finalModel,
  };
}
