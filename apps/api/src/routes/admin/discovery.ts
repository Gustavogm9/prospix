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
import { DiscoveryStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { isR2Configured, presignUpload, regenerateR2PresignedUrl, deleteR2Object } from '../../lib/r2-storage.js';

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
