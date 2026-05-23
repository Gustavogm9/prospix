import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { createTenantQueue } from '../lib/queue.js';
import { createSendWhatsappJobId } from '../workers/send-whatsapp-job.js';
import { z } from 'zod';
import { ConversationStatus, LeadStatus, MessageDirection, MessageSender, MessageDeliveryStatus, ScriptCategory, ScriptStatus } from '@prisma/client';

export const tenantRoutes: FastifyPluginAsync = async (app) => {

  // Middleware to ensure user is authenticated and tenant context is set
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Tenant context is required' });
    }
  });

  // ── 1. GET /v1/tenant/conversations ─────────────────────────────────────────
  app.get('/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const list = await prisma.conversation.findMany({
      where: { tenantId: req.tenantId! },
      include: { lead: true },
      orderBy: { lastMessageAt: 'desc' },
    });
    return reply.code(200).send(list);
  });

  // ── 2. POST /v1/tenant/conversations ───────────────────────────────────────
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
  });

  // ── 3. GET /v1/tenant/conversations/:id/messages ────────────────────────────
  app.get('/conversations/:id/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const list = await prisma.message.findMany({
      where: { tenantId: req.tenantId!, conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return reply.code(200).send(list);
  });

  // ── 4. POST /v1/tenant/conversations/:id/messages ───────────────────────────
  const sendMsgSchema = z.object({
    content: z.string().min(1, 'Message content cannot be empty'),
  });

  app.post('/conversations/:id/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    
    const parsed = sendMsgSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

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
  });

  // ── 5. PATCH /v1/tenant/conversations/:id ───────────────────────────────────
  const updateConvSchema = z.object({
    aiHandling: z.boolean(),
  });

  app.patch('/conversations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    
    const parsed = updateConvSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

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
  });

  // ── 6. GET /v1/tenant/scripts ───────────────────────────────────────────────
  app.get('/scripts', async (req: FastifyRequest, reply: FastifyReply) => {
    const list = await prisma.script.findMany({
      where: { tenantId: req.tenantId!, archivedAt: null },
      include: { variations: true },
    });
    return reply.code(200).send(list);
  });

  // ── 6. POST /v1/tenant/scripts ─────────────────────────────────────────────
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
  });

  // ── 7. POST /v1/tenant/scripts/simulate ────────────────────────────────────
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

  // ── 8. POST /v1/tenant/scripts/clone ────────────────────────────────────────
  const cloneSchema = z.object({
    templateId: z.string().uuid('Invalid template ID format'),
  });

  app.post('/scripts/clone', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = cloneSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

    const { templateId } = parsed.data;

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
  });

  // ── 9. PATCH /v1/tenant/scripts/:id ─────────────────────────────────────────
  const updateScriptSchema = z.object({
    name: z.string().min(1).optional(),
    status: z.nativeEnum(ScriptStatus).optional(),
    flow: z.any().optional(),
    baseMessage: z.string().optional(),
  });

  app.patch('/scripts/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const parsed = updateScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

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
  });

  // ── 10. POST /v1/tenant/scripts/:id/variations ─────────────────────────────
  const variationSchema = z.object({
    variantLetter: z.string().min(1).max(2),
    message: z.string().min(1),
    weight: z.number().min(0.0).max(1.0).default(0.33),
  });

  app.post('/scripts/:id/variations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const parsed = variationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parsed.error.errors[0]?.message });
    }

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
  });

  // ── 9. POST /v1/tenant/scripts/:id/test ─────────────────────────────────────
  app.post('/scripts/:id/test', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

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
  });
};
export default tenantRoutes;
