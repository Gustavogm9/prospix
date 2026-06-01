import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dbAdmin } from '../../lib/db.js';
import { requireRole } from '../../middlewares/auth.js';
import { generateInvitationCode } from '../../services/invitation-service.js';
import { env } from '../../config/env.js';
import { randomUUID } from 'crypto';
import { TenantStatus, TenantPlan, UserRole, CampaignStatus, BillingStatus } from '@prospix/shared-types';
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

function buildIntegrationHealth(tenant: any) {
  const secret = tenant.tenant_secrets;
  const checks = {
    whatsappGatewayConfigured: Boolean(
      secret?.evolution_base_url &&
      secret.evolution_instance_name &&
      secret.evolution_api_key_encrypted &&
      secret.evolution_webhook_secret
    ),
    googleCalendarConnected: Boolean(secret?.google_calendar_id && secret.google_oauth_refresh_encrypted),
    googleMapsConfigured: Boolean(secret?.google_maps_api_key_encrypted),
    aiConfigured: Boolean(
      !secret ||
      secret.ai_provider === 'GUILDS_SHARED' ||
      secret.openai_api_key_encrypted ||
      secret.anthropic_api_key_encrypted ||
      secret.google_ai_api_key_encrypted
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

function toAdminTenantDetail(tenant: any) {
  const secret = tenant.tenant_secrets;

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    segment: tenant.segment,
    status: tenant.status,
    plan: tenant.plan,
    mrrCents: tenant.mrr_cents,
    goLiveAt: tenant.go_live_at,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
    users: tenant.users,
    integrationHealth: buildIntegrationHealth(tenant),
    credentialState: secret
      ? {
        exists: true,
        evolution: {
          baseUrlConfigured: Boolean(secret.evolution_base_url),
          instanceConfigured: Boolean(secret.evolution_instance_name),
          tokenConfigured: Boolean(secret.evolution_api_key_encrypted),
          webhookConfigured: Boolean(secret.evolution_webhook_secret),
        },
        google: {
          calendarConfigured: Boolean(secret.google_calendar_id),
          oauthConnected: Boolean(secret.google_oauth_refresh_encrypted),
          oauthScope: secret.google_oauth_scope,
          mapsConfigured: Boolean(secret.google_maps_api_key_encrypted),
        },
        ai: {
          provider: secret.ai_provider,
          openaiConfigured: Boolean(secret.openai_api_key_encrypted),
          anthropicConfigured: Boolean(secret.anthropic_api_key_encrypted),
          googleConfigured: Boolean(secret.google_ai_api_key_encrypted),
        },
        telephony: {
          accountConfigured: Boolean(secret.twilio_account_sid_encrypted),
          tokenConfigured: Boolean(secret.twilio_auth_token_encrypted),
        },
        updatedAt: secret.updated_at,
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
    const secretSelect = 'evolution_base_url, evolution_instance_name, evolution_api_key_encrypted, evolution_webhook_secret, google_calendar_id, google_oauth_refresh_encrypted, google_maps_api_key_encrypted, openai_api_key_encrypted, anthropic_api_key_encrypted, google_ai_api_key_encrypted, ai_provider';

    const { data: _tenants, error } = await dbAdmin
      .from('tenants')
      .select(`*, users!inner(id, name, email, whatsapp), tenant_secrets(${secretSelect})`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Also get non-owner users for tenants that have them (users!inner with role=OWNER may miss some)
    // Actually let's get all users and filter on client side for the list view
    const { data: allTenants, error: err2 } = await dbAdmin
      .from('tenants')
      .select(`*, users(id, name, email, whatsapp, role), tenant_secrets(${secretSelect})`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (err2) throw err2;

    const tenantsWithHealth = (allTenants ?? []).map((tenant: any) => {
      const ownerUsers = (tenant.users ?? []).filter((u: any) => u.role === 'OWNER');
      return {
        ...tenant,
        users: ownerUsers,
        tenant_secrets: undefined,
        integrationHealth: buildIntegrationHealth(tenant),
      };
    });

    return reply.send({ data: tenantsWithHealth });
  });

  // GET /tenants/:id (Get tenant detail)
  app.get('/tenants/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const { data: tenant, error } = await dbAdmin
      .from('tenants')
      .select(`*, users(id, name, email, role), tenant_secrets(evolution_base_url, evolution_instance_name, evolution_api_key_encrypted, evolution_webhook_secret, google_calendar_id, google_oauth_refresh_encrypted, google_oauth_scope, google_maps_api_key_encrypted, openai_api_key_encrypted, anthropic_api_key_encrypted, google_ai_api_key_encrypted, ai_provider, twilio_account_sid_encrypted, twilio_auth_token_encrypted, updated_at)`)
      .eq('id', id)
      .single();

    if (error || !tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    return reply.send({ data: toAdminTenantDetail(tenant) });
  });

  // POST /tenants (Create tenant - onboarding wizard)
  const createTenantSchema = z.object({
    name: z.string().min(1, 'Tenant name is required'),
    slug: z.string().min(1, 'Tenant slug is required').max(64),
    segment: z.string().optional().default('insurance_other'),
    plan: z.enum(['FREE', 'STARTER', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']).default('STANDARD'),
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

    // Check slug collision
    const { data: collision } = await dbAdmin
      .from('tenants')
      .select('id')
      .eq('slug', data.slug)
      .maybeSingle();
    if (collision) {
      return reply.code(409).send({ error: 'Conflict', message: 'Tenant slug already exists' });
    }

    // Create tenant
    const { data: newTenant, error: createErr } = await dbAdmin
      .from('tenants')
      .insert({
        id: randomUUID(),
        name: data.name,
        slug: data.slug,
        segment: data.segment,
        status: TenantStatus.ONBOARDING,
        plan: data.plan as TenantPlan,
        mrr_cents: data.mrrCents,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (createErr) throw createErr;

    // Create tenant secret
    await dbAdmin.from('tenant_secrets').insert({
      tenant_id: newTenant.id,
      evolution_instance_name: `tenant_${data.slug.replace(/[^a-zA-Z0-9]/g, '')}`,
      updated_at: new Date().toISOString(),
    });

    // Create tenant AI config
    await dbAdmin.from('tenant_ai_configs').insert({
      tenant_id: newTenant.id,
      system_model: 'gpt-4o-mini',
      classifier_model: 'gpt-4o-mini',
      guardrail_model: 'gpt-4o-mini',
      updated_at: new Date().toISOString(),
    });

    // Create owner user if provided
    if (data.ownerEmail && data.ownerName && data.ownerWhatsapp) {
      await dbAdmin.from('users').insert({
        id: randomUUID(),
        tenant_id: newTenant.id,
        role: UserRole.OWNER,
        name: data.ownerName,
        email: data.ownerEmail,
        whatsapp: data.ownerWhatsapp,
        updated_at: new Date().toISOString(),
      });
    }

    // Audit log
    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'tenant.create',
      target_type: 'tenant',
      target_id: newTenant.id,
      payload: { slug: data.slug, plan: data.plan },
    });

    return reply.code(201).send(newTenant);
  });

  // PATCH /tenants/:id (Update tenant)
  const updateTenantSchema = z.object({
    name: z.string().optional(),
    plan: z.enum(['FREE', 'STARTER', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
    mrrCents: z.number().int().optional(),
    status: z.enum(['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CHURNING', 'CHURNED']).optional(),
  });

  app.patch('/tenants/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parseRes = updateTenantSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const { data: tenant } = await dbAdmin.from('tenants').select('id, status').eq('id', id).single();
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    const updateData: Record<string, unknown> = {};
    if (parseRes.data.name !== undefined) updateData.name = parseRes.data.name;
    if (parseRes.data.plan !== undefined) updateData.plan = parseRes.data.plan;
    if (parseRes.data.mrrCents !== undefined) updateData.mrr_cents = parseRes.data.mrrCents;
    if (parseRes.data.status !== undefined) updateData.status = parseRes.data.status;

    const { data: updated, error: updateErr } = await dbAdmin
      .from('tenants')
      .update(updateData as any)
      .eq('id', id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'tenant.update',
      target_type: 'tenant',
      target_id: id,
      payload: parseRes.data as any,
    });

    return reply.send({ data: updated });
  });

  // =============================================================================
  // D8: SUSPEND / RESUME / CHURN TENANTS
  // =============================================================================

  // POST /tenants/:id/suspend
  app.post('/tenants/:id/suspend', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const { data: tenant } = await dbAdmin.from('tenants').select('id, status').eq('id', id).single();
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    // 1. Suspend tenant
    await dbAdmin.from('tenants').update({ status: TenantStatus.SUSPENDED }).eq('id', id);

    // 2. Pause all campaigns
    await dbAdmin
      .from('campaigns')
      .update({ status: CampaignStatus.PAUSED })
      .eq('tenant_id', id)
      .eq('status', CampaignStatus.ACTIVE);

    // 3. Log Audit
    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'tenant.suspend',
      target_type: 'tenant',
      target_id: id,
      payload: { previous_status: tenant.status },
    });

    return reply.send({ success: true, message: 'Tenant suspended and campaigns paused successfully' });
  });

  // POST /tenants/:id/resume
  app.post('/tenants/:id/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const { data: tenant } = await dbAdmin.from('tenants').select('id, status').eq('id', id).single();
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    await dbAdmin.from('tenants').update({ status: TenantStatus.ACTIVE }).eq('id', id);

    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'tenant.resume',
      target_type: 'tenant',
      target_id: id,
      payload: { previous_status: tenant.status },
    });

    return reply.send({ success: true, message: 'Tenant re-activated successfully' });
  });

  // POST /tenants/:id/churn
  app.post('/tenants/:id/churn', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const { data: tenant } = await dbAdmin.from('tenants').select('id, status').eq('id', id).single();
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    // Mark as churning
    await dbAdmin.from('tenants').update({ status: TenantStatus.CHURNING }).eq('id', id);

    // Pause campaigns
    await dbAdmin
      .from('campaigns')
      .update({ status: CampaignStatus.PAUSED })
      .eq('tenant_id', id)
      .eq('status', CampaignStatus.ACTIVE);

    // Schedule soft delete for 7 days in the future (grace period)
    const graceDate = new Date();
    graceDate.setDate(graceDate.getDate() + 7);

    // Audit Log
    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'tenant.churn',
      target_type: 'tenant',
      target_id: id,
      payload: { previous_status: tenant.status, grace_period_until: graceDate } as any,
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

    const { data: tenant } = await dbAdmin.from('tenants').select('id').eq('id', tenantId).single();
    if (!tenant) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
    }

    // Check active invitation
    const { data: activeInvitation } = await dbAdmin
      .from('tenant_invitations')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (activeInvitation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'This tenant already has an active invitation code.',
      });
    }

    // Generate unique code
    let code = generateInvitationCode();
    let codeCollision = await dbAdmin.from('tenant_invitations').select('id').eq('code', code).maybeSingle();
    while (codeCollision.data) {
      code = generateInvitationCode();
      codeCollision = await dbAdmin.from('tenant_invitations').select('id').eq('code', code).maybeSingle();
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.INVITATION_CODE_TTL_DAYS);

    const { data: invitation, error: invErr } = await dbAdmin
      .from('tenant_invitations')
      .insert({
        id: randomUUID(),
        code,
        tenant_id: tenantId,
        role: 'OWNER',
        created_by_id: createdBy,
        expires_at: expiresAt.toISOString(),
        notes,
      })
      .select()
      .single();
    if (invErr) throw invErr;

    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'tenant.invitation_created',
      target_type: 'tenant',
      target_id: tenantId,
      payload: { code: invitation.code },
    });

    return reply.code(201).send(invitation);
  });

  // GET /tenants/:id/invitations (List invitations)
  app.get('/tenants/:id/invitations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: tenantId } = req.params as { id: string };
    const { data: invitations, error } = await dbAdmin
      .from('tenant_invitations')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return reply.send({ data: invitations });
  });

  // DELETE /tenants/:id/invitations/:invitationId (Revoke invitation)
  app.delete('/tenants/:id/invitations/:invitationId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: tenantId, invitationId } = req.params as { id: string; invitationId: string };

    const { data: invitation } = await dbAdmin
      .from('tenant_invitations')
      .select('*')
      .eq('id', invitationId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!invitation) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Invitation not found.' });
    }

    if (invitation.used_at) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Cannot revoke an invitation that has already been used.',
      });
    }

    const { data: updated, error: updateErr } = await dbAdmin
      .from('tenant_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', invitationId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'tenant.invitation_revoked',
      target_type: 'tenant',
      target_id: tenantId,
      payload: { invitation_id: invitationId },
    });

    return reply.send(updated);
  });

  // =============================================================================
  // D9: SUPER-ADMIN USAGE CONSOLIDATION & BILLING
  // =============================================================================

  // GET /tenants/:id/insights · counts + usage 3m + billing history para o Tenant Detail Page
  app.get('/tenants/:id/insights', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);

      const { data: tenant } = await dbAdmin.from('tenants').select('id').eq('id', id).single();
      if (!tenant) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' });
      }

      const [leadsCountRes, conversationsActiveRes, conversationsTotalRes, scriptsActiveRes, lgpdPendingRes, meetingsScheduledRes] = await Promise.all([
        dbAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('tenant_id', id).is('deleted_at', null),
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', id).eq('status', 'ACTIVE'),
        dbAdmin.from('conversations').select('*', { count: 'exact', head: true }).eq('tenant_id', id),
        dbAdmin.from('scripts').select('*', { count: 'exact', head: true }).eq('tenant_id', id).eq('status', 'ACTIVE').is('archived_at', null),
        dbAdmin.from('lgpd_requests').select('*', { count: 'exact', head: true }).eq('tenant_id', id).in('status', ['PENDING', 'PROCESSING']),
        dbAdmin.from('meetings').select('*', { count: 'exact', head: true }).eq('tenant_id', id).eq('status', 'SCHEDULED'),
      ]);

      const { data: usageRecords, error: usageErr } = await dbAdmin
        .from('tenant_usage')
        .select('*')
        .eq('tenant_id', id)
        .gte('period_month', threeMonthsAgo.toISOString())
        .order('period_month', { ascending: true });
      if (usageErr) throw usageErr;

      const { data: billingHistory, error: billingErr } = await dbAdmin
        .from('tenant_billing')
        .select('*')
        .eq('tenant_id', id)
        .order('due_at', { ascending: false })
        .limit(6);
      if (billingErr) throw billingErr;

      return reply.send({
        data: {
          counts: {
            leads: leadsCountRes.count ?? 0,
            conversationsActive: conversationsActiveRes.count ?? 0,
            conversationsTotal: conversationsTotalRes.count ?? 0,
            scriptsActive: scriptsActiveRes.count ?? 0,
            lgpdPending: lgpdPendingRes.count ?? 0,
            meetingsScheduled: meetingsScheduledRes.count ?? 0,
          },
          usage3m: (usageRecords ?? []).map((u: any) => ({
            periodMonth: (u.period_month as string).slice(0, 7),
            llmCostCents: Number(u.llm_cost_cents),
            whatsappCostCents: Number(u.whatsapp_cost_cents),
            googleMapsCostCents: Number(u.google_maps_cost_cents),
            totalCostCents: Number(u.llm_cost_cents) + Number(u.whatsapp_cost_cents) + Number(u.google_maps_cost_cents),
            llmTokensInput: Number(u.llm_tokens_input),
            llmTokensOutput: Number(u.llm_tokens_output),
            whatsappMessagesSent: Number(u.whatsapp_messages_sent),
          })),
          billing: (billingHistory ?? []).map((b: any) => ({
            id: b.id,
            periodMonth: (b.period_month as string).slice(0, 7),
            totalCents: b.total_cents,
            status: b.status,
            dueAt: b.due_at,
            paidAt: b.paid_at ?? null,
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
      const [tenantsRes, usersRes, leadsRes] = await Promise.all([
        dbAdmin
          .from('tenants')
          .select('id, name, slug, status')
          .or(`name.ilike.%${term}%,slug.ilike.%${term}%`)
          .limit(limit),
        dbAdmin
          .from('users')
          .select('id, name, email, role, tenant_id, tenants(name, slug)')
          .or(`email.ilike.%${term}%,name.ilike.%${term}%`)
          .is('deleted_at', null)
          .limit(limit),
        dbAdmin
          .from('leads')
          .select('id, name, whatsapp, email, tenant_id, tenants(name, slug)')
          .or(`name.ilike.%${term}%,whatsapp.ilike.%${term}%,email.ilike.%${term}%`)
          .is('deleted_at', null)
          .limit(limit),
      ]);

      const tenants = tenantsRes.data ?? [];
      const users = usersRes.data ?? [];
      const leads = leadsRes.data ?? [];

      return reply.send({
        data: {
          tenants: tenants.map((t: any) => ({ kind: 'tenant', id: t.id, label: t.name, sub: `slug: ${t.slug} · ${t.status}`, href: `/tenants/${t.id}` })),
          users: users.map((u: any) => ({ kind: 'user', id: u.id, label: u.name, sub: `${u.email} · ${u.role} · ${u.tenants?.name ?? '—'}`, href: `/tenants/${u.tenant_id}` })),
          leads: leads.map((l: any) => ({ kind: 'lead', id: l.id, label: l.name ?? l.whatsapp, sub: `${l.whatsapp} · ${l.email ?? ''} · ${l.tenants?.name ?? '—'}`, href: `/tenants/${l.tenant_id}` })),
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

      const { data: activeTenants, error: tErr } = await dbAdmin
        .from('tenants')
        .select('id, name, slug, status, mrr_cents, plan, go_live_at')
        .in('status', ['ACTIVE', 'CHURNING'])
        .is('deleted_at', null);
      if (tErr) throw tErr;

      const enriched = await Promise.all(
        (activeTenants ?? []).map(async (t: any) => {
          const [currentUsageRes, prevUsageRes, overdueRes, lastConvRes, activeCampaignsRes] = await Promise.all([
            dbAdmin.from('tenant_usage').select('*').eq('tenant_id', t.id).eq('period_month', startOfMonth.toISOString()).maybeSingle(),
            dbAdmin.from('tenant_usage').select('*').eq('tenant_id', t.id).eq('period_month', startOfPrevMonth.toISOString()).maybeSingle(),
            dbAdmin.from('tenant_billing').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('status', 'OVERDUE'),
            dbAdmin.from('conversations').select('started_at, last_inbound_at, last_outbound_at').eq('tenant_id', t.id).order('started_at', { ascending: false }).limit(1).maybeSingle(),
            dbAdmin.from('campaigns').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id).eq('status', 'ACTIVE').gte('updated_at', sixtyDaysAgo.toISOString()),
          ]);

          const currentUsage = currentUsageRes.data;
          const prevUsage = prevUsageRes.data;
          const overdueBilling = overdueRes.count ?? 0;
          const lastConversation = lastConvRes.data;
          const activeCampaigns = activeCampaignsRes.count ?? 0;

          const currentMsgs = currentUsage ? Number(currentUsage.whatsapp_messages_sent) : 0;
          const prevMsgs = prevUsage ? Number(prevUsage.whatsapp_messages_sent) : 0;
          const usageDeltaPercent = prevMsgs > 0 ? Math.round(((currentMsgs - prevMsgs) / prevMsgs) * 100) : 0;
          const lastActivity = lastConversation
            ? (lastConversation.last_inbound_at ?? lastConversation.last_outbound_at ?? lastConversation.started_at)
            : null;
          const dormantDays = lastActivity ? Math.floor((now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)) : 999;

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
            mrrCents: t.mrr_cents,
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

      const sorted = enriched.sort((a, b) => b.score - a.score);

      const summary = sorted.reduce(
        (acc, t) => {
          acc[t.level] = (acc[t.level] ?? 0) + 1;
          return acc;
        },
        { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>,
      );

      return reply.send({ data: { tenants: sorted, summary, generatedAt: now.toISOString() } });
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
      let query = dbAdmin
        .from('lgpd_requests')
        .select('*, tenants(id, name, slug), users!lgpd_requests_requested_by_user_id_fkey(id, name, email), processed_by:users!lgpd_requests_processed_by_id_fkey(id, name, email)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (type) query = query.eq('type', type);
      if (tenantId) query = query.eq('tenant_id', tenantId);

      const { data: items, error } = await query;
      if (error) throw error;

      // Count
      let countQuery = dbAdmin.from('lgpd_requests').select('*', { count: 'exact', head: true });
      if (status) countQuery = countQuery.eq('status', status);
      if (type) countQuery = countQuery.eq('type', type);
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      // Status counts
      let statusCountsRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `SELECT status, COUNT(id)::bigint AS cnt FROM lgpd_requests GROUP BY status`,
        });
        statusCountsRaw = data ?? [];
      } catch { /* ignore */ }

      const counts: Record<string, number> = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, REJECTED: 0, CANCELED: 0 };
      for (const c of statusCountsRaw) counts[c.status] = Number(c.cnt);

      return reply.send({
        data: {
          items: (items ?? []).map((r: any) => ({
            id: r.id,
            tenantId: r.tenant_id,
            tenant: r.tenants,
            type: r.type,
            status: r.status,
            scope: r.scope,
            requestedByUser: r.users,
            requestedByLead: r.requested_by_lead,
            rejectionReason: r.rejection_reason,
            processedBy: r.processed_by,
            processedAt: r.processed_at ?? null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            downloadExpiresAt: r.download_expires_at ?? null,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (items?.length ?? 0) < (total ?? 0) },
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
      let query = dbAdmin
        .from('audit_log')
        .select('*, tenants(id, name, slug), users(id, name, email, role)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (action) query = query.eq('action', action);
      if (tenantId) query = query.eq('tenant_id', tenantId);
      if (userId) query = query.eq('user_id', userId);
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to);

      const { data: logs, error } = await query;
      if (error) throw error;

      // Count
      let countQuery = dbAdmin.from('audit_log').select('*', { count: 'exact', head: true });
      if (action) countQuery = countQuery.eq('action', action);
      if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
      if (userId) countQuery = countQuery.eq('user_id', userId);
      if (from) countQuery = countQuery.gte('created_at', from);
      if (to) countQuery = countQuery.lte('created_at', to);
      const { count: total, error: countErr } = await countQuery;
      if (countErr) throw countErr;

      // Distinct actions
      let distinctActionsRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `SELECT DISTINCT action FROM audit_log ORDER BY action ASC LIMIT 100`,
        });
        distinctActionsRaw = data ?? [];
      } catch { /* ignore */ }

      return reply.send({
        data: {
          items: (logs ?? []).map((l: any) => ({
            id: l.id.toString(),
            tenantId: l.tenant_id,
            tenant: l.tenants ? { id: l.tenants.id, name: l.tenants.name, slug: l.tenants.slug } : null,
            userId: l.user_id,
            user: l.users ? { id: l.users.id, name: l.users.name, email: l.users.email, role: l.users.role } : null,
            action: l.action,
            targetType: l.target_type,
            targetId: l.target_id,
            payload: l.payload,
            ipAddress: l.ip_address,
            userAgent: l.user_agent,
            createdAt: l.created_at,
          })),
          pagination: { total: total ?? 0, limit, offset, hasMore: offset + (logs?.length ?? 0) < (total ?? 0) },
          knownActions: (distinctActionsRaw ?? []).map((a: any) => a.action),
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

    const { data: usageRecords, error } = await dbAdmin
      .from('tenant_usage')
      .select('*, tenants(id, name, mrr_cents, plan)')
      .eq('period_month', startOfMonth.toISOString());
    if (error) throw error;

    const report = (usageRecords ?? []).map((rec: any) => {
      const llmCost = Number(rec.llm_cost_cents);
      const whatsappCost = Number(rec.whatsapp_cost_cents);
      const mapsCost = Number(rec.google_maps_cost_cents);
      const totalCost = llmCost + whatsappCost + mapsCost;
      const mrr = rec.tenants?.mrr_cents ?? 0;
      const margin = mrr - totalCost;
      const profitMarginPercent = mrr > 0 ? (margin / mrr) * 100 : 0;

      return {
        tenant_id: rec.tenant_id,
        tenant_name: rec.tenants?.name,
        plan: rec.tenants?.plan,
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
    const { data: billings, error } = await dbAdmin
      .from('tenant_billing')
      .select('*, tenants(name)')
      .in('status', [BillingStatus.PENDING, BillingStatus.OVERDUE])
      .order('due_at', { ascending: true });
    if (error) throw error;
    return reply.send({ data: billings });
  });

  // PATCH /billing/:id/pay (Confirm manual/offline payment)
  app.patch('/billing/:id/pay', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const { data: billing, error: findErr } = await dbAdmin
      .from('tenant_billing')
      .select('*, tenants(id, status)')
      .eq('id', id)
      .single();

    if (findErr || !billing) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Billing record not found' });
    }

    // 1. Mark as PAID
    const { data: updated, error: updateErr } = await dbAdmin
      .from('tenant_billing')
      .update({ status: BillingStatus.PAID, paid_at: new Date().toISOString(), payment_method: 'manual_offline' })
      .eq('id', id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    // 2. Reactivate tenant if suspended
    if ((billing.tenants as any)?.status === TenantStatus.SUSPENDED) {
      await dbAdmin
        .from('tenants')
        .update({ status: TenantStatus.ACTIVE })
        .eq('id', billing.tenant_id);
    }

    // 3. Log Audit
    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'billing.pay_manual',
      target_type: 'tenant_billing',
      target_id: id,
      payload: { amount_cents: billing.total_cents, tenant_id: billing.tenant_id },
    });

    return reply.send({ data: updated });
  });

  // =============================================================================
  // D10: MASTER TEMPLATES CRUD
  // =============================================================================

  // GET /templates (List templates)
  app.get('/templates', async (_req, reply) => {
    const { data: templates, error } = await dbAdmin
      .from('script_templates')
      .select('*')
      .eq('active', true)
      .order('popularity', { ascending: false });
    if (error) throw error;
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

    const { data: template, error } = await dbAdmin
      .from('script_templates')
      .insert({
        id: randomUUID(),
        name: data.name,
        segment: data.segment,
        category: data.category,
        target_profession: data.targetProfession,
        flow_template: JSON.stringify(data.flowTemplate),
        base_message_template: data.baseMessageTemplate,
        variables: data.variables,
        description: data.description,
        active: true,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

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

    const { data: template } = await dbAdmin.from('script_templates').select('id').eq('id', id).single();
    if (!template) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
    }

    const updateData: Record<string, unknown> = {};
    if (parseRes.data.name !== undefined) updateData.name = parseRes.data.name;
    if (parseRes.data.segment !== undefined) updateData.segment = parseRes.data.segment;
    if (parseRes.data.category !== undefined) updateData.category = parseRes.data.category;
    if (parseRes.data.flowTemplate !== undefined) updateData.flow_template = JSON.stringify(parseRes.data.flowTemplate);
    if (parseRes.data.baseMessageTemplate !== undefined) updateData.base_message_template = parseRes.data.baseMessageTemplate;
    if (parseRes.data.variables !== undefined) updateData.variables = parseRes.data.variables;
    if (parseRes.data.description !== undefined) updateData.description = parseRes.data.description;
    if (parseRes.data.active !== undefined) updateData.active = parseRes.data.active;

    const { data: updated, error: updateErr } = await dbAdmin
      .from('script_templates')
      .update(updateData as any)
      .eq('id', id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    return reply.send({ data: updated });
  });

  // GET /templates/:id/impact · count uso por tenant para warn antes de delete
  app.get('/templates/:id/impact', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const { data: template } = await dbAdmin.from('script_templates').select('id, name').eq('id', id).single();
      if (!template) {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
      }

      const { count: scriptsCloned } = await dbAdmin
        .from('scripts')
        .select('*', { count: 'exact', head: true })
        .eq('cloned_from_template_id', id)
        .is('archived_at', null);

      // Get distinct tenants using this template
      let tenantsUsingRaw: any[] = [];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT DISTINCT s.tenant_id, t.id, t.name, t.slug, t.status
            FROM scripts s
            JOIN tenants t ON s.tenant_id = t.id
            WHERE s.cloned_from_template_id = '${id}' AND s.archived_at IS NULL
          `,
        });
        tenantsUsingRaw = data ?? [];
      } catch { /* ignore */ }

      // Count active campaigns using scripts cloned from this template
      let activeCampaignsRaw: any[] = [{ cnt: 0 }];
      try {
        const { data } = await dbAdmin.rpc('exec_sql' as any, {
          query: `
            SELECT COUNT(DISTINCT c.id)::bigint AS cnt
            FROM campaigns c
            JOIN scripts s ON c.active_script_id = s.id
            WHERE c.status = 'ACTIVE' AND s.cloned_from_template_id = '${id}' AND s.archived_at IS NULL
          `,
        });
        activeCampaignsRaw = data ?? [{ cnt: 0 }];
      } catch { /* ignore */ }

      return reply.send({
        data: {
          templateId: template.id,
          templateName: template.name,
          scriptsCloned: scriptsCloned ?? 0,
          tenantsCount: tenantsUsingRaw.length,
          tenants: tenantsUsingRaw.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug, status: t.status })),
          activeCampaigns: Number(activeCampaignsRaw[0]?.cnt ?? 0),
        },
      });
    } catch (err) {
      app.log.error({ err, templateId: id }, 'admin/templates/:id/impact failed');
      return reply.code(500).send({ error: 'INTERNAL', message: 'Falha ao calcular impacto.' });
    }
  });

  // DELETE /templates/:id (Soft delete/Deactivate template)
  app.delete('/templates/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const { data: template } = await dbAdmin.from('script_templates').select('id').eq('id', id).single();
    if (!template) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' });
    }

    await dbAdmin.from('script_templates').update({ active: false }).eq('id', id);

    return reply.send({ success: true, message: 'Template deactivated successfully' });
  });

  // =============================================================================
  // GAP 9: LGPD REQUEST PROCESSING
  // =============================================================================

  // PATCH /lgpd-requests/:id/process · Iniciar processamento (PENDING → PROCESSING)
  app.patch('/lgpd-requests/:id/process', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };

    const { data: request, error: findErr } = await dbAdmin.from('lgpd_requests').select('*').eq('id', id).single();
    if (findErr || !request) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Requisição LGPD não encontrada.' });
    }
    if (request.status !== 'PENDING') {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: `Requisição não está PENDING (atual: ${request.status}).` });
    }

    const { data: updated, error: updateErr } = await dbAdmin
      .from('lgpd_requests')
      .update({ status: 'PROCESSING' })
      .eq('id', id)
      .select('*, tenants(id, name, slug), users!lgpd_requests_requested_by_user_id_fkey(id, name, email), processed_by:users!lgpd_requests_processed_by_id_fkey(id, name, email)')
      .single();
    if (updateErr) throw updateErr;

    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'lgpd_request.process',
      target_type: 'lgpd_request',
      target_id: id,
      payload: { previousStatus: 'PENDING', newStatus: 'PROCESSING', tenantId: request.tenant_id },
    });

    return reply.send({ data: updated });
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

    const { data: request, error: findErr } = await dbAdmin.from('lgpd_requests').select('*').eq('id', id).single();
    if (findErr || !request) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Requisição LGPD não encontrada.' });
    }
    if (request.status !== 'PROCESSING') {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: `Requisição não está PROCESSING (atual: ${request.status}).` });
    }

    const { data: updated, error: updateErr } = await dbAdmin
      .from('lgpd_requests')
      .update({
        status: 'COMPLETED',
        processed_at: new Date().toISOString(),
        processed_by_id: req.userId,
      })
      .eq('id', id)
      .select('*, tenants(id, name, slug), users!lgpd_requests_requested_by_user_id_fkey(id, name, email), processed_by:users!lgpd_requests_processed_by_id_fkey(id, name, email)')
      .single();
    if (updateErr) throw updateErr;

    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'lgpd_request.complete',
      target_type: 'lgpd_request',
      target_id: id,
      payload: { previousStatus: 'PROCESSING', newStatus: 'COMPLETED', tenantId: request.tenant_id, notes: parseRes.data.notes ?? null },
    });

    return reply.send({ data: updated });
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

    const { data: request, error: findErr } = await dbAdmin.from('lgpd_requests').select('*').eq('id', id).single();
    if (findErr || !request) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Requisição LGPD não encontrada.' });
    }
    if (request.status !== 'PENDING' && request.status !== 'PROCESSING') {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: `Requisição não pode ser rejeitada (status: ${request.status}).` });
    }

    const { data: updated, error: updateErr } = await dbAdmin
      .from('lgpd_requests')
      .update({
        status: 'REJECTED',
        rejection_reason: rejectionReason,
        processed_at: new Date().toISOString(),
        processed_by_id: req.userId,
      })
      .eq('id', id)
      .select('*, tenants(id, name, slug), users!lgpd_requests_requested_by_user_id_fkey(id, name, email), processed_by:users!lgpd_requests_processed_by_id_fkey(id, name, email)')
      .single();
    if (updateErr) throw updateErr;

    await dbAdmin.from('audit_log').insert({
      user_id: req.userId,
      action: 'lgpd_request.reject',
      target_type: 'lgpd_request',
      target_id: id,
      payload: { previousStatus: request.status, newStatus: 'REJECTED', tenantId: request.tenant_id, rejectionReason },
    });

    return reply.send({ data: updated });
  });
};
export default adminRoutes;
