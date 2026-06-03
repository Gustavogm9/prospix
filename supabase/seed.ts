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

  // 1. Clear existing data safely via REST deletes (respecting FK constraints)
  console.log('🧹 Clearing existing database tables in cascade order...');
  try {
    await db.from('messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('conversations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('health_profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('campaigns').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('scripts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('tenant_secrets').delete().neq('tenant_id', '00000000-0000-0000-0000-000000000000');
    await db.from('tenant_ai_configs').delete().neq('tenant_id', '00000000-0000-0000-0000-000000000000');
    await db.from('tenants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log('🧹 Database tables cleared successfully');
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
