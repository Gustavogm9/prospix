import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const rootEnv = dotenv.config({ path: '.env' }).parsed || {};
const webEnv = dotenv.config({ path: 'apps/web/.env' }).parsed || {};
const env = { ...rootEnv, ...webEnv, ...process.env };

const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || serviceRoleKey;

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Missing Supabase env vars.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

const runId = `phase12_rt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const tenantId = crypto.randomUUID();
const authEmail = `${runId}@phase12.prospix.invalid`;
const authPassword = `Phase12!${runId}`;
let authUserId: string | null = null;

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function cleanup() {
  await userClient.auth.signOut().catch(() => undefined);
  await admin.from('whatsapp_guardian_status').delete().eq('tenant_id', tenantId);
  await admin.from('users').delete().eq('tenant_id', tenantId);
  await admin.from('tenants').delete().eq('id', tenantId);
  if (authUserId) {
    await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    authUserId = null;
  }
}

async function insertFixture() {
  const now = nowIso();
  await admin.from('tenants').insert({
    id: tenantId,
    name: `Phase 12 Realtime ${runId}`,
    slug: runId,
    plan: 'STANDARD',
    status: 'ACTIVE',
    mrr_cents: 0,
    updated_at: now,
  }).throwOnError();
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: authPassword,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: 'OWNER' },
    user_metadata: { tenant_id: tenantId, role: 'OWNER', test_run: runId },
  });
  if (authError || !authData.user?.id) throw new Error(authError?.message || 'missing auth user');
  authUserId = authData.user.id;
  await admin.from('users').insert({
    id: authUserId,
    tenant_id: tenantId,
    email: authEmail,
    name: `Phase 12 User ${runId}`,
    role: 'OWNER',
    whatsapp: `5511998${String(Date.now()).slice(-8)}`.slice(0, 13),
    updated_at: now,
  }).throwOnError();
  await admin.from('whatsapp_guardian_status').insert({
    tenant_id: tenantId,
    status: 'RECOVERY',
    external_state: 'open',
    state_reason_code: 'PHASE12_REALTIME_DIAGNOSTIC_BASELINE',
    state_source: 'phase12-realtime-diagnostic',
    state_entered_at: now,
    updated_at: now,
  }).throwOnError();

  const { error: signInError } = await userClient.auth.signInWithPassword({
    email: authEmail,
    password: authPassword,
  });
  if (signInError) throw new Error(`sign in failed: ${signInError.message}`);
  const { data: sessionData, error: sessionError } = await userClient.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error(`missing session: ${sessionError?.message || 'no token'}`);
  }
  userClient.realtime.setAuth(sessionData.session.access_token);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await cleanup();
  const events: any[] = [];
  const dbReads: any[] = [];
  let channel: any = null;
  try {
    await insertFixture();
    channel = userClient.channel(`phase12-rt:${tenantId}`);
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_guardian_status',
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload: any) => {
        events.push({
          at: nowIso(),
          eventType: payload.eventType,
          tenantId: payload.new?.tenant_id,
          reason: payload.new?.state_reason_code,
          updatedAt: payload.new?.updated_at,
        });
      },
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('subscribe timeout')), 10_000);
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer);
          reject(new Error(status));
        }
      });
    });

    await wait(1500);

    for (let i = 1; i <= 5; i += 1) {
      const updateAt = nowIso();
      const reason = `PHASE12_REALTIME_DIAGNOSTIC_${i}`;
      await admin.from('whatsapp_guardian_status').update({
        state_reason_code: reason,
        external_checked_at: updateAt,
        updated_at: updateAt,
      }).eq('tenant_id', tenantId).throwOnError();
      await wait(1500);
      const { data, error } = await admin
        .from('whatsapp_guardian_status')
        .select('tenant_id, state_reason_code, updated_at')
        .eq('tenant_id', tenantId)
        .single();
      if (error) throw new Error(error.message);
      dbReads.push({ afterUpdate: i, reason: data.state_reason_code, updatedAt: data.updated_at });
    }

    await wait(3000);
    console.log(JSON.stringify({
      runId,
      tenantId,
      subscribed: true,
      updatesSent: 5,
      realtimeEventsReceived: events.length,
      events,
      dbReads,
      ok: events.length === 5,
    }, null, 2));
  } finally {
    if (channel) await userClient.removeChannel(channel).catch(() => undefined);
    await cleanup();
  }
}

main();
