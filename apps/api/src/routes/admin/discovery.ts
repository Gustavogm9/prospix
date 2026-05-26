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
}
