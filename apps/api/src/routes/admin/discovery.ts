/**
 * Endpoints admin · Frente G L1 Discovery (manual tracking)
 *
 * MVP escopo · L1 fase 1:
 *  - GET    /v1/admin/tenants/:id/discovery · estado atual (upsert NOT_STARTED se ausente)
 *  - PATCH  /v1/admin/tenants/:id/discovery · atualizar status/datas/notes/pm
 *
 * TODO L1 fase 2 (roadmap docs/agents/frente-g-discovery-onboarding.md):
 *  - POST /materials · upload R2 presigned
 *  - PUT /voice-profile · editor JSON com schema validation
 *  - PUT /scripts · 3 roteiros editor
 *  - POST /validate · rodada validação (max 2)
 *  - POST /approve · aprovação + upload prova WhatsApp
 *  - POST /promote · cria Script records + atualiza Tenant.aiVoiceProfile (com gates)
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { DiscoveryStatus, Profession, ScriptCategory, ScriptStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { isR2Configured, presignUpload, regenerateR2PresignedUrl, deleteR2Object } from '../../lib/r2-storage.js';

interface DiscoveryQualityReport {
  voiceProfile: {
    objections: { count: number; required: number; ok: boolean };
    complianceNever: { count: number; required: number; ok: boolean };
  };
  scripts: {
    medicos: { variations: number; nodes: number; ok: boolean };
    advogados: { variations: number; nodes: number; ok: boolean };
    empresarios: { variations: number; nodes: number; ok: boolean };
  };
  approvalProof: boolean;
  pmAssigned: boolean;
  statusApproved: boolean;
  allOk: boolean;
  blockingReasons: string[];
}

function evaluateQualityGates(d: {
  status: DiscoveryStatus;
  voiceProfileDraft: unknown;
  scriptsDraft: unknown;
  approvalProofR2Key: string | null;
  pmUserId: string | null;
}): DiscoveryQualityReport {
  const voiceProfile = (d.voiceProfileDraft ?? {}) as { objections?: unknown[]; compliance_never?: unknown[] };
  const objectionsCount = Array.isArray(voiceProfile.objections) ? voiceProfile.objections.length : 0;
  const complianceCount = Array.isArray(voiceProfile.compliance_never) ? voiceProfile.compliance_never.length : 0;

  const scripts = (d.scriptsDraft ?? {}) as Record<string, { initial_message_variations?: unknown[]; nodes?: unknown[] }>;
  const measure = (key: string) => {
    const seg = scripts[key] ?? {};
    const variations = Array.isArray(seg.initial_message_variations) ? seg.initial_message_variations.length : 0;
    const nodes = Array.isArray(seg.nodes) ? seg.nodes.length : 0;
    return { variations, nodes, ok: variations >= 3 && nodes >= 5 };
  };

  const medicos = measure('medicos');
  const advogados = measure('advogados');
  const empresarios = measure('empresarios');

  const report: DiscoveryQualityReport = {
    voiceProfile: {
      objections: { count: objectionsCount, required: 6, ok: objectionsCount >= 6 },
      complianceNever: { count: complianceCount, required: 3, ok: complianceCount >= 3 },
    },
    scripts: { medicos, advogados, empresarios },
    approvalProof: !!d.approvalProofR2Key,
    pmAssigned: !!d.pmUserId,
    statusApproved: d.status === DiscoveryStatus.APPROVED,
    allOk: false,
    blockingReasons: [],
  };

  const reasons: string[] = [];
  if (!report.voiceProfile.objections.ok) reasons.push(`voice_profile.objections precisa ≥6 (atual ${objectionsCount}).`);
  if (!report.voiceProfile.complianceNever.ok) reasons.push(`voice_profile.compliance_never precisa ≥3 (atual ${complianceCount}).`);
  if (!medicos.ok) reasons.push(`scripts.medicos precisa ≥3 variações e ≥5 nodes (atual ${medicos.variations}/${medicos.nodes}).`);
  if (!advogados.ok) reasons.push(`scripts.advogados precisa ≥3 variações e ≥5 nodes (atual ${advogados.variations}/${advogados.nodes}).`);
  if (!empresarios.ok) reasons.push(`scripts.empresarios precisa ≥3 variações e ≥5 nodes (atual ${empresarios.variations}/${empresarios.nodes}).`);
  if (!report.approvalProof) reasons.push('approvalProofR2Key ausente · faça upload do print de aprovação.');
  if (!report.pmAssigned) reasons.push('pmUserId ausente · atribua o responsável.');
  if (!report.statusApproved) reasons.push(`Status precisa estar APPROVED para promoção (atual ${d.status}).`);

  report.blockingReasons = reasons;
  report.allOk = reasons.length === 0;
  return report;
}

const paramsSchema = z.object({
  id: z.string().uuid('tenant id must be a UUID'),
});

const patchBodySchema = z.object({
  status: z.nativeEnum(DiscoveryStatus).optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  conductedAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  pmUserId: z.string().uuid().nullable().optional(),
});

function serializeDiscovery(d: Awaited<ReturnType<typeof prisma.tenantDiscovery.findUnique>>) {
  if (!d) return null;
  return {
    tenantId: d.tenantId,
    status: d.status,
    scheduledFor: d.scheduledFor?.toISOString() ?? null,
    conductedAt: d.conductedAt?.toISOString() ?? null,
    validatedAt: d.validatedAt?.toISOString() ?? null,
    validationRounds: d.validationRounds,
    approvedAt: d.approvedAt?.toISOString() ?? null,
    pmUserId: d.pmUserId ?? null,
    notes: d.notes ?? null,
    hasAudio: !!d.audioR2Key,
    hasVideo: !!d.videoR2Key,
    hasTranscript: !!d.transcriptR2Key,
    hasVoiceProfileDraft: d.voiceProfileDraft !== null,
    hasScriptsDraft: d.scriptsDraft !== null,
    hasApprovalProof: !!d.approvalProofR2Key,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function registerAdminDiscoveryRoutes(app: FastifyInstance): void {
  app.get('/tenants/:id/discovery', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Tenant id inválido.', issues: parsed.error.issues });
    }
    const tenantId = parsed.data.id;
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!tenant) return reply.status(404).send({ message: 'Tenant não encontrado.' });

      const discovery = await prisma.tenantDiscovery.upsert({
        where: { tenantId },
        create: { tenantId, status: DiscoveryStatus.NOT_STARTED },
        update: {},
      });
      return reply.send({ data: serializeDiscovery(discovery) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery · GET failed');
      return reply.status(500).send({ message: 'Falha ao carregar discovery do tenant.' });
    }
  });

  app.patch('/tenants/:id/discovery', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Tenant id inválido.', issues: paramsParsed.error.issues });
    }
    const bodyParsed = patchBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      return reply.status(400).send({ message: 'Payload inválido.', issues: bodyParsed.error.issues });
    }
    const tenantId = paramsParsed.data.id;
    const patch = bodyParsed.data;

    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!tenant) return reply.status(404).send({ message: 'Tenant não encontrado.' });

      if (patch.pmUserId) {
        const pm = await prisma.user.findUnique({ where: { id: patch.pmUserId }, select: { id: true } });
        if (!pm) return reply.status(400).send({ message: 'pmUserId não corresponde a um usuário existente.' });
      }

      const updated = await prisma.tenantDiscovery.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: patch.status ?? DiscoveryStatus.NOT_STARTED,
          scheduledFor: patch.scheduledFor ? new Date(patch.scheduledFor) : null,
          conductedAt: patch.conductedAt ? new Date(patch.conductedAt) : null,
          notes: patch.notes ?? null,
          pmUserId: patch.pmUserId ?? null,
        },
        update: {
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.scheduledFor !== undefined && {
            scheduledFor: patch.scheduledFor ? new Date(patch.scheduledFor) : null,
          }),
          ...(patch.conductedAt !== undefined && {
            conductedAt: patch.conductedAt ? new Date(patch.conductedAt) : null,
          }),
          ...(patch.notes !== undefined && { notes: patch.notes }),
          ...(patch.pmUserId !== undefined && { pmUserId: patch.pmUserId }),
        },
      });
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId, patch }, 'admin/discovery · PATCH failed');
      return reply.status(500).send({ message: 'Falha ao atualizar discovery do tenant.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Materials (R2 upload presigned · L1 fase 2A)
  // ─────────────────────────────────────────────────────────────────────────
  const materialKindSchema = z.enum(['audio', 'video', 'transcript', 'approval_proof']);

  const presignBodySchema = z.object({
    kind: materialKindSchema,
    contentType: z.string().min(1).max(120),
    filename: z.string().min(1).max(255).optional(),
  });

  const confirmBodySchema = z.object({
    kind: materialKindSchema,
    key: z.string().min(1).max(512),
  });

  const KIND_TO_COLUMN: Record<z.infer<typeof materialKindSchema>, 'audioR2Key' | 'videoR2Key' | 'transcriptR2Key' | 'approvalProofR2Key'> = {
    audio: 'audioR2Key',
    video: 'videoR2Key',
    transcript: 'transcriptR2Key',
    approval_proof: 'approvalProofR2Key',
  };

  app.post('/tenants/:id/discovery/materials/presign', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isR2Configured()) {
      return reply.status(503).send({ message: 'R2 storage não configurado. Defina R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY.' });
    }
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const bodyParsed = presignBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ message: 'Payload inválido.', issues: bodyParsed.error.issues });
    const tenantId = paramsParsed.data.id;
    const { kind, contentType, filename } = bodyParsed.data;
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!tenant) return reply.status(404).send({ message: 'Tenant não encontrado.' });

      const safeName = (filename ?? `${kind}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      const key = `tenant_${tenantId}/discovery/${kind}/${Date.now()}-${safeName}`;
      const { uploadUrl, expiresAt } = await presignUpload({ key, contentType });
      return reply.send({
        data: { key, uploadUrl, expiresAt: expiresAt.toISOString() },
      });
    } catch (err) {
      logger.error({ err, tenantId, kind }, 'admin/discovery/materials · presign failed');
      return reply.status(500).send({ message: 'Falha ao gerar URL de upload.' });
    }
  });

  app.post('/tenants/:id/discovery/materials/confirm', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const bodyParsed = confirmBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ message: 'Payload inválido.', issues: bodyParsed.error.issues });
    const tenantId = paramsParsed.data.id;
    const { kind, key } = bodyParsed.data;
    const column = KIND_TO_COLUMN[kind];
    try {
      const updated = await prisma.tenantDiscovery.upsert({
        where: { tenantId },
        create: { tenantId, status: DiscoveryStatus.NOT_STARTED, [column]: key } as never,
        update: { [column]: key } as never,
      });
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId, kind, key }, 'admin/discovery/materials · confirm failed');
      return reply.status(500).send({ message: 'Falha ao salvar material.' });
    }
  });

  app.delete('/tenants/:id/discovery/materials/:kind', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = z
      .object({ id: z.string().uuid(), kind: materialKindSchema })
      .safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Parâmetros inválidos.' });
    const tenantId = paramsParsed.data.id;
    const kind = paramsParsed.data.kind;
    const column = KIND_TO_COLUMN[kind];
    try {
      const discovery = await prisma.tenantDiscovery.findUnique({ where: { tenantId }, select: { [column]: true } as never });
      const currentKey = (discovery as Record<string, string | null> | null)?.[column];
      if (currentKey && isR2Configured()) {
        await deleteR2Object(currentKey).catch((err) => {
          logger.warn({ err, key: currentKey }, 'admin/discovery/materials · R2 delete failed (non-fatal · DB will clear ref)');
        });
      }
      const updated = await prisma.tenantDiscovery.update({
        where: { tenantId },
        data: { [column]: null } as never,
      });
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId, kind }, 'admin/discovery/materials · delete failed');
      return reply.status(500).send({ message: 'Falha ao remover material.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Voice profile draft (L1 fase 2B)
  // Schema mínimo: { compliance_never: string[], objections: [...] }
  // ─────────────────────────────────────────────────────────────────────────
  const objectionSchema = z.object({
    trigger: z.string().min(1).max(120),
    client_says_examples: z.array(z.string().min(1)).min(1),
    giovane_response: z.string().min(1),
    follow_up: z.string().optional(),
  });

  const voiceProfileBodySchema = z.object({
    profile: z
      .object({
        compliance_never: z.array(z.string().min(1)).default([]),
        objections: z.array(objectionSchema).default([]),
      })
      .passthrough(),
  });

  app.put('/tenants/:id/discovery/voice-profile', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const bodyParsed = voiceProfileBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ message: 'Voice profile inválido.', issues: bodyParsed.error.issues });
    const tenantId = paramsParsed.data.id;
    try {
      const updated = await prisma.tenantDiscovery.upsert({
        where: { tenantId },
        create: { tenantId, status: DiscoveryStatus.NOT_STARTED, voiceProfileDraft: bodyParsed.data.profile as never },
        update: { voiceProfileDraft: bodyParsed.data.profile as never },
      });
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/voice-profile · PUT failed');
      return reply.status(500).send({ message: 'Falha ao salvar voice profile.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scripts draft (3 segmentos · medicos/advogados/empresarios) · L1 fase 2B
  // Cada segmento exige >=5 nodes + >=3 variações da mensagem inicial
  // ─────────────────────────────────────────────────────────────────────────
  const scriptSegmentSchema = z.object({
    initial_message_variations: z.array(z.string().min(1)).default([]),
    nodes: z
      .array(
        z.object({
          id: z.string().min(1),
          message: z.string().min(1),
          next: z.array(z.string()).optional(),
        }),
      )
      .default([]),
  });

  const scriptsBodySchema = z.object({
    scripts: z.object({
      medicos: scriptSegmentSchema.optional(),
      advogados: scriptSegmentSchema.optional(),
      empresarios: scriptSegmentSchema.optional(),
    }),
  });

  app.put('/tenants/:id/discovery/scripts', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const bodyParsed = scriptsBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ message: 'Scripts inválidos.', issues: bodyParsed.error.issues });
    const tenantId = paramsParsed.data.id;
    try {
      const updated = await prisma.tenantDiscovery.upsert({
        where: { tenantId },
        create: { tenantId, status: DiscoveryStatus.NOT_STARTED, scriptsDraft: bodyParsed.data.scripts as never },
        update: { scriptsDraft: bodyParsed.data.scripts as never },
      });
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/scripts · PUT failed');
      return reply.status(500).send({ message: 'Falha ao salvar scripts.' });
    }
  });

  // Drafts read endpoint · UI editor precisa do conteúdo cru (serializer só expõe booleans)
  app.get('/tenants/:id/discovery/drafts', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const discovery = await prisma.tenantDiscovery.findUnique({
        where: { tenantId },
        select: { voiceProfileDraft: true, scriptsDraft: true },
      });
      return reply.send({
        data: {
          voiceProfile: discovery?.voiceProfileDraft ?? null,
          scripts: discovery?.scriptsDraft ?? null,
        },
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/drafts · GET failed');
      return reply.status(500).send({ message: 'Falha ao carregar drafts.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Gates de qualidade (preview) · L1 fase 2C
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/tenants/:id/discovery/quality', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const discovery = await prisma.tenantDiscovery.findUnique({
        where: { tenantId },
        select: { status: true, voiceProfileDraft: true, scriptsDraft: true, approvalProofR2Key: true, pmUserId: true },
      });
      if (!discovery) return reply.status(404).send({ message: 'Discovery não inicializada.' });
      return reply.send({ data: evaluateQualityGates(discovery) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/quality · GET failed');
      return reply.status(500).send({ message: 'Falha ao calcular gates.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /validate · marca uma rodada de validação (máx 2)
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/tenants/:id/discovery/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const current = await prisma.tenantDiscovery.findUnique({
        where: { tenantId },
        select: { validationRounds: true, status: true },
      });
      if (!current) return reply.status(404).send({ message: 'Discovery não inicializada.' });
      if (current.validationRounds >= 2) {
        return reply.status(409).send({ message: 'Máximo de 2 rodadas de validação atingido. Reavalie escopo antes de nova tentativa.' });
      }
      const updated = await prisma.tenantDiscovery.update({
        where: { tenantId },
        data: {
          validationRounds: { increment: 1 },
          validatedAt: new Date(),
          status: DiscoveryStatus.VALIDATING,
        },
      });
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/validate · POST failed');
      return reply.status(500).send({ message: 'Falha ao registrar validação.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /approve · aprovação formal (requer prova de aprovação + pm atribuído)
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/tenants/:id/discovery/approve', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const current = await prisma.tenantDiscovery.findUnique({
        where: { tenantId },
        select: { approvalProofR2Key: true, pmUserId: true },
      });
      if (!current) return reply.status(404).send({ message: 'Discovery não inicializada.' });
      if (!current.approvalProofR2Key) {
        return reply.status(409).send({ message: 'approvalProofR2Key ausente. Faça upload do print de aprovação antes.' });
      }
      if (!current.pmUserId) {
        return reply.status(409).send({ message: 'pmUserId ausente. Atribua responsável antes de aprovar.' });
      }
      const updated = await prisma.tenantDiscovery.update({
        where: { tenantId },
        data: { status: DiscoveryStatus.APPROVED, approvedAt: new Date() },
      });
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/approve · POST failed');
      return reply.status(500).send({ message: 'Falha ao aprovar discovery.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /promote · cria Script records + atualiza Tenant.aiVoiceProfile + AuditLog
  // ─────────────────────────────────────────────────────────────────────────
  const promoteBodySchema = z.object({
    actorUserId: z.string().uuid().optional(),
  });

  const SEGMENT_TO_PROFESSION: Record<'medicos' | 'advogados' | 'empresarios', Profession> = {
    medicos: Profession.DOCTOR,
    advogados: Profession.LAWYER,
    empresarios: Profession.ENTREPRENEUR,
  };

  app.post('/tenants/:id/discovery/promote', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const bodyParsed = promoteBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ message: 'Payload inválido.', issues: bodyParsed.error.issues });
    const tenantId = paramsParsed.data.id;
    const actorUserId = bodyParsed.data.actorUserId;
    try {
      const discovery = await prisma.tenantDiscovery.findUnique({
        where: { tenantId },
        select: { status: true, voiceProfileDraft: true, scriptsDraft: true, approvalProofR2Key: true, pmUserId: true },
      });
      if (!discovery) return reply.status(404).send({ message: 'Discovery não inicializada.' });

      const gates = evaluateQualityGates(discovery);
      if (!gates.allOk) {
        return reply.status(409).send({ message: 'Gates de promoção não atendidos.', blockingReasons: gates.blockingReasons });
      }

      const scriptsDraft = discovery.scriptsDraft as Record<string, { initial_message_variations?: string[]; nodes?: unknown[] }>;
      const promoted = await prisma.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id: tenantId },
          data: { aiVoiceProfile: discovery.voiceProfileDraft as never },
        });

        const createdScripts: string[] = [];
        for (const segmentKey of ['medicos', 'advogados', 'empresarios'] as const) {
          const seg = scriptsDraft[segmentKey];
          if (!seg) continue;
          const baseMessage = seg.initial_message_variations?.[0] ?? null;
          const created = await tx.script.create({
            data: {
              tenantId,
              name: `Discovery · ${segmentKey}`,
              category: ScriptCategory.APPROACH,
              targetProfession: SEGMENT_TO_PROFESSION[segmentKey],
              status: ScriptStatus.ACTIVE,
              flow: seg as never,
              baseMessage,
            },
          });
          if (seg.initial_message_variations && seg.initial_message_variations.length > 1) {
            const variations = seg.initial_message_variations.slice(1, 4).map((message, index) => ({
              tenantId,
              scriptId: created.id,
              variantLetter: String.fromCharCode(66 + index), // 'B', 'C', 'D'
              message,
            }));
            if (variations.length > 0) {
              await tx.scriptVariation.createMany({ data: variations });
            }
          }
          createdScripts.push(created.id);
        }

        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actorUserId ?? discovery.pmUserId,
            action: 'discovery.promote',
            targetType: 'TenantDiscovery',
            targetId: tenantId,
            payload: {
              scriptsCreated: createdScripts,
              voiceProfileApplied: true,
              gatesSnapshot: gates,
            } as never,
          },
        });

        return createdScripts;
      });

      return reply.send({
        data: { tenantId, scriptsCreated: promoted, aiVoiceProfileUpdated: true, gates },
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/promote · POST failed');
      return reply.status(500).send({ message: 'Falha ao promover discovery.' });
    }
  });

  app.get('/tenants/:id/discovery/materials/:kind/download', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isR2Configured()) {
      return reply.status(503).send({ message: 'R2 storage não configurado.' });
    }
    const paramsParsed = z
      .object({ id: z.string().uuid(), kind: materialKindSchema })
      .safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Parâmetros inválidos.' });
    const tenantId = paramsParsed.data.id;
    const kind = paramsParsed.data.kind;
    const column = KIND_TO_COLUMN[kind];
    try {
      const discovery = await prisma.tenantDiscovery.findUnique({ where: { tenantId }, select: { [column]: true } as never });
      const currentKey = (discovery as Record<string, string | null> | null)?.[column];
      if (!currentKey) return reply.status(404).send({ message: 'Material não encontrado.' });
      const { presignedUrl, expiresAt } = await regenerateR2PresignedUrl(currentKey);
      return reply.send({ data: { key: currentKey, downloadUrl: presignedUrl, expiresAt: expiresAt.toISOString() } });
    } catch (err) {
      logger.error({ err, tenantId, kind }, 'admin/discovery/materials · download failed');
      return reply.status(500).send({ message: 'Falha ao gerar URL de download.' });
    }
  });
}
