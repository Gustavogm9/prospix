import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireRole } from '../../middlewares/auth.js';
import { generateInvitationCode } from '../../services/invitation-service.js';
import { tenantContextStorage } from '../../lib/tenant-context-storage.js';
import { env } from '../../config/env.js';
import { Prisma, TenantStatus, TenantPlan, UserRole, CampaignStatus, BillingStatus } from '@prisma/client';
import { registerAdminDlqRoutes } from './dlq.js';
import { registerAdminObservabilityRoutes } from './observability.js';
import { registerAdminDiscoveryRoutes } from './discovery.js';
import { registerAdminFeatureFlagsRoutes } from './feature-flags.js';
import { registerAdminAlertsRoutes } from './alerts.js';
import { registerAdminActivityRoutes } from './activity.js';
import { registerAdminUserRoutes } from './users.js';
import { registerAdminImpersonationRoutes } from './impersonation.js';
import { registerAdminConversationsRoutes } from './conversations.js';
import { registerAdminLeadsRoutes } from './leads.js';
import { registerAdminPipelineRoutes } from './pipeline.js';
import { registerAdminMeetingsRoutes } from './meetings.js';
import { registerAdminCampaignsRoutes } from './campaigns.js';
import { registerAdminReferralsRoutes } from './referrals.js';
import { registerAdminLeadSourcesRoutes } from './lead-sources.js';
import { registerAdminPerformanceRoutes } from './performance.js';

type AdminTransaction = Prisma.TransactionClient;

type TenantWithCredentialRecord = Prisma.TenantGetPayload<{
  include: {
    users: { select: { id: true; name: true; email: true; role: true } };
    secret: {
      select: {
        evolutionBaseUrl: true;
        evolutionInstanceName: true;
        evolutionApiKeyEncrypted: true;
        evolutionWebhookSecret: true;
        googleCalendarId: true;
        googleOauthRefreshEncrypted: true;
        googleOauthScope: true;
        googleMapsApiKeyEncrypted: true;
        openaiApiKeyEncrypted: true;
        anthropicApiKeyEncrypted: true;
        googleAiApiKeyEncrypted: true;
        aiProvider: true;
        twilioAccountSidEncrypted: true;
        twilioAuthTokenEncrypted: true;
        updatedAt: true;
      };
    };
  };
}>;

function withAdminRole<TResult>(operation: (tx: AdminTransaction) => Promise<TResult>): Promise<TResult> {
  const store = tenantContextStorage.getStore();

  return tenantContextStorage.run(
    {
      tenantId: store?.tenantId ?? null,
      userId: store?.userId ?? null,
      bypassRls: true,
    },
    () => operation(prisma as unknown as AdminTransaction)
  );
}

function buildIntegrationHealth(tenant: Pick<TenantWithCredentialRecord, 'status' | 'secret'>) {
  const secret = tenant.secret;
  const checks = {
    whatsappGatewayConfigured: Boolean(
      secret?.evolutionBaseUrl &&
      secret.evolutionInstanceName &&
      secret.evolutionApiKeyEncrypted &&
      secret.evolutionWebhookSecret
    ),
    googleCalendarConnected: Boolean(secret?.googleCalendarId && secret.googleOauthRefreshEncrypted),
    googleMapsConfigured: Boolean(secret?.googleMapsApiKeyEncrypted),
    aiConfigured: Boolean(
      !secret ||
      secret.aiProvider === 'GUILDS_SHARED' ||
      secret.openaiApiKeyEncrypted ||
      secret.anthropicApiKeyEncrypted ||
      secret.googleAiApiKeyEncrypted
    ),
  };

  const missing = [
    !checks.whatsappGatewayConfigured ? 'WhatsApp/Evolution' : null,
    !checks.googleCalendarConnected ? 'Google Calendar' : null,
    !checks.googleMapsConfigured ? 'Google Maps' : null,
    !checks.aiConfigured ? 'IA do tenant' : null,
  ].filter(Boolean) as string[];

  let status: 'excellent' | 'good' | 'fair' | 'critical' = 'excellent';
  if (tenant.status === TenantStatus.SUSPENDED || tenant.status === TenantStatus.CHURNED || !checks.whatsappGatewayConfigured) {
    status = 'critical';
  } else if (tenant.status === TenantStatus.CHURNING || missing.length >= 2) {
    status = 'fair';
  } else if (missing.length === 1) {
    status = 'good';
  }

  return {
    status,
    checks,
    missing,
  };
}

function toAdminTenantDetail(tenant: TenantWithCredentialRecord) {
  const { secret, ...safeTenant } = tenant;

  return {
    ...safeTenant,
    integrationHealth: buildIntegrationHealth(tenant),
    credentialState: secret
      ? {
        exists: true,
        evolution: {
          baseUrlConfigured: Boolean(secret.evolutionBaseUrl),
          instanceConfigured: Boolean(secret.evolutionInstanceName),
          tokenConfigured: Boolean(secret.evolutionApiKeyEncrypted),
          webhookConfigured: Boolean(secret.evolutionWebhookSecret),
        },
        google: {
          calendarConfigured: Boolean(secret.googleCalendarId),
          oauthConnected: Boolean(secret.googleOauthRefreshEncrypted),
          oauthScope: secret.googleOauthScope,
          mapsConfigured: Boolean(secret.googleMapsApiKeyEncrypted),
        },
        ai: {
          provider: secret.aiProvider,
          openaiConfigured: Boolean(secret.openaiApiKeyEncrypted),
          anthropicConfigured: Boolean(secret.anthropicApiKeyEncrypted),
          googleConfigured: Boolean(secret.googleAiApiKeyEncrypted),
        },
        telephony: {
          accountConfigured: Boolean(secret.twilioAccountSidEncrypted),
          tokenConfigured: Boolean(secret.twilioAuthTokenEncrypted),
        },
        updatedAt: secret.updatedAt,
      }
      : {
        exists: false,
        evolution: {
          baseUrlConfigured: false,
          instanceConfigured: false,
          tokenConfigured: false,
          webhookConfigured: false,
        },
        google: {
          calendarConfigured: false,
          oauthConnected: false,
          oauthScope: null,
          mapsConfigured: false,
        },
        ai: {
          provider: null,
          openaiConfigured: false,
          anthropicConfigured: false,
          googleConfigured: false,
        },
        telephony: {
          accountConfigured: false,
          tokenConfigured: false,
        },
        updatedAt: null,
      },
  };
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // Enforce GUILDS_ADMIN role for all admin endpoints
  app.addHook('preHandler', requireRole(['GUILDS_ADMIN']));

  // DLQ admin endpoints (AUD-P1-021)
  registerAdminDlqRoutes(app);
  registerAdminObservabilityRoutes(app);
  registerAdminDiscoveryRoutes(app);
  registerAdminFeatureFlagsRoutes(app);
  registerAdminAlertsRoutes(app);
  registerAdminActivityRoutes(app);
  registerAdminUserRoutes(app);
  registerAdminImpersonationRoutes(app);
  registerAdminConversationsRoutes(app);
  registerAdminLeadsRoutes(app);
  registerAdminPipelineRoutes(app);
  registerAdminMeetingsRoutes(app);
  registerAdminCampaignsRoutes(app);
  registerAdminReferralsRoutes(app);
  registerAdminLeadSourcesRoutes(app);
  registerAdminPerformanceRoutes(app);

  // =============================================================================
  // D8: CRUD /v1/admin/tenants
  // =============================================================================

  // GET /tenants (List tenants)
  app.get('/tenants', async (_req, reply) => {
    const tenants = await withAdminRole((tx) => tx.tenant.findMany({
      where: { deletedAt: null },
      include: {
        users: {
          where: { role: 'OWNER' },
          select: { id: true, name: true, email: true, whatsapp: true },
        },
        secret: {
          select: {
            evolutionBaseUrl: true,
            evolutionInstanceName: true,
            evolutionApiKeyEncrypted: true,
            evolutionWebhookSecret: true,
            googleCalendarId: true,
            googleOauthRefreshEncrypted: true,
            googleMapsApiKeyEncrypted: true,
            openaiApiKeyEncrypted: true,
            anthropicApiKeyEncrypted: true,
            googleAiApiKeyEncrypted: true,
            aiProvider: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }));
    const tenantsWithHealth = tenants.map((tenant) => {
      const { secret: _secret, ...safeTenant } = tenant;
      void _secret;
      return {
        ...safeTenant,
        integrationHealth: buildIntegrationHealth(tenant as Pick<TenantWithCredentialRecord, 'status' | 'secret'>),
      };
    });

    return reply.send({ data: tenantsWithHealth });
  });

  // GET /tenants/:id (Get tenant detail)
  app.get('/tenants/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenant = await withAdminRole((tx) => tx.tenant.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true } },
        secret: {
          select: {
            evolutionBaseUrl: true,
            evolutionInstanceName: true,
            evolutionApiKeyEncrypted: true,
            evolutionWebhookSecret: true,
            googleCalendarId: true,
            googleOauthRefreshEncrypted: true,
            googleOauthScope: true,
            googleMapsApiKeyEncrypted: true,
            openaiApiKeyEncrypted: true,
            anthropicApiKeyEncrypted: true,
            googleAiApiKeyEncrypted: true,
            aiProvider: true,
            twilioAccountSidEncrypted: true,
            twilioAuthTokenEncrypted: true,
            updatedAt: true,
          },
        },
      },
    }));

    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({ data: toAdminTenantDetail(tenant) });
  });

  // POST /tenants (Create tenant - onboarding wizard)
  const createTenantSchema = z.object({
    name: z.string().min(1, 'Tenant name is required'),
    slug: z.string().min(1, 'Tenant slug is required').max(64),
    segment: z.string().optional().default('insurance_other'),
    plan: z.nativeEnum(TenantPlan).default(TenantPlan.STANDARD),
    mrrCents: z.coerce.number().default(15000),
    ownerName: z.string().optional(),
    ownerEmail: z.string().email().optional(),
    ownerWhatsapp: z.string().optional(),
  });

  app.post('/tenants', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseRes = createTenantSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const data = parseRes.data;

    const tenant = await withAdminRole(async (tx) => {
      const collision = await tx.tenant.findUnique({ where: { slug: data.slug } });
      if (collision) {
        return null;
      }

      const newTenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          segment: data.segment,
          status: TenantStatus.ONBOARDING,
          plan: data.plan,
          mrrCents: data.mrrCents,
        },
      });

      await tx.tenantSecret.create({
        data: {
          tenantId: newTenant.id,
          evolutionInstanceName: `tenant_${data.slug.replace(/[^a-zA-Z0-9]/g, '')}`,
        },
      });

      await tx.tenantAIConfig.create({
        data: {
          tenantId: newTenant.id,
          systemModel: 'gpt-4o-mini',
          classifierModel: 'gpt-4o-mini',
          guardrailModel: 'gpt-4o-mini',
        },
      });

      if (data.ownerEmail && data.ownerName && data.ownerWhatsapp) {
        await tx.user.create({
          data: {
            tenantId: newTenant.id,
            role: UserRole.OWNER,
            name: data.ownerName,
            email: data.ownerEmail,
            whatsapp: data.ownerWhatsapp,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'tenant.create',
          targetType: 'tenant',
          targetId: newTenant.id,
          payload: { slug: data.slug, plan: data.plan },
        },
      });

      return newTenant;
    });

    if (!tenant) {
      return reply.code(409).send({ error: 'Conflict', message: 'Tenant slug already exists' });
    }

    return reply.code(201).send(tenant);
  });

  // PATCH /tenants/:id (Update tenant)
  const updateTenantSchema = z.object({
    name: z.string().optional(),
    plan: z.nativeEnum(TenantPlan).optional(),
    mrrCents: z.number().int().optional(),
    status: z.nativeEnum(TenantStatus).optional(),
  });

  app.patch('/tenants/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parseRes = updateTenantSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const updated = await withAdminRole(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return null;
      }

      const result = await tx.tenant.update({
        where: { id },
        data: parseRes.data,
      });

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'tenant.update',
          targetType: 'tenant',
          targetId: id,
          payload: parseRes.data as any,
        },
      });

      return result;
    });

    if (!updated) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({ data: updated });
  });

  // =============================================================================
  // D8: SUSPEND / RESUME / CHURN TENANTS
  // =============================================================================

  // POST /tenants/:id/suspend
  app.post('/tenants/:id/suspend', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const suspended = await withAdminRole(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return false;
      }

      // 1. Suspend tenant
      await tx.tenant.update({
        where: { id },
        data: { status: TenantStatus.SUSPENDED },
      });

      // 2. Pause all campaigns
      await tx.campaign.updateMany({
        where: { tenantId: id, status: CampaignStatus.ACTIVE },
        data: { status: CampaignStatus.PAUSED },
      });

      // 3. Log Audit
      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'tenant.suspend',
          targetType: 'tenant',
          targetId: id,
          payload: { previous_status: tenant.status },
        },
      });

      return true;
    });

    if (!suspended) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({ success: true, message: 'Tenant suspended and campaigns paused successfully' });
  });

  // POST /tenants/:id/resume
  app.post('/tenants/:id/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const resumed = await withAdminRole(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return false;
      }

      await tx.tenant.update({
        where: { id },
        data: { status: TenantStatus.ACTIVE },
      });

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'tenant.resume',
          targetType: 'tenant',
          targetId: id,
          payload: { previous_status: tenant.status },
        },
      });

      return true;
    });

    if (!resumed) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({ success: true, message: 'Tenant re-activated successfully' });
  });

  // POST /tenants/:id/churn
  app.post('/tenants/:id/churn', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const churned = await withAdminRole(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) {
        return false;
      }

      // Mark as churning
      await tx.tenant.update({
        where: { id },
        data: { status: TenantStatus.CHURNING },
      });

      // Pause campaigns
      await tx.campaign.updateMany({
        where: { tenantId: id, status: CampaignStatus.ACTIVE },
        data: { status: CampaignStatus.PAUSED },
      });

      // Schedule soft delete for 7 days in the future (grace period)
      const graceDate = new Date();
      graceDate.setDate(graceDate.getDate() + 7);

      // Audit Log
      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'tenant.churn',
          targetType: 'tenant',
          targetId: id,
          payload: { previous_status: tenant.status, grace_period_until: graceDate },
        },
      });

      return true;
    });

    if (!churned) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({ success: true, message: 'Tenant churn initiated. 7 days grace period started.' });
  });

  // =============================================================================
  // D8: GATED INVITATIONS
  // =============================================================================

  // POST /tenants/:id/invitations
  app.post('/tenants/:id/invitations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: tenantId } = req.params as { id: string };
    const { notes } = (req.body || {}) as { notes?: string };
    const createdBy = req.userId || '';

    const result = await withAdminRole(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' };
      }

      const activeInvitation = await tx.tenantInvitation.findFirst({
        where: {
          tenantId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (activeInvitation) {
        return {
          ok: false as const,
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'This tenant already has an active invitation code.',
        };
      }

      let code = generateInvitationCode();
      let collision = await tx.tenantInvitation.findUnique({ where: { code } });
      while (collision) {
        code = generateInvitationCode();
        collision = await tx.tenantInvitation.findUnique({ where: { code } });
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + env.INVITATION_CODE_TTL_DAYS);

      const invitation = await tx.tenantInvitation.create({
        data: {
          code,
          tenantId,
          role: 'OWNER',
          createdById: createdBy,
          expiresAt,
          notes,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'tenant.invitation_created',
          targetType: 'tenant',
          targetId: tenantId,
          payload: { code: invitation.code },
        },
      });

      return { ok: true as const, value: invitation };
    });

    if (!result.ok) {
      return reply.code(result.status).send({ error: result.code, message: result.message });
    }

    return reply.code(201).send(result.value);
  });

  // GET /tenants/:id/invitations (List invitations)
  app.get('/tenants/:id/invitations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: tenantId } = req.params as { id: string };
    const invitations = await withAdminRole((tx) => tx.tenantInvitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }));
    return reply.send({ data: invitations });
  });

  // DELETE /tenants/:id/invitations/:invitationId (Revoke invitation)
  app.delete('/tenants/:id/invitations/:invitationId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: tenantId, invitationId } = req.params as { id: string; invitationId: string };

    const result = await withAdminRole(async (tx) => {
      const invitation = await tx.tenantInvitation.findFirst({
        where: { id: invitationId, tenantId },
      });

      if (!invitation) {
        return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Invitation not found.' };
      }

      if (invitation.usedAt) {
        return {
          ok: false as const,
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Cannot revoke an invitation that has already been used.',
        };
      }

      const updated = await tx.tenantInvitation.update({
        where: { id: invitationId },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'tenant.invitation_revoked',
          targetType: 'tenant',
          targetId: tenantId,
          payload: { invitation_id: invitationId },
        },
      });

      return { ok: true as const, value: updated };
    });

    if (!result.ok) {
      return reply.code(result.status).send({ error: result.code, message: result.message });
    }

    return reply.send(result.value);
  });

  // =============================================================================
  // D9: SUPER-ADMIN USAGE CONSOLIDATION & BILLING
  // =============================================================================

  // GET /usage/consolidated
  // GET /tenants/:id/insights · counts + usage 3m + billing history para o Tenant Detail Page
  app.get('/tenants/:id/insights', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);

      const insights = await withAdminRole(async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id }, select: { id: true } });
        if (!tenant) return null;

        const [leadsCount, conversationsActive, conversationsTotal, scriptsActive, lgpdPending, meetingsScheduled, usageRecords, billingHistory] = await Promise.all([
          tx.lead.count({ where: { tenantId: id, deletedAt: null } }),
          tx.conversation.count({ where: { tenantId: id, status: 'ACTIVE' } }),
          tx.conversation.count({ where: { tenantId: id } }),
          tx.script.count({ where: { tenantId: id, status: 'ACTIVE', archivedAt: null } }),
          tx.lgpdRequest.count({ where: { tenantId: id, status: { in: ['PENDING', 'PROCESSING'] } } }),
          tx.meeting.count({ where: { tenantId: id, status: 'SCHEDULED' } }),
          tx.tenantUsage.findMany({
            where: { tenantId: id, periodMonth: { gte: threeMonthsAgo } },
            orderBy: { periodMonth: 'asc' },
          }),
          tx.tenantBilling.findMany({
            where: { tenantId: id },
            orderBy: { dueAt: 'desc' },
            take: 6,
          }),
        ]);

        return { leadsCount, conversationsActive, conversationsTotal, scriptsActive, lgpdPending, meetingsScheduled, usageRecords, billingHistory };
      });

      if (!insights) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
      }

      return reply.send({
        data: {
          counts: {
            leads: insights.leadsCount,
            conversationsActive: insights.conversationsActive,
            conversationsTotal: insights.conversationsTotal,
            scriptsActive: insights.scriptsActive,
            lgpdPending: insights.lgpdPending,
            meetingsScheduled: insights.meetingsScheduled,
          },
          usage3m: insights.usageRecords.map((u) => ({
            periodMonth: u.periodMonth.toISOString().slice(0, 7),
            llmCostCents: Number(u.llmCostCents),
            whatsappCostCents: Number(u.whatsappCostCents),
            googleMapsCostCents: Number(u.googleMapsCostCents),
            totalCostCents: Number(u.llmCostCents) + Number(u.whatsappCostCents) + Number(u.googleMapsCostCents),
            llmTokensInput: Number(u.llmTokensInput),
            llmTokensOutput: Number(u.llmTokensOutput),
            whatsappMessagesSent: Number(u.whatsappMessagesSent),
          })),
          billing: insights.billingHistory.map((b) => ({
            id: b.id,
            periodMonth: b.periodMonth.toISOString().slice(0, 7),
            totalCents: b.totalCents,
            status: b.status,
            dueAt: b.dueAt.toISOString(),
            paidAt: b.paidAt?.toISOString() ?? null,
          })),
        },
      });
    } catch (err) {
      app.log.error({ err, tenantId: id }, 'admin/tenants/:id/insights failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular insights do tenant.' });
    }
  });

  // GET /search · busca universal por nome/slug/email/telefone → tenant/user/lead
  const searchQuerySchema = z.object({
    q: z.string().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(20).optional().default(10),
  });

  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Query "q" mínimo 2 chars.' });
    const { q, limit } = parsed.data;
    const term = q.trim();
    try {
      const [tenants, users, leads] = await withAdminRole(async (tx) => {
        return Promise.all([
          tx.tenant.findMany({
            where: {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { slug: { contains: term, mode: 'insensitive' } },
              ],
            },
            take: limit,
            select: { id: true, name: true, slug: true, status: true },
          }),
          tx.user.findMany({
            where: {
              OR: [
                { email: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
              ],
              deletedAt: null,
            },
            take: limit,
            select: { id: true, name: true, email: true, role: true, tenantId: true, tenant: { select: { name: true, slug: true } } },
          }),
          tx.lead.findMany({
            where: {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { whatsapp: { contains: term } },
                { email: { contains: term, mode: 'insensitive' } },
              ],
              deletedAt: null,
            },
            take: limit,
            select: { id: true, name: true, whatsapp: true, email: true, tenantId: true, tenant: { select: { name: true, slug: true } } },
          }),
        ]);
      });

      return reply.send({
        data: {
          tenants: tenants.map((t) => ({ kind: 'tenant', id: t.id, label: t.name, sub: `slug: ${t.slug} · ${t.status}`, href: `/tenants/${t.id}` })),
          users: users.map((u) => ({ kind: 'user', id: u.id, label: u.name, sub: `${u.email} · ${u.role} · ${u.tenant?.name ?? '—'}`, href: `/tenants/${u.tenantId}` })),
          leads: leads.map((l) => ({ kind: 'lead', id: l.id, label: l.name ?? l.whatsapp, sub: `${l.whatsapp} · ${l.email ?? ''} · ${l.tenant?.name ?? '—'}`, href: `/tenants/${l.tenantId}` })),
        },
      });
    } catch (err) {
      app.log.error({ err, q }, 'admin/search failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha na busca.' });
    }
  });

  // GET /churn-risk · score heurístico cross-tenant (uso declining + billing overdue + dormancy)
  app.get('/churn-risk', async (_req, reply) => {
    try {
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);

      const tenants = await withAdminRole(async (tx) => {
        const activeTenants = await tx.tenant.findMany({
          where: { status: { in: ['ACTIVE', 'CHURNING'] }, deletedAt: null },
          select: { id: true, name: true, slug: true, status: true, mrrCents: true, plan: true, goLiveAt: true },
        });

        const enriched = await Promise.all(
          activeTenants.map(async (t) => {
            const [currentUsage, prevUsage, overdueBilling, lastConversation, activeCampaigns] = await Promise.all([
              tx.tenantUsage.findFirst({ where: { tenantId: t.id, periodMonth: startOfMonth } }),
              tx.tenantUsage.findFirst({ where: { tenantId: t.id, periodMonth: startOfPrevMonth } }),
              tx.tenantBilling.count({ where: { tenantId: t.id, status: 'OVERDUE' } }),
              tx.conversation.findFirst({
                where: { tenantId: t.id },
                orderBy: { startedAt: 'desc' },
                select: { startedAt: true, lastInboundAt: true, lastOutboundAt: true },
              }),
              tx.campaign.count({ where: { tenantId: t.id, status: 'ACTIVE', updatedAt: { gte: sixtyDaysAgo } } }),
            ]);

            const currentMsgs = currentUsage ? Number(currentUsage.whatsappMessagesSent) : 0;
            const prevMsgs = prevUsage ? Number(prevUsage.whatsappMessagesSent) : 0;
            const usageDeltaPercent = prevMsgs > 0 ? Math.round(((currentMsgs - prevMsgs) / prevMsgs) * 100) : 0;
            const lastActivity = lastConversation
              ? (lastConversation.lastInboundAt ?? lastConversation.lastOutboundAt ?? lastConversation.startedAt)
              : null;
            const dormantDays = lastActivity ? Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)) : 999;

            // Score 0-100 (maior = mais arriscado)
            let score = 0;
            const reasons: string[] = [];
            if (overdueBilling > 0) {
              score += 40;
              reasons.push(`${overdueBilling} fatura(s) vencida(s)`);
            }
            if (usageDeltaPercent <= -30 && prevMsgs > 0) {
              score += 25;
              reasons.push(`uso WA caiu ${Math.abs(usageDeltaPercent)}% MoM`);
            }
            if (dormantDays > 30) {
              score += 25;
              reasons.push(`${dormantDays}d sem conversa nova`);
            } else if (dormantDays > 14) {
              score += 10;
              reasons.push(`${dormantDays}d sem conversa nova`);
            }
            if (activeCampaigns === 0) {
              score += 10;
              reasons.push('sem campanhas ativas');
            }
            if (t.status === 'CHURNING') {
              score = Math.max(score, 80);
              reasons.unshift('marcado CHURNING');
            }

            const level: 'low' | 'medium' | 'high' | 'critical' = score >= 70 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';

            return {
              tenantId: t.id,
              tenantName: t.name,
              tenantSlug: t.slug,
              status: t.status,
              mrrCents: t.mrrCents,
              plan: t.plan,
              score,
              level,
              reasons,
              signals: {
                overdueInvoices: overdueBilling,
                usageDeltaPercent,
                dormantDays: dormantDays >= 999 ? null : dormantDays,
                activeCampaigns,
              },
            };
          })
        );

        return enriched.sort((a, b) => b.score - a.score);
      });

      const summary = tenants.reduce(
        (acc, t) => {
          acc[t.level] = (acc[t.level] ?? 0) + 1;
          return acc;
        },
        { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>,
      );

      return reply.send({ data: { tenants, summary, generatedAt: now.toISOString() } });
    } catch (err) {
      app.log.error({ err }, 'admin/churn-risk failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular churn risk.' });
    }
  });

  // GET /lgpd-requests · cross-tenant compliance view
  const lgpdQuerySchema = z.object({
    status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELED']).optional(),
    type: z.enum(['EXPORT_DATA', 'DELETE_TENANT_DATA', 'DELETE_LEAD_DATA', 'CORRECT_DATA', 'CONFIRM_DATA']).optional(),
    tenantId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    offset: z.coerce.number().int().min(0).optional().default(0),
  });

  app.get('/lgpd-requests', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = lgpdQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { status, type, tenantId, limit, offset } = parsed.data;
    try {
      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (type) where.type = type;
      if (tenantId) where.tenantId = tenantId;

      const [items, total, statusCounts] = await withAdminRole(async (tx) => {
        return Promise.all([
          tx.lgpdRequest.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
            include: {
              tenant: { select: { id: true, name: true, slug: true } },
              requestedByUser: { select: { id: true, name: true, email: true } },
              processedBy: { select: { id: true, name: true, email: true } },
            },
          }),
          tx.lgpdRequest.count({ where }),
          tx.lgpdRequest.groupBy({
            by: ['status'],
            _count: { status: true },
          }),
        ]);
      });

      const counts: Record<string, number> = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, REJECTED: 0, CANCELED: 0 };
      for (const c of statusCounts) counts[c.status] = c._count.status;

      return reply.send({
        data: {
          items: items.map((r) => ({
            id: r.id,
            tenantId: r.tenantId,
            tenant: r.tenant,
            type: r.type,
            status: r.status,
            scope: r.scope,
            requestedByUser: r.requestedByUser,
            requestedByLead: r.requestedByLead,
            rejectionReason: r.rejectionReason,
            processedBy: r.processedBy,
            processedAt: r.processedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            downloadExpiresAt: r.downloadExpiresAt?.toISOString() ?? null,
          })),
          pagination: { total, limit, offset, hasMore: offset + items.length < total },
          statusCounts: counts,
        },
      });
    } catch (err) {
      app.log.error({ err }, 'admin/lgpd-requests failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao listar requisições LGPD.' });
    }
  });

  // GET /audit-logs · viewer cross-tenant com filtros (action/tenant/date range/user)
  const auditLogsQuerySchema = z.object({
    action: z.string().min(1).max(128).optional(),
    tenantId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    offset: z.coerce.number().int().min(0).optional().default(0),
  });

  app.get('/audit-logs', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = auditLogsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Query inválida.', issues: parsed.error.issues });
    }
    const { action, tenantId, userId, from, to, limit, offset } = parsed.data;
    try {
      const where: Record<string, unknown> = {};
      if (action) where.action = action;
      if (tenantId) where.tenantId = tenantId;
      if (userId) where.userId = userId;
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) range.gte = new Date(from);
        if (to) range.lte = new Date(to);
        where.createdAt = range;
      }

      const [logs, total, distinctActions] = await withAdminRole(async (tx) => {
        return Promise.all([
          tx.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
            include: {
              tenant: { select: { id: true, name: true, slug: true } },
              user: { select: { id: true, name: true, email: true, role: true } },
            },
          }),
          tx.auditLog.count({ where }),
          tx.auditLog.findMany({
            distinct: ['action'],
            select: { action: true },
            orderBy: { action: 'asc' },
            take: 100,
          }),
        ]);
      });

      return reply.send({
        data: {
          items: logs.map((l) => ({
            id: l.id.toString(),
            tenantId: l.tenantId,
            tenant: l.tenant ? { id: l.tenant.id, name: l.tenant.name, slug: l.tenant.slug } : null,
            userId: l.userId,
            user: l.user ? { id: l.user.id, name: l.user.name, email: l.user.email, role: l.user.role } : null,
            action: l.action,
            targetType: l.targetType,
            targetId: l.targetId,
            payload: l.payload,
            ipAddress: l.ipAddress,
            userAgent: l.userAgent,
            createdAt: l.createdAt.toISOString(),
          })),
          pagination: { total, limit, offset, hasMore: offset + logs.length < total },
          knownActions: distinctActions.map((a) => a.action),
        },
      });
    } catch (err) {
      app.log.error({ err }, 'admin/audit-logs failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao buscar audit logs.' });
    }
  });

  app.get('/usage/consolidated', async (_req, reply) => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usageRecords = await withAdminRole((tx) => tx.tenantUsage.findMany({
      where: { periodMonth: startOfMonth },
      include: {
        tenant: { select: { id: true, name: true, mrrCents: true, plan: true } },
      },
    }));

    const report = usageRecords.map((rec) => {
      const llmCost = Number(rec.llmCostCents);
      const whatsappCost = Number(rec.whatsappCostCents);
      const mapsCost = Number(rec.googleMapsCostCents);
      const totalCost = llmCost + whatsappCost + mapsCost;
      const mrr = rec.tenant.mrrCents;
      const margin = mrr - totalCost;
      const profitMarginPercent = mrr > 0 ? (margin / mrr) * 100 : 0;

      return {
        tenant_id: rec.tenantId,
        tenant_name: rec.tenant.name,
        plan: rec.tenant.plan,
        mrr_cents: mrr,
        llm_cost_cents: llmCost,
        whatsapp_cost_cents: whatsappCost,
        maps_cost_cents: mapsCost,
        total_costs_cents: totalCost,
        margin_cents: margin,
        margin_percent: Number(profitMarginPercent.toFixed(1)),
      };
    });

    return reply.send({ data: report });
  });

  // GET /billing (List overdue or pending billings)
  app.get('/billing', async (_req, reply) => {
    const billings = await withAdminRole((tx) => tx.tenantBilling.findMany({
      where: {
        status: { in: [BillingStatus.PENDING, BillingStatus.OVERDUE] },
      },
      include: {
        tenant: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
    }));
    return reply.send({ data: billings });
  });

  // PATCH /billing/:id/pay (Confirm manual/offline payment)
  app.patch('/billing/:id/pay', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const updatedBilling = await withAdminRole(async (tx) => {
      const billing = await tx.tenantBilling.findUnique({
        where: { id },
        include: { tenant: true },
      });

      if (!billing) {
        return null;
      }

      // 1. Mark as PAID
      const updated = await tx.tenantBilling.update({
        where: { id },
        data: { status: BillingStatus.PAID, paidAt: new Date(), paymentMethod: 'manual_offline' },
      });

      // 2. Reactivate tenant if suspended
      if (billing.tenant.status === TenantStatus.SUSPENDED) {
        await tx.tenant.update({
          where: { id: billing.tenantId },
          data: { status: TenantStatus.ACTIVE },
        });
      }

      // 3. Log Audit
      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'billing.pay_manual',
          targetType: 'tenant_billing',
          targetId: id,
          payload: { amount_cents: billing.totalCents, tenant_id: billing.tenantId },
        },
      });

      return updated;
    });

    if (!updatedBilling) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Billing record not found' });
    }

    return reply.send({ data: updatedBilling });
  });

  // =============================================================================
  // D10: MASTER TEMPLATES CRUD
  // =============================================================================

  // GET /templates (List templates)
  app.get('/templates', async (_req, reply) => {
    const templates = await withAdminRole((tx) => tx.scriptTemplate.findMany({
      where: { active: true },
      orderBy: { popularity: 'desc' },
    }));
    return reply.send({ data: templates });
  });

  // POST /templates (Create template)
  const templateSchema = z.object({
    name: z.string().min(1),
    segment: z.string(),
    category: z.any(), // ScriptCategory
    targetProfession: z.any().optional(),
    flowTemplate: z.any(),
    baseMessageTemplate: z.string().optional(),
    variables: z.array(z.string()).default([]),
    description: z.string().optional(),
  });

  app.post('/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseRes = templateSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const data = parseRes.data;

    const template = await withAdminRole((tx) => tx.scriptTemplate.create({
      data: {
        name: data.name,
        segment: data.segment,
        category: data.category,
        targetProfession: data.targetProfession,
        flowTemplate: JSON.stringify(data.flowTemplate),
        baseMessageTemplate: data.baseMessageTemplate,
        variables: data.variables,
        description: data.description,
        active: true,
      },
    }));

    return reply.code(201).send({ data: template });
  });

  // PATCH /templates/:id (Update template)
  const updateTemplateSchema = z.object({
    name: z.string().optional(),
    segment: z.string().optional(),
    category: z.any().optional(),
    flowTemplate: z.any().optional(),
    baseMessageTemplate: z.string().optional(),
    variables: z.array(z.string()).optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
  });

  app.patch('/templates/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parseRes = updateTemplateSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const updated = await withAdminRole(async (tx) => {
      const template = await tx.scriptTemplate.findUnique({ where: { id } });
      if (!template) {
        return null;
      }

      return tx.scriptTemplate.update({
        where: { id },
        data: {
          ...parseRes.data,
          flowTemplate: parseRes.data.flowTemplate ? JSON.stringify(parseRes.data.flowTemplate) : undefined,
        },
      });
    });

    if (!updated) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
    }

    return reply.send({ data: updated });
  });

  // GET /templates/:id/impact · count uso por tenant para warn antes de delete
  app.get('/templates/:id/impact', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const impact = await withAdminRole(async (tx) => {
        const template = await tx.scriptTemplate.findUnique({ where: { id }, select: { id: true, name: true } });
        if (!template) return null;

        const [scriptsCloned, tenantsUsingRaw, activeCampaigns] = await Promise.all([
          tx.script.count({ where: { clonedFromTemplateId: id, archivedAt: null } }),
          tx.script.findMany({
            where: { clonedFromTemplateId: id, archivedAt: null },
            distinct: ['tenantId'],
            select: { tenantId: true, tenant: { select: { id: true, name: true, slug: true, status: true } } },
          }),
          tx.campaign.count({
            where: {
              status: 'ACTIVE',
              activeScript: { clonedFromTemplateId: id, archivedAt: null },
            },
          }),
        ]);

        return {
          templateId: template.id,
          templateName: template.name,
          scriptsCloned,
          tenantsCount: tenantsUsingRaw.length,
          tenants: tenantsUsingRaw.map((s) => s.tenant).filter((t): t is NonNullable<typeof t> => !!t),
          activeCampaigns,
        };
      });

      if (!impact) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
      }

      return reply.send({ data: impact });
    } catch (err) {
      app.log.error({ err, templateId: id }, 'admin/templates/:id/impact failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular impacto.' });
    }
  });

  // DELETE /templates/:id (Soft delete/Deactivate template)
  app.delete('/templates/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const deleted = await withAdminRole(async (tx) => {
      const template = await tx.scriptTemplate.findUnique({ where: { id } });
      if (!template) {
        return false;
      }

      await tx.scriptTemplate.update({
        where: { id },
        data: { active: false },
      });

      return true;
    });

    if (!deleted) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
    }

    return reply.send({ success: true, message: 'Template deactivated successfully' });
  });

  // =============================================================================
  // GAP 9: LGPD REQUEST PROCESSING
  // =============================================================================

  // PATCH /lgpd-requests/:id/process · Iniciar processamento (PENDING → PROCESSING)
  app.patch('/lgpd-requests/:id/process', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const result = await withAdminRole(async (tx) => {
      const request = await tx.lgpdRequest.findUnique({ where: { id } });
      if (!request) {
        return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Requisição LGPD não encontrada.' };
      }
      if (request.status !== 'PENDING') {
        return { ok: false as const, status: 400, code: 'VALIDATION_ERROR', message: `Requisição não está PENDING (atual: ${request.status}).` };
      }

      const updated = await tx.lgpdRequest.update({
        where: { id },
        data: { status: 'PROCESSING' },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          requestedByUser: { select: { id: true, name: true, email: true } },
          processedBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'lgpd_request.process',
          targetType: 'lgpd_request',
          targetId: id,
          payload: { previousStatus: 'PENDING', newStatus: 'PROCESSING', tenantId: request.tenantId },
        },
      });

      return { ok: true as const, value: updated };
    });

    if (!result.ok) {
      return reply.code(result.status).send({ error: result.code, message: result.message });
    }

    return reply.send({ data: result.value });
  });

  // PATCH /lgpd-requests/:id/complete · Concluir processamento (PROCESSING → COMPLETED)
  const lgpdCompleteSchema = z.object({
    notes: z.string().max(2000).optional(),
  });

  app.patch('/lgpd-requests/:id/complete', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parseRes = lgpdCompleteSchema.safeParse(req.body || {});
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parseRes.error.errors[0]?.message });
    }

    const result = await withAdminRole(async (tx) => {
      const request = await tx.lgpdRequest.findUnique({ where: { id } });
      if (!request) {
        return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Requisição LGPD não encontrada.' };
      }
      if (request.status !== 'PROCESSING') {
        return { ok: false as const, status: 400, code: 'VALIDATION_ERROR', message: `Requisição não está PROCESSING (atual: ${request.status}).` };
      }

      const updated = await tx.lgpdRequest.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          processedById: req.userId,
        },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          requestedByUser: { select: { id: true, name: true, email: true } },
          processedBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'lgpd_request.complete',
          targetType: 'lgpd_request',
          targetId: id,
          payload: { previousStatus: 'PROCESSING', newStatus: 'COMPLETED', tenantId: request.tenantId, notes: parseRes.data.notes ?? null },
        },
      });

      return { ok: true as const, value: updated };
    });

    if (!result.ok) {
      return reply.code(result.status).send({ error: result.code, message: result.message });
    }

    return reply.send({ data: result.value });
  });

  // PATCH /lgpd-requests/:id/reject · Rejeitar requisição (qualquer status ativo → REJECTED)
  const lgpdRejectSchema = z.object({
    rejectionReason: z.string().min(5, 'Motivo da rejeição é obrigatório (mín. 5 caracteres).').max(2000),
  });

  app.patch('/lgpd-requests/:id/reject', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parseRes = lgpdRejectSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parseRes.error.errors[0]?.message });
    }

    const { rejectionReason } = parseRes.data;

    const result = await withAdminRole(async (tx) => {
      const request = await tx.lgpdRequest.findUnique({ where: { id } });
      if (!request) {
        return { ok: false as const, status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Requisição LGPD não encontrada.' };
      }
      if (request.status !== 'PENDING' && request.status !== 'PROCESSING') {
        return { ok: false as const, status: 400, code: 'VALIDATION_ERROR', message: `Requisição não pode ser rejeitada (status: ${request.status}).` };
      }

      const updated = await tx.lgpdRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectionReason,
          processedAt: new Date(),
          processedById: req.userId,
        },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          requestedByUser: { select: { id: true, name: true, email: true } },
          processedBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: req.userId,
          action: 'lgpd_request.reject',
          targetType: 'lgpd_request',
          targetId: id,
          payload: { previousStatus: request.status, newStatus: 'REJECTED', tenantId: request.tenantId, rejectionReason },
        },
      });

      return { ok: true as const, value: updated };
    });

    if (!result.ok) {
      return reply.code(result.status).send({ error: result.code, message: result.message });
    }

    return reply.send({ data: result.value });
  });
};
export default adminRoutes;
