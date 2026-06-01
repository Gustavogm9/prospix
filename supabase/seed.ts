/**
 * Prospix · Supabase Seed Script
 * 
 * Replaces the old Prisma seed.ts. Uses Supabase Admin client
 * to create tenants, users (both in DB and Supabase Auth), campaigns,
 * scripts, and leads.
 */
import { createClient } from '@supabase/supabase-js';
import { SEED_TENANTS, SEED_USERS, SEED_LEAD_COUNT } from '@prospix/mocks';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertSeedIsAllowed() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error(`Refusing to seed a ${nodeEnv} database.`);
  }

  if (process.env.ALLOW_DESTRUCTIVE_SEED !== '1') {
    throw new Error('Refusing to seed without ALLOW_DESTRUCTIVE_SEED=1. This script truncates application tables.');
  }

  if (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD with at least 12 characters is required.');
  }
}

async function main() {
  assertSeedIsAllowed();

  console.log('🌱 Start seeding database via Supabase...');

  // 1. Clear existing data safely via RPC (TRUNCATE CASCADE)
  const { error: truncErr } = await db.rpc('truncate_seed_tables' as any);
  if (truncErr) {
    console.warn('⚠️ truncate_seed_tables RPC not found, skipping truncation. You may need to create it.');
  } else {
    console.log('🧹 Database truncated');
  }

  // 2. Create Tenants
  for (const tenantKey of ['A', 'B'] as const) {
    const data = SEED_TENANTS[tenantKey];
    const { error } = await db.from('tenants').insert({
      id: data.id,
      slug: data.slug,
      name: data.name,
      status: data.status,
      plan: data.plan,
      segment: data.segment,
      mrr_cents: 15000,
    });
    if (error) throw new Error(`Failed to create tenant ${tenantKey}: ${error.message}`);

    // Create Tenant Secret
    await db.from('tenant_secrets').insert({
      tenant_id: data.id,
      evolution_instance_name: `tenant_${data.slug.replace('-dev', '')}`,
    });

    // Create Tenant AI Config
    await db.from('tenant_ai_configs').insert({
      tenant_id: data.id,
      system_model: 'gpt-4o-mini',
      classifier_model: 'gpt-4o-mini',
      guardrail_model: 'gpt-4o-mini',
    });
  }
  console.log('🏢 Tenants, secrets and AI configs created');

  // 3. Create Users (both in DB and Supabase Auth)
  const rawSeedPassword = process.env.SEED_ADMIN_PASSWORD || 'prospix_dev_password_123';

  const usersToCreate = [
    { ...SEED_USERS.ownerA, password: rawSeedPassword },
    { ...SEED_USERS.ownerB, password: rawSeedPassword },
    { ...SEED_USERS.guildsAdmin, password: rawSeedPassword, tenantId: null },
    {
      id: '11111111-1111-1111-1111-111111111111',
      tenantId: null,
      role: 'GUILDS_ADMIN',
      name: 'Admin Prospix',
      email: 'admin@prospix.com',
      whatsapp: '+5511988880001',
      password: 'ProspixAdmin2026!',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      tenantId: SEED_TENANTS.A.id,
      role: 'OWNER',
      name: 'Corretor Prospix',
      email: 'corretor@prospix.com',
      whatsapp: '+5511988880002',
      password: 'CorretorProspix2026!',
    },
  ];

  for (const u of usersToCreate) {
    // Create in Supabase Auth
    const { error: authError } = await db.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      app_metadata: { tenant_id: u.tenantId, role: u.role },
      user_metadata: { name: u.name },
    });
    if (authError && !authError.message.includes('already registered')) {
      console.warn(`⚠️ Auth user creation warning for ${u.email}: ${authError.message}`);
    }

    // Create in DB
    const { error: dbError } = await db.from('users').insert({
      id: u.id,
      tenant_id: u.tenantId,
      role: u.role,
      name: u.name,
      email: u.email,
      whatsapp: u.whatsapp,
    });
    if (dbError) {
      console.warn(`⚠️ DB user creation warning for ${u.email}: ${dbError.message}`);
    }
  }

  console.log('👥 Users created (including custom admin@prospix.com and corretor@prospix.com)');

  // 4. Create default campaign and scripts per tenant
  for (const tenantKey of ['A', 'B'] as const) {
    const tenant = SEED_TENANTS[tenantKey];

    const { data: script, error: scriptErr } = await db.from('scripts').insert({
      tenant_id: tenant.id,
      name: `Roteiro Padrão - ${tenant.name}`,
      category: 'APPROACH',
      status: 'ACTIVE',
      base_message: 'Olá {{name}}, tudo bem? Vi seu contato no Google Maps e gostaria de apresentar nossos serviços.',
    }).select('id').single();
    if (scriptErr) throw new Error(`Script creation failed: ${scriptErr.message}`);

    const { data: campaign, error: campErr } = await db.from('campaigns').insert({
      tenant_id: tenant.id,
      name: `Campanha Inicial - ${tenant.name}`,
      profession: 'DOCTOR',
      status: 'ACTIVE',
      active_script_id: script!.id,
    }).select('id').single();
    if (campErr) throw new Error(`Campaign creation failed: ${campErr.message}`);

    // 5. Generate Leads
    const leadCount = tenantKey === 'A' ? SEED_LEAD_COUNT.tenantA : SEED_LEAD_COUNT.tenantB;
    const leadsData = [];
    for (let i = 1; i <= leadCount; i++) {
      const isA = tenantKey === 'A';
      const whatsapp = isA ? `+5517999991${i.toString().padStart(3, '0')}` : `+5511999992${i.toString().padStart(3, '0')}`;
      leadsData.push({
        tenant_id: tenant.id,
        campaign_id: campaign!.id,
        source: 'GOOGLE_MAPS',
        name: `Lead ${tenantKey} #${i}`,
        whatsapp,
        status: i % 5 === 0 ? 'CONVERSING' : i % 8 === 0 ? 'MEETING_SCHEDULED' : 'CAPTURED',
        fit_score: 5.0 + (i % 5),
      });
    }

    // Insert in batches of 100
    for (let i = 0; i < leadsData.length; i += 100) {
      const batch = leadsData.slice(i, i + 100);
      const { error: leadErr } = await db.from('leads').insert(batch);
      if (leadErr) throw new Error(`Lead insertion failed: ${leadErr.message}`);
    }
  }

  console.log('📈 Campaigns, scripts, and leads created');
  console.log('🌱 Seeding completed successfully!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
