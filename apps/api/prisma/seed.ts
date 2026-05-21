import { PrismaClient, TenantStatus, TenantPlan, UserRole, LeadSource, LeadStatus } from '@prisma/client';
import { SEED_TENANTS, SEED_USERS, SEED_LEAD_COUNT } from '@prospix/mocks';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Start seeding database...');

  // 1. Clear existing data safely
  // (Order is important due to foreign key constraints)
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE 
    audit_log,
    idempotency_keys,
    prompt_versions,
    tenant_notes,
    notification_preferences,
    notifications,
    tenant_billing,
    tenant_usage,
    optouts,
    lead_events,
    script_variations,
    scripts,
    meetings,
    pending_outbound,
    messages,
    conversations,
    health_profiles,
    lead_notes,
    leads,
    campaigns,
    tenant_invitations,
    tenant_ai_configs,
    tenant_secrets,
    sessions,
    users,
    tenants
    CASCADE;`);

  console.log('🧹 Database truncated');

  // 2. Create Tenants
  for (const tenantKey of ['A', 'B'] as const) {
    const data = SEED_TENANTS[tenantKey];
    await prisma.tenant.create({
      data: {
        id: data.id,
        slug: data.slug,
        name: data.name,
        status: data.status as TenantStatus,
        plan: data.plan as TenantPlan,
        segment: data.segment,
        mrrCents: 15000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Create Tenant Secret
    await prisma.tenantSecret.create({
      data: {
        tenantId: data.id,
        evolutionInstanceName: `tenant_${data.slug.replace('-dev', '')}`,
        updatedAt: new Date(),
      },
    });

    // Create Tenant AI Config
    await prisma.tenantAIConfig.create({
      data: {
        tenantId: data.id,
        systemModel: 'gpt-4o-mini',
        classifierModel: 'gpt-4o-mini',
        guardrailModel: 'gpt-4o-mini',
        updatedAt: new Date(),
      },
    });
  }
  console.log('🏢 Tenants, secrets and AI configs created');

  // 3. Create Users
  // Owner A
  await prisma.user.create({
    data: {
      id: SEED_USERS.ownerA.id,
      tenantId: SEED_USERS.ownerA.tenantId,
      role: SEED_USERS.ownerA.role as UserRole,
      name: SEED_USERS.ownerA.name,
      email: SEED_USERS.ownerA.email,
      whatsapp: SEED_USERS.ownerA.whatsapp,
    },
  });

  // Owner B
  await prisma.user.create({
    data: {
      id: SEED_USERS.ownerB.id,
      tenantId: SEED_USERS.ownerB.tenantId,
      role: SEED_USERS.ownerB.role as UserRole,
      name: SEED_USERS.ownerB.name,
      email: SEED_USERS.ownerB.email,
      whatsapp: SEED_USERS.ownerB.whatsapp,
    },
  });

  // Guilds Admin (no tenantId)
  await prisma.user.create({
    data: {
      id: SEED_USERS.guildsAdmin.id,
      tenantId: null,
      role: SEED_USERS.guildsAdmin.role as UserRole,
      name: SEED_USERS.guildsAdmin.name,
      email: SEED_USERS.guildsAdmin.email,
      whatsapp: SEED_USERS.guildsAdmin.whatsapp,
    },
  });

  console.log('👥 Users created');

  // 4. Create default campaign and scripts per tenant to enable operational flow
  for (const tenantKey of ['A', 'B'] as const) {
    const tenant = SEED_TENANTS[tenantKey];

    const script = await prisma.script.create({
      data: {
        tenantId: tenant.id,
        name: `Roteiro Padrão - ${tenant.name}`,
        category: 'APPROACH',
        status: 'ACTIVE',
        baseMessage: 'Olá {{name}}, tudo bem? Vi seu contato no Google Maps e gostaria de apresentar nossos serviços.',
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        tenantId: tenant.id,
        name: `Campanha Inicial - ${tenant.name}`,
        profession: 'DOCTOR',
        status: 'ACTIVE',
        activeScriptId: script.id,
      },
    });

    // 5. Generate Leads
    const leadCount = tenantKey === 'A' ? SEED_LEAD_COUNT.tenantA : SEED_LEAD_COUNT.tenantB;
    const leadsData = [];
    for (let i = 1; i <= leadCount; i++) {
      const isA = tenantKey === 'A';
      const whatsapp = isA ? `+5517999991${i.toString().padStart(3, '0')}` : `+5511999992${i.toString().padStart(3, '0')}`;
      leadsData.push({
        tenantId: tenant.id,
        campaignId: campaign.id,
        source: 'GOOGLE_MAPS' as LeadSource,
        name: `Lead ${tenantKey} #${i}`,
        whatsapp,
        status: (i % 5 === 0 ? 'CONVERSING' : i % 8 === 0 ? 'MEETING_SCHEDULED' : 'CAPTURED') as LeadStatus,
        fitScore: 5.0 + (i % 5),
      });
    }

    // Use createMany since it's much faster
    await prisma.lead.createMany({
      data: leadsData,
    });
  }

  console.log('📈 Campaigns, scripts, and leads created');
  console.log('🌱 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
