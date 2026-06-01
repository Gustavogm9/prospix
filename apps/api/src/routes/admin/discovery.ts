/**
 * Endpoints admin — Frente G L1 Discovery (manual tracking)
 *
 * MVP escopo — L1 fase 1:
 *  - GET    /v1/admin/tenants/:id/discovery — estado atual (upsert NOT_STARTED se ausente)
 *  - PATCH  /v1/admin/tenants/:id/discovery — atualizar status/datas/notes/pm
 *
 * TODO L1 fase 2 (roadmap docs/agents/frente-g-discovery-onboarding.md):
 *  - POST /materials — upload R2 presigned
 *  - PUT /voice-profile — editor JSON com schema validation
 *  - PUT /scripts — 3 roteiros editor
 *  - POST /validate — rodada validação (max 2)
 *  - POST /approve — aprovação + upload prova WhatsApp
 *  - POST /promote — cria Script records + atualiza Tenant.aiVoiceProfile (com gates)
 */
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { DiscoveryStatus, Profession, ScriptCategory, ScriptStatus } from '@prospix/shared-types';
import { dbAdmin } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { isR2Configured, presignUpload, regenerateR2PresignedUrl, deleteR2Object } from '../../lib/r2-storage.js';
import { uploadFile, deleteFile, getFilePath } from '../../lib/local-storage.js';

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
  status: string;
  voice_profile_draft: unknown;
  scripts_draft: unknown;
  approval_proof_r2_key: string | null;
  pm_user_id: string | null;
}): DiscoveryQualityReport {
  const voiceProfile = (d.voice_profile_draft ?? {}) as { objections?: unknown[]; compliance_never?: unknown[] };
  const objectionsCount = Array.isArray(voiceProfile.objections) ? voiceProfile.objections.length : 0;
  const complianceCount = Array.isArray(voiceProfile.compliance_never) ? voiceProfile.compliance_never.length : 0;

  const scripts = (d.scripts_draft ?? {}) as Record<string, { initial_message_variations?: unknown[]; nodes?: unknown[] }>;
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
    approvalProof: !!d.approval_proof_r2_key,
    pmAssigned: !!d.pm_user_id,
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
  if (!report.approvalProof) reasons.push('approvalProofR2Key ausente — faça upload do print de aprovação.');
  if (!report.pmAssigned) reasons.push('pmUserId ausente — atribua o responsável.');
  if (!report.statusApproved) reasons.push(`Status precisa estar APPROVED para promoção (atual ${d.status}).`);

  report.blockingReasons = reasons;
  report.allOk = reasons.length === 0;
  return report;
}

const paramsSchema = z.object({
  id: z.string().uuid('tenant id must be a UUID'),
});

const patchBodySchema = z.object({
  status: z.enum(['NOT_STARTED', 'SCHEDULED', 'IN_SESSION', 'CONSOLIDATING', 'VALIDATING', 'APPROVED', 'CHURNED_BEFORE_APPROVAL']).optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  conductedAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  pmUserId: z.string().uuid().nullable().optional(),
});

function serializeDiscovery(d: any) {
  if (!d) return null;
  return {
    tenantId: d.tenant_id,
    status: d.status,
    scheduledFor: d.scheduled_for ?? null,
    conductedAt: d.conducted_at ?? null,
    validatedAt: d.validated_at ?? null,
    validationRounds: d.validation_rounds,
    approvedAt: d.approved_at ?? null,
    pmUserId: d.pm_user_id ?? null,
    notes: d.notes ?? null,
    hasAudio: !!d.audio_r2_key,
    hasVideo: !!d.video_r2_key,
    hasTranscript: !!d.transcript_r2_key,
    hasVoiceProfileDraft: d.voice_profile_draft !== null,
    hasScriptsDraft: d.scripts_draft !== null,
    hasApprovalProof: !!d.approval_proof_r2_key,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
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
      const { data: tenant } = await dbAdmin.from('tenants').select('id').eq('id', tenantId).single();
      if (!tenant) return reply.status(404).send({ message: 'Tenant não encontrado.' });

      // Upsert: try to find existing, create if not exists
      const { data: existing } = await dbAdmin
        .from('tenant_discoveries')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (existing) {
        return reply.send({ data: serializeDiscovery(existing) });
      }

      const { data: created, error: createErr } = await dbAdmin
        .from('tenant_discoveries')
        .insert({ tenant_id: tenantId, status: DiscoveryStatus.NOT_STARTED, updated_at: new Date().toISOString() } as any)
        .select()
        .single();
      if (createErr) throw createErr;

      return reply.send({ data: serializeDiscovery(created) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery → GET failed');
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
      const { data: tenant } = await dbAdmin.from('tenants').select('id').eq('id', tenantId).single();
      if (!tenant) return reply.status(404).send({ message: 'Tenant não encontrado.' });

      if (patch.pmUserId) {
        const { data: pm } = await dbAdmin.from('users').select('id').eq('id', patch.pmUserId).single();
        if (!pm) return reply.status(400).send({ message: 'pmUserId não corresponde a um usuário existente.' });
      }

      // Upsert: try update first, create if not exists
      const { data: existing } = await dbAdmin
        .from('tenant_discoveries')
        .select('tenant_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      let result: any;
      if (existing) {
        const updateData: Record<string, unknown> = {};
        if (patch.status !== undefined) updateData.status = patch.status;
        if (patch.scheduledFor !== undefined) updateData.scheduled_for = patch.scheduledFor;
        if (patch.conductedAt !== undefined) updateData.conducted_at = patch.conductedAt;
        if (patch.notes !== undefined) updateData.notes = patch.notes;
        if (patch.pmUserId !== undefined) updateData.pm_user_id = patch.pmUserId;

        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .update(updateData as any)
          .eq('tenant_id', tenantId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .insert({
            tenant_id: tenantId,
            status: patch.status ?? DiscoveryStatus.NOT_STARTED,
            scheduled_for: patch.scheduledFor ?? null,
            conducted_at: patch.conductedAt ?? null,
            notes: patch.notes ?? null,
            pm_user_id: patch.pmUserId ?? null,
            updated_at: new Date().toISOString(),
          } as any)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }
      return reply.send({ data: serializeDiscovery(result) });
    } catch (err) {
      logger.error({ err, tenantId, patch }, 'admin/discovery → PATCH failed');
      return reply.status(500).send({ message: 'Falha ao atualizar discovery do tenant.' });
    }
  });

  // —
  // Materials (R2 upload presigned — L1 fase 2A)
  // —
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

  const KIND_TO_COLUMN: Record<z.infer<typeof materialKindSchema>, string> = {
    audio: 'audio_r2_key',
    video: 'video_r2_key',
    transcript: 'transcript_r2_key',
    approval_proof: 'approval_proof_r2_key',
  };

  app.post('/tenants/:id/discovery/materials/presign', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const bodyParsed = presignBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) return reply.status(400).send({ message: 'Payload inválido.', issues: bodyParsed.error.issues });
    const tenantId = paramsParsed.data.id;
    const { kind, contentType, filename } = bodyParsed.data;
    try {
      const { data: tenant } = await dbAdmin.from('tenants').select('id').eq('id', tenantId).single();
      if (!tenant) return reply.status(404).send({ message: 'Tenant não encontrado.' });

      const safeName = (filename ?? `${kind}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      const key = `tenant_${tenantId}/discovery/${kind}/${Date.now()}-${safeName}`;

      // Try R2 first, fall back to local filesystem
      if (isR2Configured()) {
        const { uploadUrl, expiresAt } = await presignUpload({ key, contentType });
        return reply.send({ data: { key, uploadUrl, expiresAt: expiresAt.toISOString() } });
      }

      // Local filesystem: return upload endpoint URL on this API
      const apiUrl = process.env.API_URL || 'http://localhost:3000';
      const uploadUrl = `${apiUrl}/v1/admin/tenants/${tenantId}/discovery/materials/upload`;
      const expiresAt = new Date(Date.now() + 900_000); // 15min
      return reply.send({ data: { key, uploadUrl, expiresAt: expiresAt.toISOString(), local: true } });
    } catch (err) {
      logger.error({ err, tenantId, kind }, 'admin/discovery/materials → presign failed');
      return reply.status(500).send({ message: 'Falha ao gerar URL de upload.' });
    }
  });

  // Direct file upload endpoint (used when R2 is not configured)
  app.post('/tenants/:id/discovery/materials/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const { data: tenant } = await dbAdmin.from('tenants').select('id').eq('id', tenantId).single();
      if (!tenant) return reply.status(404).send({ message: 'Tenant não encontrado.' });

      // Collect body buffer from request
      const chunks: Buffer[] = [];
      for await (const chunk of req.raw) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      if (body.length === 0) {
        return reply.status(400).send({ message: 'Request body vazio.' });
      }

      const contentType = req.headers['content-type'] || 'application/octet-stream';
      const kindMatch = contentType.match(/^(audio|video|image|application)/)?.[0] ?? 'file';
      const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
      const key = `tenant_${tenantId}/discovery/${kindMatch}/${Date.now()}-upload.${ext}`;

      await uploadFile({ key, body, contentType });

      return reply.send({ data: { key, size_bytes: body.length } });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/materials → upload failed');
      return reply.status(500).send({ message: 'Falha no upload do material.' });
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
      // Upsert
      const { data: existing } = await dbAdmin
        .from('tenant_discoveries')
        .select('tenant_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      let result: any;
      if (existing) {
        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .update({ [column]: key } as any)
          .eq('tenant_id', tenantId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .insert({ tenant_id: tenantId, status: DiscoveryStatus.NOT_STARTED, [column]: key, updated_at: new Date().toISOString() } as any)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }
      return reply.send({ data: serializeDiscovery(result) });
    } catch (err) {
      logger.error({ err, tenantId, kind, key }, 'admin/discovery/materials → confirm failed');
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
      const { data: discovery } = await dbAdmin
        .from('tenant_discoveries')
        .select(column)
        .eq('tenant_id', tenantId)
        .single();
      const currentKey = (discovery as Record<string, string | null> | null)?.[column];
      if (currentKey) {
        if (isR2Configured()) {
          await deleteR2Object(currentKey).catch((err) => {
            logger.warn({ err, key: currentKey }, 'admin/discovery/materials → R2 delete failed (non-fatal)');
          });
        }
        await deleteFile(currentKey).catch(() => {});
      }
      const { data: updated, error } = await dbAdmin
        .from('tenant_discoveries')
        .update({ [column]: null } as any)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId, kind }, 'admin/discovery/materials → delete failed');
      return reply.status(500).send({ message: 'Falha ao remover material.' });
    }
  });

  // —
  // Voice profile draft (L1 fase 2B)
  // Schema mínimo: { compliance_never: string[], objections: [...] }
  // —
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
      // Upsert
      const { data: existing } = await dbAdmin
        .from('tenant_discoveries')
        .select('tenant_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      let result: any;
      if (existing) {
        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .update({ voice_profile_draft: bodyParsed.data.profile as any })
          .eq('tenant_id', tenantId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .insert({ tenant_id: tenantId, status: DiscoveryStatus.NOT_STARTED, voice_profile_draft: bodyParsed.data.profile as any, updated_at: new Date().toISOString() } as any)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }
      return reply.send({ data: serializeDiscovery(result) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/voice-profile → PUT failed');
      return reply.status(500).send({ message: 'Falha ao salvar voice profile.' });
    }
  });

  // —
  // Scripts draft (3 segmentos — medicos/advogados/empresarios) — L1 fase 2B
  // Cada segmento exige >=5 nodes + >=3 variações da mensagem inicial
  // —
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
      // Upsert
      const { data: existing } = await dbAdmin
        .from('tenant_discoveries')
        .select('tenant_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      let result: any;
      if (existing) {
        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .update({ scripts_draft: bodyParsed.data.scripts as any })
          .eq('tenant_id', tenantId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await dbAdmin
          .from('tenant_discoveries')
          .insert({ tenant_id: tenantId, status: DiscoveryStatus.NOT_STARTED, scripts_draft: bodyParsed.data.scripts as any, updated_at: new Date().toISOString() } as any)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }
      return reply.send({ data: serializeDiscovery(result) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/scripts → PUT failed');
      return reply.status(500).send({ message: 'Falha ao salvar scripts.' });
    }
  });

  // Drafts read endpoint — UI editor precisa do conteúdo cru (serializer só expõe booleans)
  app.get('/tenants/:id/discovery/drafts', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const { data: discovery } = await dbAdmin
        .from('tenant_discoveries')
        .select('voice_profile_draft, scripts_draft')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return reply.send({
        data: {
          voiceProfile: discovery?.voice_profile_draft ?? null,
          scripts: discovery?.scripts_draft ?? null,
        },
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/drafts → GET failed');
      return reply.status(500).send({ message: 'Falha ao carregar drafts.' });
    }
  });

  // —
  // Gates de qualidade (preview) — L1 fase 2C
  // —
  app.get('/tenants/:id/discovery/quality', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const { data: discovery } = await dbAdmin
        .from('tenant_discoveries')
        .select('status, voice_profile_draft, scripts_draft, approval_proof_r2_key, pm_user_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!discovery) return reply.status(404).send({ message: 'Discovery não inicializada.' });
      return reply.send({ data: evaluateQualityGates(discovery) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/quality → GET failed');
      return reply.status(500).send({ message: 'Falha ao calcular gates.' });
    }
  });

  // —
  // POST /validate — marca uma rodada de validação (máx 2)
  // —
  app.post('/tenants/:id/discovery/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const { data: current } = await dbAdmin
        .from('tenant_discoveries')
        .select('validation_rounds, status')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!current) return reply.status(404).send({ message: 'Discovery não inicializada.' });
      if (current.validation_rounds >= 2) {
        return reply.status(409).send({ message: 'Máximo de 2 rodadas de validação atingido. Reavalie escopo antes de nova tentativa.' });
      }
      const { data: updated, error } = await dbAdmin
        .from('tenant_discoveries')
        .update({
          validation_rounds: current.validation_rounds + 1,
          validated_at: new Date().toISOString(),
          status: DiscoveryStatus.VALIDATING,
        })
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/validate → POST failed');
      return reply.status(500).send({ message: 'Falha ao registrar validação.' });
    }
  });

  // —
  // POST /approve — aprovação formal (requer prova de aprovação + pm atribuído)
  // —
  app.post('/tenants/:id/discovery/approve', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = paramsSchema.safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Tenant id inválido.' });
    const tenantId = paramsParsed.data.id;
    try {
      const { data: current } = await dbAdmin
        .from('tenant_discoveries')
        .select('approval_proof_r2_key, pm_user_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!current) return reply.status(404).send({ message: 'Discovery não inicializada.' });
      if (!current.approval_proof_r2_key) {
        return reply.status(409).send({ message: 'approvalProofR2Key ausente. Faça upload do print de aprovação antes.' });
      }
      if (!current.pm_user_id) {
        return reply.status(409).send({ message: 'pmUserId ausente. Atribua responsável antes de aprovar.' });
      }
      const { data: updated, error } = await dbAdmin
        .from('tenant_discoveries')
        .update({ status: DiscoveryStatus.APPROVED, approved_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      return reply.send({ data: serializeDiscovery(updated) });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/approve → POST failed');
      return reply.status(500).send({ message: 'Falha ao aprovar discovery.' });
    }
  });

  // —
  // POST /promote — cria Script records + atualiza Tenant.aiVoiceProfile + AuditLog
  // —
  const promoteBodySchema = z.object({
    actorUserId: z.string().uuid().optional(),
  });

  const SEGMENT_TO_PROFESSION: Record<'medicos' | 'advogados' | 'empresarios', string> = {
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
      const { data: discovery } = await dbAdmin
        .from('tenant_discoveries')
        .select('status, voice_profile_draft, scripts_draft, approval_proof_r2_key, pm_user_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!discovery) return reply.status(404).send({ message: 'Discovery não inicializada.' });

      const gates = evaluateQualityGates(discovery);
      if (!gates.allOk) {
        return reply.status(409).send({ message: 'Gates de promoção não atendidos.', blockingReasons: gates.blockingReasons });
      }

      const scriptsDraft = discovery.scripts_draft as Record<string, { initial_message_variations?: string[]; nodes?: unknown[] }>;

      // Execute sequential operations (no client-side transaction in Supabase)

      // Update tenant voice profile
      const { error: tenantErr } = await dbAdmin
        .from('tenants')
        .update({ ai_voice_profile: discovery.voice_profile_draft as any })
        .eq('id', tenantId);
      if (tenantErr) throw tenantErr;

      const createdScripts: string[] = [];
      for (const segmentKey of ['medicos', 'advogados', 'empresarios'] as const) {
        const seg = scriptsDraft[segmentKey];
        if (!seg) continue;
        const baseMessage = seg.initial_message_variations?.[0] ?? null;
        const { data: created, error: scriptErr } = await dbAdmin
          .from('scripts')
          .insert({
            id: randomUUID(),
            tenant_id: tenantId,
            name: `Discovery — ${segmentKey}`,
            category: ScriptCategory.APPROACH,
            target_profession: SEGMENT_TO_PROFESSION[segmentKey] as any,
            status: ScriptStatus.ACTIVE,
            flow: seg as any,
            base_message: baseMessage,
            updated_at: new Date().toISOString(),
          } as any)
          .select('id')
          .single();
        if (scriptErr) throw scriptErr;

        if (seg.initial_message_variations && seg.initial_message_variations.length > 1) {
          const variations = seg.initial_message_variations.slice(1, 4).map((message, index) => ({
            id: randomUUID(),
            tenant_id: tenantId,
            script_id: created.id,
            variant_letter: String.fromCharCode(66 + index), // 'B', 'C', 'D'
            message,
            updated_at: new Date().toISOString(),
          }));
          if (variations.length > 0) {
            const { error: varErr } = await dbAdmin.from('script_variations').insert(variations);
            if (varErr) throw varErr;
          }
        }
        createdScripts.push(created.id);
      }

      // Audit log
      await dbAdmin.from('audit_log').insert({
        tenant_id: tenantId,
        user_id: actorUserId ?? discovery.pm_user_id,
        action: 'discovery.promote',
        target_type: 'TenantDiscovery',
        target_id: tenantId,
        payload: {
          scriptsCreated: createdScripts,
          voiceProfileApplied: true,
          gatesSnapshot: gates,
        } as any,
      });

      return reply.send({
        data: { tenantId, scriptsCreated: createdScripts, aiVoiceProfileUpdated: true, gates },
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'admin/discovery/promote → POST failed');
      return reply.status(500).send({ message: 'Falha ao promover discovery.' });
    }
  });

  app.get('/tenants/:id/discovery/materials/:kind/download', async (req: FastifyRequest, reply: FastifyReply) => {
    const paramsParsed = z
      .object({ id: z.string().uuid(), kind: materialKindSchema })
      .safeParse(req.params);
    if (!paramsParsed.success) return reply.status(400).send({ message: 'Parâmetros inválidos.' });
    const tenantId = paramsParsed.data.id;
    const kind = paramsParsed.data.kind;
    const column = KIND_TO_COLUMN[kind];
    try {
      const { data: discovery } = await dbAdmin
        .from('tenant_discoveries')
        .select(column)
        .eq('tenant_id', tenantId)
        .single();
      const currentKey = (discovery as Record<string, string | null> | null)?.[column];
      if (!currentKey) return reply.status(404).send({ message: 'Material não encontrado.' });

      // Try R2 first
      if (isR2Configured()) {
        const { presignedUrl, expiresAt } = await regenerateR2PresignedUrl(currentKey);
        return reply.send({ data: { key: currentKey, downloadUrl: presignedUrl, expiresAt: expiresAt.toISOString() } });
      }

      // Local filesystem: serve file directly or return public URL
      const filePath = getFilePath(currentKey);
      try {
        const fileBuffer = await import('fs/promises').then(fs => fs.readFile(filePath));
        const ext = currentKey.split('.').pop() ?? 'bin';
        const mimeMap: Record<string, string> = { mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', txt: 'text/plain' };
        reply.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
        reply.header('Content-Disposition', `inline; filename="${currentKey.split('/').pop()}"`);
        return reply.send(fileBuffer);
      } catch {
        return reply.status(404).send({ message: 'Arquivo não encontrado no filesystem.' });
      }
    } catch (err) {
      logger.error({ err, tenantId, kind }, 'admin/discovery/materials → download failed');
      return reply.status(500).send({ message: 'Falha ao gerar URL de download.' });
    }
  });
}
