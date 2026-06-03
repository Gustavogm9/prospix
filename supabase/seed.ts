/**
 * Prospix · Supabase Seed Script
 * 
 * Replaces the old Prisma seed.ts. Uses Supabase Admin client
 * to create tenants, users (both in DB and Supabase Auth), campaigns,
 * scripts, and leads.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { SEED_TENANTS, SEED_USERS, SEED_LEAD_COUNT } from '../packages/mocks/src/index.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Seed-safe tenant IDs (only these can be deleted by seed) ────────────────
const SEED_SAFE_TENANT_IDS = [
  '11111111-1111-1111-1111-111111111111', // Seed tenant A
  '22222222-2222-2222-2222-222222222222', // Seed tenant B
];

// ── Seed-safe SUPABASE_URL allowlist (NEVER add production URLs here) ───────
const SEED_SAFE_URLS = [
  'http://localhost:54321', // local Supabase
  'http://127.0.0.1:54321',
];

function assertSeedIsAllowed() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error(`🚫 REFUSED: Cannot seed a ${nodeEnv} database.`);
  }

  if (process.env.ALLOW_DESTRUCTIVE_SEED !== '1') {
    throw new Error('🚫 REFUSED: Requires ALLOW_DESTRUCTIVE_SEED=1. This script truncates application tables.');
  }

  if (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 12) {
    throw new Error('🚫 REFUSED: SEED_ADMIN_PASSWORD with at least 12 characters is required.');
  }
}

/**
 * CRITICAL: Checks if the target database contains real (non-seed) data.
 * If real tenants, users, or leads exist, REFUSE to proceed.
 */
async function assertNoRealData() {
  console.log('🛡️  Checking for real (non-seed) data in target database...');

  // Check 1: Verify SUPABASE_URL is in allowlist OR force explicit override
  const url = process.env.SUPABASE_URL || '';
  const isLocalUrl = SEED_SAFE_URLS.some(safe => url.startsWith(safe));
  if (!isLocalUrl) {
    console.warn(`⚠️  WARNING: SUPABASE_URL (${url}) is NOT a local development URL.`);
    if (process.env.SEED_FORCE_REMOTE !== 'YES_I_KNOW_THIS_WILL_DELETE_ALL_DATA') {
      throw new Error(
        `🚫 REFUSED: SUPABASE_URL "${url}" looks like a remote/production database.\n` +
        `   If you REALLY want to seed this remote database, set:\n` +
        `   SEED_FORCE_REMOTE=YES_I_KNOW_THIS_WILL_DELETE_ALL_DATA\n` +
        `   ⚠️  THIS WILL PERMANENTLY DELETE ALL DATA IN THE DATABASE.`
      );
    }
    console.warn('⚠️  SEED_FORCE_REMOTE override detected. Proceeding with remote database...');
  }

  // Check 2: Look for non-seed tenants
  const { data: tenants } = await db.from('tenants').select('id, name, slug');
  const realTenants = (tenants || []).filter(t => !SEED_SAFE_TENANT_IDS.includes(t.id));
  if (realTenants.length > 0) {
    console.error('🚫 REAL TENANTS DETECTED:');
    realTenants.forEach(t => console.error(`   - ${t.name} (${t.id})`));
    throw new Error(
      `🚫 REFUSED: Found ${realTenants.length} real (non-seed) tenant(s) in the database.\n` +
      `   This database contains PRODUCTION DATA that would be permanently destroyed.\n` +
      `   Seed is ONLY safe on empty databases or databases with seed-only data.\n` +
      `   Real tenants: ${realTenants.map(t => t.name).join(', ')}`
    );
  }

  // Check 3: Look for non-seed users (users with emails not matching seed patterns)
  const { data: users } = await db.from('users').select('id, email, tenant_id');
  const seedEmails = ['giovane@seed.prospix.dev', 'roberta@seed.prospix.dev', 'gustavo.macedo@guilds.com.br'];
  const realUsers = (users || []).filter(u => 
    !seedEmails.includes(u.email) && 
    (u.tenant_id === null || SEED_SAFE_TENANT_IDS.includes(u.tenant_id))
  );
  // Also check: users pointing to non-seed tenants
  const usersWithRealTenants = (users || []).filter(u => 
    u.tenant_id && !SEED_SAFE_TENANT_IDS.includes(u.tenant_id)
  );
  if (usersWithRealTenants.length > 0) {
    console.error('🚫 USERS WITH REAL TENANTS DETECTED:');
    usersWithRealTenants.forEach(u => console.error(`   - ${u.email} (tenant=${u.tenant_id})`));
    throw new Error(
      `🚫 REFUSED: Found ${usersWithRealTenants.length} user(s) linked to real tenants.\n` +
      `   This database contains PRODUCTION DATA.`
    );
  }

  // Check 4: Count leads to show what would be destroyed
  const { count: leadCount } = await db.from('leads').select('id', { count: 'exact', head: true });
  const { count: convoCount } = await db.from('conversations').select('id', { count: 'exact', head: true });
  const { count: msgCount } = await db.from('messages').select('id', { count: 'exact', head: true });

  console.log('🛡️  Pre-seed data summary:');
  console.log(`   Tenants: ${tenants?.length || 0} (all seed-safe)`);
  console.log(`   Users: ${users?.length || 0}`);
  console.log(`   Leads: ${leadCount || 0}`);
  console.log(`   Conversations: ${convoCount || 0}`);
  console.log(`   Messages: ${msgCount || 0}`);
  console.log('🛡️  No real data detected. Safe to proceed with seed.');
}

async function main() {
  assertSeedIsAllowed();

  console.log('🌱 Start seeding database via Supabase...');

  // ── CRITICAL: Check for real data before ANY destructive operation ─────────
  await assertNoRealData();

  // 1. Clear existing SEED data safely (only seed-safe tenant data)
  console.log('🧹 Clearing seed-safe database tables in cascade order...');
  try {
    // Delete only data belonging to seed tenants
    for (const tenantId of SEED_SAFE_TENANT_IDS) {
      await db.from('messages').delete().eq('tenant_id', tenantId);
      await db.from('conversations').delete().eq('tenant_id', tenantId);
      await db.from('health_profiles').delete().eq('tenant_id', tenantId);
      await db.from('leads').delete().eq('tenant_id', tenantId);
      await db.from('campaigns').delete().eq('tenant_id', tenantId);
      await db.from('scripts').delete().eq('tenant_id', tenantId);
      await db.from('users').delete().eq('tenant_id', tenantId);
      await db.from('tenant_secrets').delete().eq('tenant_id', tenantId);
      await db.from('tenant_ai_configs').delete().eq('tenant_id', tenantId);
      await db.from('tenants').delete().eq('id', tenantId);
    }
    // Also clean up seed admin users (no tenant)
    await db.from('users').delete().eq('email', 'gustavo.macedo@guilds.com.br');
    console.log('🧹 Seed-safe tables cleared successfully (real data preserved)');
  } catch (cleanErr: any) {
    console.warn('⚠️ Warning while cleaning tables, trying to proceed anyway:', cleanErr.message);
  }

  // 2. Create Tenants
  for (const tenantKey of ['A', 'B'] as const) {
    const data = SEED_TENANTS[tenantKey];
    const nowStr = new Date().toISOString();
    const { error } = await db.from('tenants').insert({
      id: data.id,
      slug: data.slug,
      name: data.name,
      status: data.status,
      plan: data.plan,
      segment: data.segment,
      mrr_cents: 15000,
      created_at: nowStr,
      updated_at: nowStr,
    });
    if (error) throw new Error(`Failed to create tenant ${tenantKey}: ${error.message}`);

    // Create Tenant Secret
    await db.from('tenant_secrets').insert({
      tenant_id: data.id,
      evolution_instance_name: `tenant_${data.slug.replace('-dev', '')}`,
      created_at: nowStr,
      updated_at: nowStr,
    });

    // Create Tenant AI Config
    await db.from('tenant_ai_configs').insert({
      tenant_id: data.id,
      system_model: 'gpt-4o-mini',
      classifier_model: 'gpt-4o-mini',
      guardrail_model: 'gpt-4o-mini',
      created_at: nowStr,
      updated_at: nowStr,
    });
  }
  console.log('🏢 Tenants, secrets and AI configs created');

  // 3. Create Users (both in DB and Supabase Auth)
  const rawSeedPassword = process.env.SEED_ADMIN_PASSWORD || 'prospix_dev_password_123';

  const usersToCreate = [
    { ...SEED_USERS.ownerA, password: rawSeedPassword },
    { ...SEED_USERS.ownerB, password: rawSeedPassword },
    { ...SEED_USERS.guildsAdmin, password: rawSeedPassword, tenantId: null },
    // NOTE: Real production users (giovanerodrigues1234@gmail.com, admin@prospix.com, 
    // corretor@prospix.com) are NOT created by seed. They exist only in production
    // and must NEVER be overwritten by seed data.
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
    const nowStr = new Date().toISOString();
    const { error: dbError } = await db.from('users').insert({
      id: u.id,
      tenant_id: u.tenantId,
      role: u.role,
      name: u.name,
      email: u.email,
      whatsapp: u.whatsapp,
      created_at: nowStr,
      updated_at: nowStr,
    });
    if (dbError) {
      console.warn(`⚠️ DB user creation warning for ${u.email}: ${dbError.message}`);
    }
  }

  console.log('👥 Users created (including custom admin@prospix.com and corretor@prospix.com)');

  // 4. Create default campaign and scripts per tenant
  for (const tenantKey of ['A', 'B'] as const) {
    const tenant = SEED_TENANTS[tenantKey];

    const nowStr = new Date().toISOString();
    const scriptId = crypto.randomUUID();
    const { error: scriptErr } = await db.from('scripts').insert({
      id: scriptId,
      tenant_id: tenant.id,
      name: `Roteiro Padrão - ${tenant.name}`,
      category: 'APPROACH',
      status: 'ACTIVE',
      base_message: 'Olá {{name}}, tudo bem? Vi seu contato no Google Maps e gostaria de apresentar nossos serviços.',
      created_at: nowStr,
      updated_at: nowStr,
    });
    if (scriptErr) throw new Error(`Script creation failed: ${scriptErr.message}`);

    const campaignId = crypto.randomUUID();
    const { error: campErr } = await db.from('campaigns').insert({
      id: campaignId,
      tenant_id: tenant.id,
      name: `Campanha Inicial - ${tenant.name}`,
      profession: 'DOCTOR',
      status: 'ACTIVE',
      active_script_id: scriptId,
      created_at: nowStr,
      updated_at: nowStr,
    });
    if (campErr) throw new Error(`Campaign creation failed: ${campErr.message}`);

    // 5. Generate Leads
    const leadCount = tenantKey === 'A' ? SEED_LEAD_COUNT.tenantA : SEED_LEAD_COUNT.tenantB;
    const leadsData = [];
    const healthProfilesData = [];
    const conversationsData = [];
    const messagesData = [];

    for (let i = 1; i <= leadCount; i++) {
      const isA = tenantKey === 'A';
      const whatsapp = isA ? `+5517999991${i.toString().padStart(3, '0')}` : `+5511999992${i.toString().padStart(3, '0')}`;
      const status = i % 5 === 0 ? 'CONVERSING' : i % 8 === 0 ? 'MEETING_SCHEDULED' : 'CAPTURED';
      const leadId = crypto.randomUUID();
      
      const hasCnpj = i % 3 === 0;
      const metadata = hasCnpj ? {
        cnpj_info: {
          cnpj: `12345678000${i.toString().padStart(3, '0')}`,
          razaoSocial: `EMPRESA EXEMPLO ${i} LTDA`,
          nomeFantasia: `NOME FANTASIA ${i}`,
          situacaoCadastral: 'ATIVA',
          dataInicioAtividade: `2018-0${(i % 9) + 1}-10`,
          cnaeFiscal: '6911701',
          uf: 'SP',
          municipio: 'SAO JOSE DO RIO PRETO',
          bairro: 'Redentora',
          qsa: [
            { nome: `Socio Administrador ${i}`, qual: 'Sócio-Administrador' },
            { nome: `Socio Cotista ${i}`, qual: 'Sócio' }
          ]
        }
      } : {};

      const nowStr = new Date().toISOString();
      leadsData.push({
        id: leadId,
        tenant_id: tenant.id,
        campaign_id: campaignId,
        source: 'GOOGLE_MAPS',
        name: isA && i === 5 ? 'Dra. Roberta Castellani' : isA && i === 8 ? 'Dr. Rodrigo Maluf' : `Lead ${tenantKey} #${i}`,
        whatsapp,
        status,
        fit_score: 5.0 + (i % 5) + (i % 2 === 0 ? 0.4 : 0.8),
        metadata: metadata as any,
        profession: i % 2 === 0 ? 'LAWYER' : 'DOCTOR',
        created_at: nowStr,
        updated_at: nowStr,
      });

      // Health profile for conversing/scheduled leads
      if (status === 'CONVERSING' || status === 'MEETING_SCHEDULED') {
        healthProfilesData.push({
          tenant_id: tenant.id,
          lead_id: leadId,
          smoker: i % 4 === 0,
          physical_activity: i % 3 === 0 ? 'Não pratica' : 'Sim · musculação 3x/semana',
          weight_kg: 70 + (i % 20),
          height_cm: 165 + (i % 20),
          bmi_calculated: 22.5 + (i % 5),
          pre_existing_diseases: i % 5 === 0 ? 'Hipertensão leve' : 'Não declarada',
          continuous_medication: i % 5 === 0 ? 'Losartana 50mg' : 'Não',
          recent_surgery: i % 6 === 0,
          family_history: {
            father: i % 2 === 0 ? 'Hipertensão · 73 anos' : 'Sem doença declarada',
            mother: 'Sem doença declarada',
            siblings: 'Sem doença declarada'
          } as any,
          risk_category: i % 4 === 0 ? 'medium' : 'low',
          estimated_premium_min_cents: 45000 + (i % 10) * 1000,
          estimated_premium_max_cents: 65000 + (i % 10) * 1000,
          updated_at: nowStr,
          collected_at: nowStr
        });

        // Seed active conversation
        const conversationId = crypto.randomUUID();
        conversationsData.push({
          id: conversationId,
          tenant_id: tenant.id,
          lead_id: leadId,
          status: 'ACTIVE',
          ai_handling: status === 'CONVERSING',
          started_at: new Date(Date.now() - 3600000).toISOString(),
          last_message_at: nowStr,
        });

        // Seed conversational messages
        messagesData.push(
          {
            id: crypto.randomUUID(),
            tenant_id: tenant.id,
            conversation_id: conversationId,
            direction: 'INBOUND' as const,
            sender: 'USER' as const, // lead
            content: 'Olá! Vi seu contato.',
            delivery_status: 'DELIVERED' as const,
            created_at: new Date(Date.now() - 3000 * 1000).toISOString(),
          },
          {
            id: crypto.randomUUID(),
            tenant_id: tenant.id,
            conversation_id: conversationId,
            direction: 'OUTBOUND' as const,
            sender: 'AI' as const,
            content: 'Olá! Como posso ajudar você hoje com seguros de vida e previdência?',
            delivery_status: 'DELIVERED' as const,
            created_at: new Date(Date.now() - 2500 * 1000).toISOString(),
          },
          {
            id: crypto.randomUUID(),
            tenant_id: tenant.id,
            conversation_id: conversationId,
            direction: 'INBOUND' as const,
            sender: 'USER' as const,
            content: 'Gostaria de uma cotação de seguro de vida.',
            delivery_status: 'DELIVERED' as const,
            created_at: new Date(Date.now() - 2000 * 1000).toISOString(),
          },
          {
            id: crypto.randomUUID(),
            tenant_id: tenant.id,
            conversation_id: conversationId,
            direction: 'OUTBOUND' as const,
            sender: 'AI' as const,
            content: 'Perfeito! Para fazermos uma simulação precisa da MetLife, você poderia me informar se é fumante?',
            delivery_status: 'DELIVERED' as const,
            created_at: new Date(Date.now() - 1500 * 1000).toISOString(),
          },
          {
            id: crypto.randomUUID(),
            tenant_id: tenant.id,
            conversation_id: conversationId,
            direction: 'INBOUND' as const,
            sender: 'USER' as const,
            content: 'Não sou fumante.',
            delivery_status: 'DELIVERED' as const,
            created_at: new Date(Date.now() - 1000 * 1000).toISOString(),
          }
        );
      }
    }

    // Insert leads in batches of 100
    for (let i = 0; i < leadsData.length; i += 100) {
      const batch = leadsData.slice(i, i + 100);
      const { error: leadErr } = await db.from('leads').insert(batch);
      if (leadErr) throw new Error(`Lead insertion failed: ${leadErr.message}`);
    }

    // Insert health profiles
    if (healthProfilesData.length > 0) {
      const { error: hpErr } = await db.from('health_profiles').insert(healthProfilesData);
      if (hpErr) throw new Error(`Health profile insertion failed: ${hpErr.message}`);
    }

    // Insert conversations
    if (conversationsData.length > 0) {
      const { error: convErr } = await db.from('conversations').insert(conversationsData);
      if (convErr) throw new Error(`Conversation insertion failed: ${convErr.message}`);
    }

    // Insert messages
    if (messagesData.length > 0) {
      const { error: msgErr } = await db.from('messages').insert(messagesData);
      if (msgErr) throw new Error(`Message insertion failed: ${msgErr.message}`);
    }
  }

  console.log('📈 Campaigns, scripts, and leads created');
  console.log('🌱 Seeding completed successfully!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
