import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireRole } from '../../middlewares/auth.js';
import { createInvitation, revokeInvitation } from '../../services/invitation-service.js';
import { TenantStatus, TenantPlan, UserRole, CampaignStatus, BillingStatus } from '@prisma/client';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // Enforce GUILDS_ADMIN role for all admin endpoints
  app.addHook('preHandler', requireRole(['GUILDS_ADMIN']));

  // Bypass RLS for admin queries using PostgreSQL guilds_admin role
  app.addHook('preHandler', async (_req) => {
    // Escapes current connection to guilds_admin role to bypass RLS policies
    await prisma.$executeRawUnsafe(`SET ROLE guilds_admin`);
  });

  // Reset connection role on response to keep pool healthy
  app.addHook('onSend', async (_req, _reply, payload) => {
    try {
      await prisma.$executeRawUnsafe(`RESET ROLE`);
    } catch (_) {
      // Ignore reset failures in onSend
    }
    return payload;
  });

  // =============================================================================
  // D8: CRUD /v1/admin/tenants
  // =============================================================================

  // GET /tenants (List tenants)
  app.get('/tenants', async (_req, reply) => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      include: {
        users: {
          where: { role: 'OWNER' },
          select: { id: true, name: true, email: true, whatsapp: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ data: tenants });
  });

  // GET /tenants/:id (Get tenant detail)
  app.get('/tenants/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true } },
        secret: true,
      },
    });

    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({ data: tenant });
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

    const collision = await prisma.tenant.findUnique({ where: { slug: data.slug } });
    if (collision) {
      return reply.code(409).send({ error: 'Conflict', message: 'Tenant slug already exists' });
    }

    const tenant = await prisma.$transaction(async (tx) => {
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

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: parseRes.data,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.userId,
        action: 'tenant.update',
        targetType: 'tenant',
        targetId: id,
        payload: parseRes.data as any,
      },
    });

    return reply.send({ data: updated });
  });

  // =============================================================================
  // D8: SUSPEND / RESUME / CHURN TENANTS
  // =============================================================================

  // POST /tenants/:id/suspend
  app.post('/tenants/:id/suspend', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    await prisma.$transaction(async (tx) => {
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
    });

    return reply.send({ success: true, message: 'Tenant suspended and campaigns paused successfully' });
  });

  // POST /tenants/:id/resume
  app.post('/tenants/:id/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    await prisma.$transaction(async (tx) => {
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
    });

    return reply.send({ success: true, message: 'Tenant re-activated successfully' });
  });

  // POST /tenants/:id/churn
  app.post('/tenants/:id/churn', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    await prisma.$transaction(async (tx) => {
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
    });

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

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    const result = await createInvitation(tenantId, createdBy, notes);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error.code, message: result.error.message });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.userId,
        action: 'tenant.invitation_created',
        targetType: 'tenant',
        targetId: tenantId,
        payload: { code: result.value.code },
      },
    });

    return reply.code(201).send(result.value);
  });

  // GET /tenants/:id/invitations (List invitations)
  app.get('/tenants/:id/invitations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: tenantId } = req.params as { id: string };
    const invitations = await prisma.tenantInvitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ data: invitations });
  });

  // DELETE /tenants/:id/invitations/:invitationId (Revoke invitation)
  app.delete('/tenants/:id/invitations/:invitationId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: tenantId, invitationId } = req.params as { id: string; invitationId: string };

    const result = await revokeInvitation(invitationId, tenantId);
    if (!result.ok) {
      const code = result.error.code;
      const status = code === 'RESOURCE_NOT_FOUND' ? 404 : 400;
      return reply.code(status).send({ error: code, message: result.error.message });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.userId,
        action: 'tenant.invitation_revoked',
        targetType: 'tenant',
        targetId: tenantId,
        payload: { invitation_id: invitationId },
      },
    });

    return reply.send(result.value);
  });

  // =============================================================================
  // D9: SUPER-ADMIN USAGE CONSOLIDATION & BILLING
  // =============================================================================

  // GET /usage/consolidated
  app.get('/usage/consolidated', async (_req, reply) => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usageRecords = await prisma.tenantUsage.findMany({
      where: { periodMonth: startOfMonth },
      include: {
        tenant: { select: { id: true, name: true, mrrCents: true, plan: true } },
      },
    });

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
    const billings = await prisma.tenantBilling.findMany({
      where: {
        status: { in: [BillingStatus.PENDING, BillingStatus.OVERDUE] },
      },
      include: {
        tenant: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
    });
    return reply.send({ data: billings });
  });

  // PATCH /billing/:id/pay (Confirm manual/offline payment)
  app.patch('/billing/:id/pay', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const billing = await prisma.tenantBilling.findUnique({
      where: { id },
      include: { tenant: true },
    });

    if (!billing) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Billing record not found' });
    }

    const updatedBilling = await prisma.$transaction(async (tx) => {
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

    return reply.send({ data: updatedBilling });
  });

  // =============================================================================
  // D10: MASTER TEMPLATES CRUD
  // =============================================================================

  // GET /templates (List templates)
  app.get('/templates', async (_req, reply) => {
    const templates = await prisma.scriptTemplate.findMany({
      where: { active: true },
      orderBy: { popularity: 'desc' },
    });
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

    const template = await prisma.scriptTemplate.create({
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
    });

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

    const template = await prisma.scriptTemplate.findUnique({ where: { id } });
    if (!template) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
    }

    const updated = await prisma.scriptTemplate.update({
      where: { id },
      data: {
        ...parseRes.data,
        flowTemplate: parseRes.data.flowTemplate ? JSON.stringify(parseRes.data.flowTemplate) : undefined,
      },
    });

    return reply.send({ data: updated });
  });

  // DELETE /templates/:id (Soft delete/Deactivate template)
  app.delete('/templates/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const template = await prisma.scriptTemplate.findUnique({ where: { id } });
    if (!template) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
    }

    await prisma.scriptTemplate.update({
      where: { id },
      data: { active: false },
    });

    return reply.send({ success: true, message: 'Template deactivated successfully' });
  });
};
export default adminRoutes;
