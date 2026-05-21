import { AIRouter } from './router.js';
import { logger } from '../lib/logger.js';

export type IntentCategory =
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

export interface ClassificationResult {
  intent: IntentCategory;
  confidence: number;
  rationale: string;
}

export function ruleBasedIntent(message: string): IntentCategory {
  const lower = message.toLowerCase().trim();
  
  if (/\b(sair|parar|não quero mais|descadastr|stop|me tira|deletar|excluir)\b/i.test(lower)) {
    return 'optout_request';
  }
  if (/\b(quanto custa|preço|valor|caro|mensalidade|custa|valores|orçamento)\b/i.test(lower)) {
    return 'price_objection';
  }
  if (/\b(já tenho|tenho seguro|tenho plano|bradesco|porto seguro|sulamerica|allianz|liberty|tokio|segurado)\b/i.test(lower)) {
    return 'has_other_insurance';
  }
  if (/\b(liga|me liga|me ligue|telefone|me chama no tel|ligação|pode ligar)\b/i.test(lower)) {
    return 'asking_callback';
  }
  if (/\b(vamos remarcar|remarcar|remarca|remarque|outro dia|outra hora|remarcação|remarcacao)\b/i.test(lower) || lower.includes('remarcar') || lower.includes('remarque')) {
    return 'rescheduling';
  }
  if (/\b(às \d+|hora|quarta|quinta|amanhã|segunda|terça|sexta|sábado|sabado|dia \d+|marcar|agendar)\b/i.test(lower) || lower.includes('amanhã') || lower.includes('amanha')) {
    return 'scheduling';
  }
  if (/\b(não tenho interesse|nao quero|não quero|obrigado mas não|obrigada mas nao|valeu mas nao)\b/i.test(lower)) {
    return 'not_interested';
  }
  if (/\b(quero saber mais|explica|como funciona|tenho interesse|me explica|manda mais info|gostaria de saber)\b/i.test(lower)) {
    return 'interested';
  }
  if (/\b(bom dia|boa tarde|boa noite|olá|oi|tudo bem)\b/i.test(lower)) {
    return 'off_topic';
  }
  if (/\b(merda|porra|caralho|bosta|ruim|enganador|fake|fraude|palhaçada|processar)\b/i.test(lower)) {
    return 'complaint';
  }

  return 'unclear';
}

export async function classifyIntent(params: {
  tenantId: string;
  messageContent: string;
  conversationHistory?: Array<{ sender: 'AI' | 'USER' | 'LEAD'; content: string }>;
}): Promise<ClassificationResult> {
  const { tenantId, messageContent, conversationHistory = [] } = params;

  // Rule-based check for hard opt-out patterns to be absolutely bulletproof
  const isRuleOptout = /\b(sair|parar|não quero mais|descadastre|stop)\b/i.test(messageContent.toLowerCase().trim());
  if (isRuleOptout) {
    logger.info({ tenantId, messageContent }, '🛡️ Core rule-based opt-out pattern detected instantly');
    return {
      intent: 'optout_request',
      confidence: 1.0,
      rationale: 'Core rule-based regex matched opt-out keyword.',
    };
  }

  const systemMessage = `Você é um classificador de intenção de mensagens de leads em conversa com corretor de seguros.
Você deve receber a última mensagem do lead e analisar com base no contexto da conversa se aplicável.
Responda APENAS com um objeto JSON válido, sem markdown: {"intent": "<categoria>", "confidence": 0.0-1.0, "rationale": "..."}.

Categorias possíveis:
- interested: "quero saber mais", "explica", demonstrando interesse genuíno
- has_other_insurance: "já tenho Bradesco", "tenho seguro de vida", já possui apólice
- price_objection: "tá caro", "quanto custa", "qual o valor"
- no_time_now: "agora não posso", "te chamo depois", ocupado
- asking_callback: "pode me ligar", pedido de telefonema ou contato por voz
- scheduling: "quarta às 17h tá bom", aceitando ou sugerindo data/hora de reunião
- rescheduling: "vamos remarcar", alterando agendamento anterior
- not_interested: "não tenho interesse", "obrigado mas não", rejeição educada ou direta
- optout_request: "SAIR", "PARAR", "não quero receber mensagens", descadastro
- off_topic: saudações ("bom dia"), dúvidas genéricas não relacionadas a seguros, conversa fiada
- complaint: reclamações, xingamentos, ameaças
- unclear: mensagem confusa, ambígua ou que não se encaixa nas anteriores

Regras Absolutas:
1. Se a mensagem contém palavras explícitas de opt-out (SAIR, PARAR, NÃO QUERO, STOP, NÃO RECEBER, DESCADASTRE), sempre classifique como intent = "optout_request".
2. Se a sua confiança na classificação for menor que 0.6, retorne intent = "unclear".
3. Em casos de ameaças, xingamentos ou agressões verbais, classifique como intent = "complaint".
4. NÃO inclua explicações de texto fora do JSON.`;

  // Build messages array
  const formattedHistory = conversationHistory
    .slice(-5) // Take last 5 messages for brief context
    .map((msg) => `${msg.sender}: ${msg.content}`)
    .join('\n');

  const userContent = `Histórico recente da conversa:\n${formattedHistory || 'Nenhuma mensagem anterior.'}\n\nÚltima mensagem do Lead para classificar:\n"${messageContent}"`;

  try {
    const aiResult = await AIRouter.call({
      tenantId,
      useCase: 'classifier',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userContent },
      ],
      temperature: 0.0,
      responseFormat: 'json',
    });

    let classification: any;
    try {
      // Strip markdown code block wrappers if any
      const cleanedContent = aiResult.content.replace(/```json|```/g, '').trim();
      classification = JSON.parse(cleanedContent);
    } catch (parseErr) {
      logger.warn({ err: parseErr, content: aiResult.content }, '⚠️ Failed to parse classifier JSON output, using rule-based fallback');
      const fallback = ruleBasedIntent(messageContent);
      return {
        intent: fallback,
        confidence: 0.5,
        rationale: `AI JSON parsing failed. AI output was: ${aiResult.content}. Used rule-based fallback.`,
      };
    }

    const resolvedIntent = (classification.intent || 'unclear') as IntentCategory;
    const resolvedConfidence = typeof classification.confidence === 'number' ? classification.confidence : 0.5;

    // Apply rule: if confidence < 0.6, intent must be unclear
    if (resolvedConfidence < 0.6) {
      logger.info({ resolvedIntent, resolvedConfidence }, '🤖 Confidence below 0.6, downgraded intent to unclear');
      return {
        intent: 'unclear',
        confidence: resolvedConfidence,
        rationale: classification.rationale || 'Confidence below threshold.',
      };
    }

    return {
      intent: resolvedIntent,
      confidence: resolvedConfidence,
      rationale: classification.rationale || 'AI classified.',
    };
  } catch (err: any) {
    logger.error({ err: err.message }, '❌ Exception in classifyIntent, using rule-based fallback');
    const fallback = ruleBasedIntent(messageContent);
    return {
      intent: fallback,
      confidence: 0.5,
      rationale: `AI Router failed: ${err.message}. Used rule-based fallback.`,
    };
  }
}
