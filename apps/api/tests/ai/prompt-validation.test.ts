import { describe, it, expect, vi, beforeEach } from 'vitest';
import { replaceVariables, buildSystemPrompt } from '../../src/ai/prompt-builder.js';
import { ruleBasedIntent, classifyIntent } from '../../src/ai/classifier.js';
import { validateAIResponse, callAIWithGuardrails } from '../../src/ai/guardrails.js';
import { chooseVariation, executeScriptStep } from '../../src/ai/script-engine.js';
import { AIRouter } from '../../src/ai/router.js';
import { AIQuotaExceededError } from '../../src/ai/quota.js';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: loggerMock,
}));

// Mock dependencies
vi.mock('../../src/lib/prisma.js', () => {
  return {
    prisma: {
      conversation: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      scriptVariation: {
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock('../../src/ai/router.js', () => {
  return {
    AIRouter: {
      call: vi.fn(),
    },
  };
});

describe('=== Frente C: AI & Whatsapp - Technical Suite ===', () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 1: Prompt Builder Tests (5+ cases)
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Prompt Builder & Variable Substitutions', () => {
    it('should replace standard variables correctly', () => {
      const template = 'Olá {{NOME}}, vi que você trabalha como {{PROFISSAO}} em {{CIDADE}}. Podemos falar {{HORARIO_1}} ou {{HORARIO_2}}?';
      const replaced = replaceVariables(template, {
        leadName: 'Gisela',
        leadProfession: 'Advogada',
        leadCity: 'Santos',
        horario1: 'terça às 14h',
        horario2: 'quarta às 10h',
      });
      expect(replaced).toBe('Olá Gisela, vi que você trabalha como Advogada em Santos. Podemos falar terça às 14h ou quarta às 10h?');
    });

    it('should use default fallbacks for time variables if empty', () => {
      const template = 'Horário 1: {{HORARIO_1}}, Horário 2: {{HORARIO_2}}';
      const replaced = replaceVariables(template, {
        leadName: 'Bruno',
      });
      expect(replaced).toBe('Horário 1: amanhã às 10h, Horário 2: amanhã às 15h');
    });

    it('should handle missing fields elegantly by outputting empty string', () => {
      const template = 'Nome: {{NOME}} Profissao: {{PROFISSAO}} Cidade: {{CIDADE}}';
      const replaced = replaceVariables(template, {});
      expect(replaced).toBe('Nome:  Profissao:  Cidade: ');
    });

    it('should build a comprehensive system prompt containing tone and signatures', () => {
      const params = {
        user: { name: 'Giovanio', years_career: 10 },
        tenant: {
          id: 'tenant_1',
          name: 'Prospix Corretora',
          aiVoiceProfile: {
            tone_description: 'Tom formal e atencioso.',
            examples: ['Bom dia, tudo bem?', 'Estou à disposição.'],
            signature_phrases: ['Abraços, Giovanio.', 'Prospix Seguros.'],
          },
        },
        lead: {
          name: 'Roberto',
          profession: 'Engenheiro',
          address: { city: 'Campinas' },
          fit_score: 9,
        },
        conversation: {
          messages: [
            { sender: 'LEAD' as const, content: 'Olá', createdAt: new Date() },
          ],
        },
        script: { name: 'Script Geral', baseMessage: 'Olá Roberto' },
        currentNode: { id: 'node_1', type: 'message' },
      };

      const systemPrompt = buildSystemPrompt(params);
      expect(systemPrompt).toContain('assistente do corretor Giovanio');
      expect(systemPrompt).toContain('Tom formal e atencioso.');
      expect(systemPrompt).toContain('Abraços, Giovanio.');
      expect(systemPrompt).toContain('Roberto');
      expect(systemPrompt).toContain('Engenheiro');
      expect(systemPrompt).toContain('Campinas');
    });

    it('should fall back to default tone when aiVoiceProfile is missing', () => {
      const params = {
        user: { name: 'Giovanio' },
        tenant: { id: 'tenant_1', name: 'Prospix', aiVoiceProfile: null },
        lead: { name: 'Roberto', profession: 'Médico' },
        conversation: { messages: [] },
        script: { name: 'Script' },
        currentNode: { id: 'node_1', type: 'message' },
      };
      const systemPrompt = buildSystemPrompt(params);
      expect(systemPrompt).toContain('Tom amigável, profissional e direto ao ponto.');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 2: Classifier Tests (15+ cases)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Intent Classifier (Rule-based & AI-based)', () => {
    
    describe('Rule-based classifier patterns', () => {
      const cases: Array<{ input: string; expected: string }> = [
        { input: 'Quero SAIR da lista', expected: 'optout_request' },
        { input: 'por favor PARAR de enviar', expected: 'optout_request' },
        { input: 'quanto custa isso?', expected: 'price_objection' },
        { input: 'qual o valor da mensalidade?', expected: 'price_objection' },
        { input: 'muito caro', expected: 'price_objection' },
        { input: 'Já tenho Bradesco Saúde', expected: 'has_other_insurance' },
        { input: 'eu ja tenho seguro de vida porto seguro', expected: 'has_other_insurance' },
        { input: 'me liga no telefone', expected: 'asking_callback' },
        { input: 'pode fazer uma ligação?', expected: 'asking_callback' },
        { input: 'vamos remarcar para terça', expected: 'rescheduling' },
        { input: 'pode remarcar amanhã?', expected: 'rescheduling' },
        { input: 'quarta às 17h tá ótimo', expected: 'scheduling' },
        { input: 'marcar para sexta às 10h', expected: 'scheduling' },
        { input: 'Não tenho interesse', expected: 'not_interested' },
        { input: 'obrigado mas não quero', expected: 'not_interested' },
        { input: 'quero saber mais, me explica', expected: 'interested' },
        { input: 'como funciona isso?', expected: 'interested' },
        { input: 'olá bom dia', expected: 'off_topic' },
        { input: 'vai tomar no cu porra', expected: 'complaint' },
        { input: 'blablabla waka waka', expected: 'unclear' },
      ];

      cases.forEach(({ input, expected }) => {
        it(`should classify "${input}" as "${expected}" via ruleBasedIntent`, () => {
          expect(ruleBasedIntent(input)).toBe(expected);
        });
      });
    });

    describe('AI-based classifier execution', () => {
      it('should return optout_request instantly if core rule-based regex matches pre-AI', async () => {
        const result = await classifyIntent({
          tenantId: 'tenant_1',
          messageContent: 'parar',
        });
        expect(result.intent).toBe('optout_request');
        expect(result.confidence).toBe(1.0);
        expect(AIRouter.call).not.toHaveBeenCalled();
      });

      it('should downgrade intent to unclear if AI confidence is < 0.6', async () => {
        vi.mocked(AIRouter.call).mockResolvedValueOnce({
          content: '{"intent": "interested", "confidence": 0.45, "rationale": "Maybe interested"}',
          tokensInput: 10,
          tokensOutput: 10,
          costCents: 0.1,
          latencyMs: 100,
          model: 'gpt-4o',
          provider: 'openai',
        });

        const result = await classifyIntent({
          tenantId: 'tenant_1',
          messageContent: 'pode ser',
        });

        expect(result.intent).toBe('unclear');
        expect(result.confidence).toBe(0.45);
      });

      it('should fall back to ruleBasedIntent on AI Router failure exception', async () => {
        vi.mocked(AIRouter.call).mockRejectedValueOnce(new Error('API Timeout'));

        const result = await classifyIntent({
          tenantId: 'tenant_1',
          messageContent: 'quanto custa o plano?',
        });

        expect(result.intent).toBe('price_objection');
        expect(result.confidence).toBe(0.5);
        expect(result.rationale).toContain('API Timeout');
      });

      it('should fall back to ruleBasedIntent on JSON parsing error', async () => {
        vi.mocked(AIRouter.call).mockResolvedValueOnce({
          content: 'This is not JSON at all',
          tokensInput: 10,
          tokensOutput: 10,
          costCents: 0.1,
          latencyMs: 100,
          model: 'gpt-4o',
          provider: 'openai',
        });

        const result = await classifyIntent({
          tenantId: 'tenant_1',
          messageContent: 'não quero',
        });

        expect(result.intent).toBe('not_interested');
        expect(result.confidence).toBe(0.5);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 3: Guardrails Tests (10+ cases)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Guardrail Validations', () => {
    
    it('should fail on specific money mentions (R$ + digit)', () => {
      const result = validateAIResponse('O prêmio mensal é R$ 150 reais por mês.');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('mentions_specific_money');
    });

    it('should fail on specific money mentions (written reals)', () => {
      const result = validateAIResponse('Fica apenas 100 reais');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('mentions_specific_money');
    });

    it('should fail on promised coverage keywords', () => {
      const result = validateAIResponse('Isso é garantido que cobre qualquer doença grave.');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('promised_coverage');
    });

    it('should fail when message is too long (> 800 chars)', () => {
      const longMsg = 'A'.repeat(805);
      const result = validateAIResponse(longMsg);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('too_long');
    });

    it('should fail when message has too many lines (> 6 lines)', () => {
      const linesMsg = '1\n2\n3\n4\n5\n6\n7';
      const result = validateAIResponse(linesMsg);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('too_many_lines');
    });

    it('should fail on unauthorized external link', () => {
      const result = validateAIResponse('Veja nossa proposta em http://exemplo-seguros.com/proposta');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('unauthorized_link');
    });

    it('should allow authorized MetLife and Guilds links', () => {
      const result1 = validateAIResponse('Consulte em https://metlife.com/portal');
      const result2 = validateAIResponse('Consulte em http://guilds.com.br/assinatura');
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
    });

    it('should fail on spam language terms', () => {
      const result = validateAIResponse('Ganhe dinheiro indicando amigos para esta oferta exclusiva!');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('spam_language');
    });

    it('should fail on unsubstituted variables', () => {
      const result = validateAIResponse('Olá {{NOME}}, tudo bem?');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('unsubstituted_variable');
    });

    it('should pass on clean and standard responses within limits', () => {
      const result = validateAIResponse('Olá! Entendo seu ponto. Que tal marcarmos uma breve conversa de 15 minutos amanhã às 10h?');
      expect(result.ok).toBe(true);
    });

    it('should retry correction 1x on guardrail failure and pass on successful fix', async () => {
      // First call returns a bad message (contains money)
      vi.mocked(AIRouter.call)
        .mockResolvedValueOnce({
          content: '{"message_to_send": "Fica R$ 150 por mês", "intent_detected": "price_objection"}',
          tokensInput: 10,
          tokensOutput: 10,
          costCents: 0.1,
          latencyMs: 100,
          model: 'gpt-4o',
          provider: 'openai',
        })
        // Second retry call returns corrected message (no money)
        .mockResolvedValueOnce({
          content: '{"message_to_send": "O prêmio depende da cotação SUSEP. Vamos avaliar juntos?", "intent_detected": "price_objection"}',
          tokensInput: 15,
          tokensOutput: 15,
          costCents: 0.15,
          latencyMs: 120,
          model: 'gpt-4o',
          provider: 'openai',
        });

      const res = await callAIWithGuardrails({
        tenantId: 'tenant_1',
        messages: [{ role: 'system', content: 'system prompt' }],
      });

      expect(res.escalated).toBe(false);
      expect(res.message_to_send).toBe('O prêmio depende da cotação SUSEP. Vamos avaliar juntos?');
      expect(AIRouter.call).toHaveBeenCalledTimes(2);
    });

    it('should escalate to human if guardrail fails twice in a row', async () => {
      vi.mocked(AIRouter.call)
        .mockResolvedValueOnce({
          content: '{"message_to_send": "Fica R$ 150 por mês", "intent_detected": "price"}',
          tokensInput: 10,
          tokensOutput: 10,
          costCents: 0.1,
          latencyMs: 100,
          model: 'gpt-4o',
          provider: 'openai',
        })
        .mockResolvedValueOnce({
          content: '{"message_to_send": "Custa 200 reais apenas", "intent_detected": "price"}',
          tokensInput: 15,
          tokensOutput: 15,
          costCents: 0.15,
          latencyMs: 120,
          model: 'gpt-4o',
          provider: 'openai',
        });

      const res = await callAIWithGuardrails({
        tenantId: 'tenant_1',
        messages: [{ role: 'system', content: 'system' }],
      });

      expect(res.escalated).toBe(true);
      expect(res.escalatedReason).toBe('guardrail_failed_twice:mentions_specific_money');
    });

    it('should not log rejected AI response content when guardrails fail', async () => {
      const rejectedMessage = 'Fica R$ 150 por mês';
      vi.mocked(AIRouter.call)
        .mockResolvedValueOnce({
          content: `{"message_to_send": "${rejectedMessage}", "intent_detected": "price"}`,
          tokensInput: 10,
          tokensOutput: 10,
          costCents: 0.1,
          latencyMs: 100,
          model: 'gpt-4o',
          provider: 'openai',
        })
        .mockResolvedValueOnce({
          content: '{"message_to_send": "O premio depende da cotacao SUSEP.", "intent_detected": "price"}',
          tokensInput: 12,
          tokensOutput: 12,
          costCents: 0.12,
          latencyMs: 100,
          model: 'gpt-4o',
          provider: 'openai',
        });

      await callAIWithGuardrails({
        tenantId: 'tenant_1',
        messages: [{ role: 'system', content: 'system' }],
      });

      const warnPayloads = loggerMock.warn.mock.calls.map((call) => JSON.stringify(call[0]));
      expect(warnPayloads.some((payload) => payload.includes(rejectedMessage))).toBe(false);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'mentions_specific_money',
          outputLength: rejectedMessage.length,
        }),
        '🛡️ Guardrail validation failed'
      );
    });

    it('should escalate immediately without retry when AI quota is exceeded', async () => {
      vi.mocked(AIRouter.call).mockRejectedValueOnce(
        new AIQuotaExceededError('tenant_1', 5000, 1, 5000)
      );

      const res = await callAIWithGuardrails({
        tenantId: 'tenant_1',
        messages: [{ role: 'system', content: 'system' }],
      });

      expect(res.escalated).toBe(true);
      expect(res.escalatedReason).toBe('ai_quota_exceeded');
      expect(AIRouter.call).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PART 4: Script Engine Tests (5+ cases)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Script Engine & A/B Split Tests', () => {
    
    it('should sort A/B variation based on weights mathematically', () => {
      const variations = [
        { id: 'var_a', message: 'Message A', weight: 0.7 },
        { id: 'var_b', message: 'Message B', weight: 0.3 },
      ];

      // Spy on Math.random to return 0.5 (should trigger A)
      const spyRandom = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const chosen1 = chooseVariation(variations);
      expect(chosen1?.id).toBe('var_a');

      // Spy on Math.random to return 0.85 (should trigger B)
      spyRandom.mockReturnValue(0.85);
      const chosen2 = chooseVariation(variations);
      expect(chosen2?.id).toBe('var_b');

      spyRandom.mockRestore();
    });

    it('should fallback to first variant if total weights is 0', () => {
      const variations = [
        { id: 'var_a', message: 'A', weight: 0.0 },
        { id: 'var_b', message: 'B', weight: 0.0 },
      ];
      const chosen = chooseVariation(variations);
      expect(chosen?.id).toBe('var_a');
    });

    it('should return null when choosing from empty array', () => {
      expect(chooseVariation([])).toBeNull();
    });

    it('should execute script step transitions accurately based on intent', async () => {
      const mockFlow = {
        nodes: [
          { id: 'node_trigger', type: 'trigger', data: { nextNodeId: 'node_decision' } },
          {
            id: 'node_decision',
            type: 'decision',
            data: {
              routes: {
                interested: 'node_msg_success',
                not_interested: 'node_msg_failed',
                default: 'node_fallback',
              },
            },
          },
          { id: 'node_msg_success', type: 'message', data: { text: 'Que ótimo!', nextNodeId: 'node_end' } },
          { id: 'node_msg_failed', type: 'message', data: { text: 'Uma pena.', nextNodeId: 'node_end' } },
          { id: 'node_end', type: 'end', data: {} },
        ],
      };

      const { prisma } = await import('../../src/lib/prisma.js');
      vi.mocked(prisma.conversation.findUnique).mockResolvedValueOnce({
        id: 'conv_123',
        tenantId: 'tenant_1',
        scriptId: 'script_123',
        currentNodeId: 'node_trigger',
        script: {
          id: 'script_123',
          name: 'Script Test',
          flow: mockFlow,
          baseMessage: 'Base',
        },
      } as any);

      vi.mocked(prisma.scriptVariation.findMany).mockResolvedValueOnce([]); // no dynamic database variations

      const result = await executeScriptStep({
        tenantId: 'tenant_1',
        conversationId: 'conv_123',
        intent: 'interested',
      });

      expect(result.nextNodeId).toBe('node_end');
      expect(result.messageToSend).toBe('Que ótimo!');
      expect(result.completed).toBe(false);

      // Verify conversation updated to the correct state
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv_123' },
        data: { currentNodeId: 'node_end' },
      });
    });

    it('should handle action nodes in script transition loop correctly', async () => {
      const mockFlow = {
        nodes: [
          { id: 'node_trigger', type: 'trigger', data: { nextNodeId: 'node_act' } },
          { id: 'node_act', type: 'action', data: { actionType: 'send_pdf', nextNodeId: 'node_msg' } },
          { id: 'node_msg', type: 'message', data: { text: 'PDF enviado!', nextNodeId: 'node_end' } },
          { id: 'node_end', type: 'end', data: {} },
        ],
      };

      const { prisma } = await import('../../src/lib/prisma.js');
      vi.mocked(prisma.conversation.findUnique).mockResolvedValueOnce({
        id: 'conv_123',
        tenantId: 'tenant_1',
        scriptId: 'script_123',
        currentNodeId: 'node_trigger',
        script: {
          id: 'script_123',
          name: 'Script Action Test',
          flow: mockFlow,
        },
      } as any);

      vi.mocked(prisma.scriptVariation.findMany).mockResolvedValueOnce([]);

      const result = await executeScriptStep({
        tenantId: 'tenant_1',
        conversationId: 'conv_123',
      });

      expect(result.actionToExecute).toBe('send_pdf');
      expect(result.messageToSend).toBe('PDF enviado!');
      expect(result.nextNodeId).toBe('node_end');
    });
  });
});
