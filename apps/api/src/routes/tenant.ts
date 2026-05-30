import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { createTenantQueue } from '../lib/queue.js';
import { createSendWhatsappJobId } from '../workers/send-whatsapp-job.js';
import { z } from 'zod';
import { ConversationStatus, LeadStatus, MessageDirection, MessageSender, MessageDeliveryStatus, ScriptCategory, ScriptStatus } from '@prisma/client';
import { AIRouter } from '../ai/router.js';

// M-4 · Reusable Zod schema for UUID :id route params
const idParamSchema = z.object({ id: z.string().uuid('Invalid ID format — expected UUID') });

export const tenantRoutes: FastifyPluginAsync = async (app) => {

  // Middleware to ensure user is authenticated and tenant context is set
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }
  });

  // ── 1. GET /v1/tenant/profile ───────────────────────────────────────────────
  app.get('/profile', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'User context is required' });
    }

    const user = await prisma.user.findFirst({
      where: {
        id: req.userId,
        tenantId: req.tenantId!,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        susep: true,
        role: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ error: 'Not Found', message: 'User not found' });
    }

    return reply.send({ data: user });
  });

  // ── 2. PATCH /v1/tenant/profile ─────────────────────────────────────────────
  const updateProfileSchema = z.object({
    name: z.string().trim().min(2).max(255).optional(),
    email: z.string().trim().email().max(255).optional(),
    susep: z.string().trim().max(64).nullable().optional(),
  });

  app.patch('/profile', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'User context is required' });
    }

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    const user = await prisma.user.findFirst({
      where: {
        id: req.userId,
        tenantId: req.tenantId!,
        deletedAt: null,
      },
    });

    if (!user) {
      return reply.code(404).send({ error: 'Not Found', message: 'User not found' });
    }

    if (parsed.data.email && parsed.data.email !== user.email) {
      const emailOwner = await prisma.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true },
      });

      if (emailOwner && emailOwner.id !== user.id) {
        return reply.code(409).send({ error: 'Conflict', message: 'Email is already in use' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        susep: parsed.data.susep === undefined ? undefined : parsed.data.susep || null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        susep: true,
        role: true,
      },
    });

    logger.info({ tenantId: req.tenantId, userId: req.userId }, 'Tenant user profile updated');
    return reply.send({ data: updated });
  });

  // ── 3. GET /v1/tenant/conversations ─────────────────────────────────────────
  const listConversationsSchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
  });

  app.get('/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listConversationsSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    const { limit, cursor } = parsed.data;

    try {
      const list = await prisma.conversation.findMany({
        take: limit + 1,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        where: { tenantId: req.tenantId! },
        include: { lead: { include: { healthProfile: true } } },
        orderBy: { lastMessageAt: 'desc' },
      });

      let nextCursor: string | null = null;
      if (list.length > limit) {
        const nextItem = list.pop();
        nextCursor = nextItem!.id;
      }

      return reply.code(200).send({ data: list, nextCursor });
    } catch (err) {
      req.log.error({ err }, 'Failed to list conversations');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch conversations.' });
    }
  });

  // ── 4. POST /v1/tenant/conversations ────────────────────────────────────────
  const createConversationSchema = z.object({
    leadId: z.string().uuid('Invalid lead ID format'),
  });

  app.post('/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = createConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    const tenantId = req.tenantId!;
    const { leadId } = parsed.data;

    try {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, tenantId, deletedAt: null },
      });

      if (!lead) {
        return reply.code(404).send({ error: 'Not Found', message: 'Lead not found' });
      }

      const existing = await prisma.conversation.findFirst({
        where: {
          tenantId,
          leadId,
          status: { in: [ConversationStatus.ACTIVE, ConversationStatus.PAUSED, ConversationStatus.ESCALATED] },
        },
        include: { lead: true },
        orderBy: { startedAt: 'desc' },
      });

      if (existing) {
        return reply.code(200).send(existing);
      }

      const conversation = await prisma.$transaction(async (tx) => {
        const created = await tx.conversation.create({
          data: {
            tenantId,
            leadId,
            status: ConversationStatus.PAUSED,
            aiHandling: false,
          },
          include: { lead: true },
        });

        if (lead.status === LeadStatus.CAPTURED) {
          await tx.lead.update({
            where: { id: leadId },
            data: {
              status: LeadStatus.CONTACTED,
              contactedAt: new Date(),
            },
          });
        }

        await tx.leadEvent.create({
          data: {
            tenantId,
            leadId,
            eventType: 'conversation_started',
            actorId: req.userId || undefined,
            payload: {
              conversation_id: created.id,
              source: 'manual',
            },
          },
        });

        return created;
      });

      logger.info({ conversationId: conversation.id, leadId }, '💬 Manual conversation created');
      return reply.code(201).send(conversation);
    } catch (err) {
      req.log.error({ err }, 'Failed to create conversation');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to create conversation.' });
    }
  });

  // ── 5. GET /v1/tenant/conversations/:id/messages ────────────────────────────
  const listMessagesSchema = z.object({
    limit: z.coerce.number().min(1).max(200).default(100),
    cursor: z.string().uuid().optional(),
  });

  app.get('/conversations/:id/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }
    const { id } = paramsParsed.data;

    const queryParsed = listMessagesSchema.safeParse(req.query);
    if (!queryParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: queryParsed.error.errors[0]?.message });
    }
    const { limit, cursor } = queryParsed.data;

    try {
      const list = await prisma.message.findMany({
        take: limit + 1,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        where: { tenantId: req.tenantId!, conversationId: id },
        orderBy: { createdAt: 'asc' },
      });

      let nextCursor: string | null = null;
      if (list.length > limit) {
        const nextItem = list.pop();
        nextCursor = nextItem!.id;
      }

      return reply.code(200).send({ data: list, nextCursor });
    } catch (err) {
      req.log.error({ err, conversationId: id }, 'Failed to list messages');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch messages.' });
    }
  });

  // ── 6. POST /v1/tenant/conversations/:id/messages ───────────────────────────
  const sendMsgSchema = z.object({
    content: z.string().min(1, 'Message content cannot be empty'),
  });

  app.post('/conversations/:id/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }
    const { id } = paramsParsed.data;
    
    const parsed = sendMsgSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    try {
      // Load conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id },
      });

      if (!conversation || conversation.tenantId !== req.tenantId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Conversation not found' });
      }

      // Estrita: "só se aiHandling = false"
      if (conversation.aiHandling) {
        return reply.code(400).send({
          error: 'AI_HANDLING_ACTIVE',
          message: 'Cannot send manual messages while AI is actively handling the conversation. Turn off AI handling first.',
        });
      }

      // Save message to database as USER outbound
      const newMsg = await prisma.message.create({
        data: {
          tenantId: req.tenantId!,
          conversationId: id,
          direction: MessageDirection.OUTBOUND,
          sender: MessageSender.USER,
          content: parsed.data.content,
          deliveryStatus: MessageDeliveryStatus.QUEUED,
        },
      });

      // Enqueue sending
      const sendQueue = createTenantQueue(req.tenantId!, 'send-messages');
      await sendQueue.add('send-whatsapp', {
        tenant_id: req.tenantId!,
        conversation_id: id,
        message_id: newMsg.id,
      }, {
        jobId: createSendWhatsappJobId(req.tenantId!, newMsg.id),
      });

      return reply.code(201).send(newMsg);
    } catch (err) {
      req.log.error({ err, conversationId: id }, 'Failed to send message');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to send message.' });
    }
  });

  // ── 7. PATCH /v1/tenant/conversations/:id ───────────────────────────────────
  const updateConvSchema = z.object({
    aiHandling: z.boolean(),
  });

  app.patch('/conversations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }
    const { id } = paramsParsed.data;
    
    const parsed = updateConvSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id },
      });

      if (!conversation || conversation.tenantId !== req.tenantId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Conversation not found' });
      }

      const { aiHandling } = parsed.data;
      const status = aiHandling ? ConversationStatus.ACTIVE : ConversationStatus.PAUSED;

      const updated = await prisma.conversation.update({
        where: { id },
        data: {
          aiHandling,
          status,
        },
      });

      logger.info({ conversationId: id, aiHandling, status }, '🔄 Conversation handling updated');
      return reply.code(200).send(updated);
    } catch (err) {
      req.log.error({ err, conversationId: id }, 'Failed to update conversation');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to update conversation.' });
    }
  });

  // ── 8. GET /v1/tenant/scripts ───────────────────────────────────────────────
  app.get('/scripts', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const list = await prisma.script.findMany({
        where: { tenantId: req.tenantId!, archivedAt: null },
        include: { variations: true },
      });
      return reply.code(200).send(list);
    } catch (err) {
      req.log.error({ err }, 'Failed to list scripts');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch scripts.' });
    }
  });

  // ── 9. POST /v1/tenant/scripts ──────────────────────────────────────────────
  const createScriptSchema = z.object({
    name: z.string().min(1).optional(),
    baseMessage: z.string().min(1),
    variations: z.array(z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      weight: z.number().min(0).max(100).optional(),
      content: z.string().min(1),
    })).default([]),
  });

  app.post('/scripts', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = createScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    try {
      const { name, baseMessage, variations } = parsed.data;
      const script = await prisma.script.create({
        data: {
          tenantId: req.tenantId!,
          name: name ?? 'Roteiro principal',
          category: ScriptCategory.APPROACH,
          baseMessage,
          variables: ['Nome', 'Empresa', 'Cidade'],
          flow: { variations },
          status: ScriptStatus.ACTIVE,
        },
      });

      logger.info({ scriptId: script.id }, '📋 Script created successfully');
      return reply.code(201).send(script);
    } catch (err) {
      req.log.error({ err }, 'Failed to create script');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to create script.' });
    }
  });

  // ── 10. POST /v1/tenant/scripts/simulate ───────────────────────────────────
  const simulateScriptSchema = z.object({
    input: z.string().min(1),
    baseMessage: z.string().min(1),
    variations: z.array(z.object({
      name: z.string().optional(),
      weight: z.number().min(0).max(100).optional(),
      content: z.string().min(1),
    })).default([]),
  });

  app.post('/scripts/simulate', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = simulateScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    const { input, baseMessage, variations } = parsed.data;
    const selectedVariation = variations
      .slice()
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];

    const selectedMessage = selectedVariation?.content ?? baseMessage;

    return reply.code(200).send({
      reply: `Simulacao auditavel: diante de "${input}", a IA responderia usando a abordagem "${selectedMessage}".`,
      variantUsed: selectedVariation?.name ?? 'Abordagem base',
    });
  });

  // ── 10.5. POST /v1/tenant/scripts/generate ─────────────────────────────────
  const generateScriptSchema = z.object({
    niche: z.enum(['DOCTOR', 'LAWYER', 'BUSINESS_OWNER', 'OTHER']),
    customNiche: z.string().optional().nullable(),
    product: z.enum(['DIT', 'KEYMAN', 'PATRIMONY_SUCCESSION', 'HEALTH_INSURANCE', 'OTHER']),
    customProduct: z.string().optional().nullable(),
    tone: z.enum(['CONSULTATIVE', 'FORMAL', 'DIRECT']).default('CONSULTATIVE'),
  });

  app.post('/scripts/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = generateScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    const { niche, customNiche, product, customProduct, tone } = parsed.data;

    // Resolve texts
    let nicheText = '';
    switch (niche) {
      case 'DOCTOR': nicheText = 'Médicos, Dentistas, Cirurgiões e Profissionais da Saúde'; break;
      case 'LAWYER': nicheText = 'Advogados, Sócios de Escritórios e Profissionais Jurídicos'; break;
      case 'BUSINESS_OWNER': nicheText = 'Empresários, Sócios de PMEs e Proprietários de Empresas'; break;
      case 'OTHER': nicheText = customNiche || 'Profissionais liberais e autônomos'; break;
    }

    let productText = '';
    switch (product) {
      case 'DIT': productText = 'Diária de Incapacidade Temporária (DIT) - Proteção de renda contra acidentes e afastamento médico temporário.'; break;
      case 'KEYMAN': productText = 'Seguro Homem-Chave (Keyman) e Planejamento de Sucessão de Cotas Societárias para blindar a continuidade da empresa.'; break;
      case 'PATRIMONY_SUCCESSION': productText = 'Blindagem e Sucessão Patrimonial isenta de ITCMD para dar liquidez imediata aos herdeiros sem travar bens.'; break;
      case 'HEALTH_INSURANCE': productText = 'Seguro Saúde Corporativo PME com excelente rede credenciada e otimização de custos.'; break;
      case 'OTHER': productText = customProduct || 'Proteção de renda e benefícios corporativos.'; break;
    }

    let toneText = 'Consultivo, humano, amigável e focado em gerar relacionamento';
    if (tone === 'FORMAL') toneText = 'Formal, corporativo, sério e de extrema credibilidade';
    if (tone === 'DIRECT') toneText = 'Direto ao ponto, pragmático, objetivo e focado em otimização de tempo';

    // Resolve strategies
    let strategyText = 'Criar uma abordagem que desperte curiosidade genuína. Perguntar sobre um desafio comum no dia a dia da profissão do lead, sem forçar vendas ou parecer um robô panfleteiro. Fazer perguntas curtas e amigáveis.';
    if (niche === 'DOCTOR' && product === 'DIT') {
      strategyText = 'Focar na dependência física do trabalho para o faturamento (lesão por esforço, quebrar um braço ou perna). Questionar educadamente como fica a estabilidade financeira do consultório em caso de afastamento de 15 ou 30 dias.';
    } else if (niche === 'LAWYER' && product === 'PATRIMONY_SUCCESSION') {
      strategyText = 'Conectar com a prática comum deles de assessorar clientes em proteção patrimonial. Mostrar como seguros estruturados garantem liquidez imediata livre de ITCMD, blindando a família da burocracia de inventários.';
    } else if (niche === 'BUSINESS_OWNER' && product === 'KEYMAN') {
      strategyText = 'Focar na segurança da empresa. Questionar se a empresa possui caixa imediato para pagar a cota de herdeiros caso um sócio venha a faltar, evitando a entrada de pessoas de fora no negócio ou a descapitalização brusca.';
    }

    // Call AIRouter
    try {
      const result = await AIRouter.call({
        tenantId: req.tenantId!,
        useCase: 'system',
        messages: [
          {
            role: 'system',
            content: `Você é o copywriter e especialista em prospecção fria via WhatsApp (atração ativa) do Prospix.
Sua missão é gerar abordagens de vendas altamente naturais, curtas, com alta taxa de conversão e que NÃO pareçam spam automático.

Diretrizes de Copywriting:
1. Comece sempre com um gancho muito amigável, direto e focado no nicho.
2. Evite textões longos. A abordagem inicial deve caber em uma única tela de celular sem precisar de rolagem (menos de 280 caracteres).
3. O objetivo do contato é apenas iniciar um diálogo rápido ou agendar um bate-papo de 5 minutos, e não tentar fechar a venda do seguro agora.
4. Utilize obrigatoriamente as tags de personalização de dados:
   - [Nome]: Nome do Lead
   - [Empresa]: Nome da Empresa do Lead
   - [Cidade]: Cidade do Lead

Você DEVE responder APENAS com um objeto JSON válido no seguinte formato de chaves:
{
  "baseMessage": "Sua mensagem base gerada, em português brasileiro. Curta (máximo 280 caracteres) e com as tags de personalização necessárias.",
  "variationA": "Mensagem Variante A, explorando outra dor ou gatilho complementar (máximo 280 caracteres) com as tags.",
  "variationB": "Mensagem Variante B, focada em outro gancho complementar (máximo 280 caracteres) com as tags."
}
Não adicione qualquer explicação fora do JSON.`
          },
          {
            role: 'user',
            content: `Gere um roteiro de atração ativa no WhatsApp com as seguintes especificações:
- Nicho do Lead: ${nicheText}
- Produto oferecido: ${productText}
- Tom de voz: ${toneText}

${customNiche ? `Especificidades do Nicho: ${customNiche}` : ''}
${customProduct ? `Especificidades do Produto: ${customProduct}` : ''}

Estratégia de vendas consultivas para aplicar na redação:
${strategyText}

Lembre-se de utilizar ganchos conversacionais de alto impacto. Retorne apenas o JSON solicitado.`
          }
        ],
        temperature: 0.7,
        responseFormat: 'json',
      });

      // Parse AI response
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(result.content);
      } catch {
        // Fallback in case JSON is wrapped in markdown code blocks
        const cleaned = result.content.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedResponse = JSON.parse(cleaned);
      }

      const { baseMessage, variationA, variationB } = parsedResponse;

      if (!baseMessage) throw new Error('AI failed to output baseMessage');

      const variations = [];
      if (variationA) {
        variations.push({ id: 'a', name: 'Variante A', weight: 50, content: variationA });
      }
      if (variationB) {
        variations.push({ id: 'b', name: 'Variante B', weight: 50, content: variationB });
      }

      return reply.code(200).send({
        data: {
          baseMessage,
          variations,
        }
      });
    } catch (err: any) {
      logger.error({ err }, '❌ Error generating script with AI');

      // Super robust mock fallback to ensure the feature NEVER breaks and is highly premium
      const fallbackBase = `Olá [Nome], tudo bem? Acompanho a sua atuação em [Cidade]. Notei que vocês têm uma rotina super corrida. Como você protege a receita da [Empresa] em caso de imprevistos físicos temporários?`;
      const fallbackA = `Olá [Nome], sou consultor em [Cidade]. Ajudamos profissionais de saúde/empresários a protegerem seu faturamento de consultório ou empresa em vida com produtos MetLife. Teria 3 minutos pra uma ligação rápida?`;
      const fallbackB = `Olá [Nome], vi que a [Empresa] é muito conceituada. Você sabia que é possível estruturar a proteção e liquidez de cotas da empresa de forma isenta de impostos? Podemos alinhar isso sem compromisso?`;

      return reply.code(200).send({
        data: {
          baseMessage: fallbackBase,
          variations: [
            { id: 'fallback-a', name: 'Variante A (Foco em Proteção de Renda)', weight: 50, content: fallbackA },
            { id: 'fallback-b', name: 'Variante B (Foco em Eficiência Tributária)', weight: 50, content: fallbackB },
          ]
        }
      });
    }
  });


  // ── 11. POST /v1/tenant/scripts/clone ───────────────────────────────────────
  const cloneSchema = z.object({
    templateId: z.string().uuid('Invalid template ID format'),
  });

  app.post('/scripts/clone', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = cloneSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    const { templateId } = parsed.data;

    try {
      // Fetch Script Template
      const template = await prisma.scriptTemplate.findUnique({
        where: { id: templateId, active: true },
      });

      if (!template) {
        return reply.code(404).send({ error: 'Not Found', message: 'Active script template not found' });
      }

      // Clone Script Template into a Tenant Script
      const script = await prisma.script.create({
        data: {
          tenantId: req.tenantId!,
          clonedFromTemplateId: template.id,
          name: `${template.name} (Clonado)`,
          category: template.category,
          targetProfession: template.targetProfession,
          flow: template.flowTemplate as any,
          baseMessage: template.baseMessageTemplate,
          variables: template.variables,
          status: ScriptStatus.DRAFT,
        },
      });

      logger.info({ tenantId: req.tenantId, templateId, scriptId: script.id }, '📋 Script template cloned successfully');
      return reply.code(201).send(script);
    } catch (err) {
      req.log.error({ err }, 'Failed to clone script template');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to clone script template.' });
    }
  });

  // ── 12. PATCH /v1/tenant/scripts/:id ────────────────────────────────────────
  const updateScriptSchema = z.object({
    name: z.string().min(1).optional(),
    status: z.nativeEnum(ScriptStatus).optional(),
    flow: z.record(z.string(), z.unknown()).optional(),
    baseMessage: z.string().optional(),
  });

  app.patch('/scripts/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }
    const { id } = paramsParsed.data;

    const parsed = updateScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    try {
      const script = await prisma.script.findUnique({
        where: { id },
      });

      if (!script || script.tenantId !== req.tenantId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Script not found' });
      }

      const updated = await prisma.script.update({
        where: { id },
        data: {
          ...parsed.data,
        },
      });

      logger.info({ scriptId: id }, '📋 Script updated successfully');
      return reply.code(200).send(updated);
    } catch (err) {
      req.log.error({ err, scriptId: id }, 'Failed to update script');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to update script.' });
    }
  });

  // ── 13. POST /v1/tenant/scripts/:id/variations ────────────────────────────────
  const variationSchema = z.object({
    variantLetter: z.string().min(1).max(2),
    message: z.string().min(1),
    weight: z.number().min(0.0).max(1.0).default(0.33),
  });

  app.post('/scripts/:id/variations', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }
    const { id } = paramsParsed.data;

    const parsed = variationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    try {
      const script = await prisma.script.findUnique({
        where: { id },
      });

      if (!script || script.tenantId !== req.tenantId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Script not found' });
      }

      const { variantLetter, message, weight } = parsed.data;

      // Create or update variation
      const variation = await prisma.scriptVariation.upsert({
        where: {
          scriptId_variantLetter: {
            scriptId: id,
            variantLetter,
          },
        },
        create: {
          tenantId: req.tenantId!,
          scriptId: id,
          variantLetter,
          message,
          weight,
          active: true,
        },
        update: {
          message,
          weight,
          active: true,
        },
      });

      logger.info({ scriptId: id, variantLetter }, '📋 Script variation upserted successfully');
      return reply.code(201).send(variation);
    } catch (err) {
      req.log.error({ err, scriptId: id }, 'Failed to upsert script variation');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to upsert script variation.' });
    }
  });

  // ── 14. POST /v1/tenant/scripts/:id/test ────────────────────────────────────
  app.post('/scripts/:id/test', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }
    const { id } = paramsParsed.data;

    try {
      const script = await prisma.script.findUnique({
        where: { id },
        include: { variations: true },
      });

      if (!script || script.tenantId !== req.tenantId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Script not found' });
      }

      // Generate brief preview
      const previewMessage = script.variations.length > 0 
        ? script.variations[0]?.message 
        : script.baseMessage || 'Olá, tudo bem?';

      return reply.code(200).send({
        preview: previewMessage,
        nodes_count: (script.flow as any)?.nodes?.length || 0,
        active_variations: script.variations.filter(v => v.active).map(v => v.variantLetter),
      });
    } catch (err) {
      req.log.error({ err, scriptId: id }, 'Failed to test script');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to test script.' });
    }
  });
  // ── 15. GET /v1/tenant/leads/:id/events ──────────────────────────────────────
  app.get('/leads/:id/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }
    const { id } = paramsParsed.data;

    try {
      // Verify lead belongs to tenant
      const lead = await prisma.lead.findFirst({
        where: { id, tenantId: req.tenantId!, deletedAt: null },
        select: { id: true },
      });

      if (!lead) {
        return reply.code(404).send({ error: 'Not Found', message: 'Lead not found' });
      }

      const events = await prisma.leadEvent.findMany({
        where: { tenantId: req.tenantId!, leadId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          eventType: true,
          payload: true,
          actorId: true,
          createdAt: true,
        },
      });

      return reply.code(200).send({
        data: events.map((e) => ({
          id: String(e.id),
          eventType: e.eventType,
          payload: e.payload,
          actorId: e.actorId,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      req.log.error({ err, leadId: id }, 'Failed to list lead events');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch lead events.' });
    }
  });
};
export default tenantRoutes;
