import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  shouldMoveColdToRecovery,
  shouldPromoteRecoveryToNormal,
} from '../supabase/functions/_shared/whatsapp-guardian-state.ts';

type TestResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  evidence: Record<string, unknown>;
};

type SupabaseClient = ReturnType<typeof createClient>;

const rootEnv = dotenv.config({ path: '.env' }).parsed || {};
const webEnv = dotenv.config({ path: 'apps/web/.env' }).parsed || {};
const env = { ...rootEnv, ...webEnv, ...process.env };

const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || serviceRoleKey;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
const realtimeClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false },
});

const runId = `phase11_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const tenantId = crypto.randomUUID();
const leadId = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const pendingId = crypto.randomUUID();
const instanceName = `${runId}_instance`;
const whatsappMessageId = `${runId}_wa_msg`;
const testPhone = `5511999${String(Date.now()).slice(-8)}`.slice(0, 13);
const authEmail = `${runId}@phase11.prospix.invalid`;
const authPassword = `Phase11!${runId}`;
const functionUrl = `${supabaseUrl}/functions/v1/webhook-evolution`;

const results: TestResult[] = [];
let authUserId: string | null = null;

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function timed(name: string, fn: () => Promise<Record<string, unknown>>) {
  const started = Date.now();
  try {
    const evidence = await fn();
    results.push({ name, ok: true, durationMs: Date.now() - started, evidence });
  } catch (err) {
    results.push({
      name,
      ok: false,
      durationMs: Date.now() - started,
      evidence: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

async function insertOrThrow(table: string, row: Record<string, unknown>) {
  const { error } = await supabase.from(table).insert(row);
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
}

async function updateOrThrow(table: string, patch: Record<string, unknown>, column: string, value: string) {
  const { error } = await supabase.from(table).update(patch).eq(column, value);
  if (error) throw new Error(`${table} update failed: ${error.message}`);
}

async function cleanup() {
  await realtimeClient.auth.signOut().catch(() => undefined);
  const deletions: Array<[string, string, string]> = [
    ['evolution_webhook_processing_events', 'instance_name', instanceName],
    ['notifications', 'tenant_id', tenantId],
    ['admin_disconnect_alert_deliveries', 'tenant_id', tenantId],
    ['admin_ai_activity_alert_deliveries', 'tenant_id', tenantId],
    ['operational_alerts', 'tenant_id', tenantId],
    ['lead_events', 'tenant_id', tenantId],
    ['pending_outbound', 'tenant_id', tenantId],
    ['messages', 'tenant_id', tenantId],
    ['conversations', 'tenant_id', tenantId],
    ['leads', 'tenant_id', tenantId],
    ['tenant_secrets', 'tenant_id', tenantId],
    ['whatsapp_connection_events', 'tenant_id', tenantId],
    ['whatsapp_guardian_state_transitions', 'tenant_id', tenantId],
    ['whatsapp_guardian_status', 'tenant_id', tenantId],
    ['users', 'tenant_id', tenantId],
    ['tenants', 'id', tenantId],
  ];

  for (const [table, column, value] of deletions) {
    const { error } = await supabase.from(table).delete().eq(column, value);
    if (error) {
      console.warn(`[cleanup] ${table}: ${error.message}`);
    }
  }

  if (authUserId) {
    const { error } = await supabase.auth.admin.deleteUser(authUserId);
    if (error && !error.message.toLowerCase().includes('not found')) {
      console.warn(`[cleanup] auth user: ${error.message}`);
    }
    authUserId = null;
  }
}

async function setupFixture() {
  const now = nowIso();
  await insertOrThrow('tenants', {
    id: tenantId,
    name: `Phase 11 Gate ${runId}`,
    slug: runId,
    plan: 'STANDARD',
    status: 'ACTIVE',
    mrr_cents: 0,
    updated_at: now,
    whatsapp_warmup_day: 1,
  });
  await insertOrThrow('tenant_secrets', {
    tenant_id: tenantId,
    ai_provider: 'GUILDS_SHARED',
    evolution_instance_name: instanceName,
    updated_at: now,
  });
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: authEmail,
    password: authPassword,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: 'OWNER' },
    user_metadata: { test_run: runId, tenant_id: tenantId, role: 'OWNER' },
  });
  if (authError || !authData.user?.id) {
    throw new Error(`auth user create failed: ${authError?.message || 'missing user id'}`);
  }
  authUserId = authData.user.id;
  await insertOrThrow('users', {
    id: authUserId,
    tenant_id: tenantId,
    email: authEmail,
    name: `Phase 11 User ${runId}`,
    role: 'OWNER',
    whatsapp: testPhone,
    updated_at: now,
  });
  const { error: signInError } = await realtimeClient.auth.signInWithPassword({
    email: authEmail,
    password: authPassword,
  });
  if (signInError) throw new Error(`realtime auth sign-in failed: ${signInError.message}`);
  const { data: sessionData, error: sessionError } = await realtimeClient.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error(`realtime auth session missing: ${sessionError?.message || 'missing access token'}`);
  }
  realtimeClient.realtime.setAuth(sessionData.session.access_token);
  await insertOrThrow('leads', {
    id: leadId,
    tenant_id: tenantId,
    name: `Phase 11 Lead ${runId}`,
    whatsapp: testPhone,
    source: 'MANUAL',
    status: 'ENRICHED',
    whatsapp_valid: true,
    updated_at: now,
    metadata: { test_run: runId },
  });
  await insertOrThrow('conversations', {
    id: conversationId,
    tenant_id: tenantId,
    lead_id: leadId,
    status: 'ACTIVE',
    ai_handling: false,
    message_count: 0,
    started_at: now,
    last_message_at: now,
  });
}

async function postWebhook(payload: Record<string, unknown>, timeoutMs = 12_000) {
  const started = Date.now();
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body, elapsedMs: Date.now() - started };
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 15_000): Promise<T> {
  const started = Date.now();
  let lastValue: T | null | undefined = null;
  while (Date.now() - started < timeoutMs) {
    lastValue = await fn();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} timed out. Last value: ${JSON.stringify(lastValue)}`);
}

async function testMigrationAcceptsRecovery() {
  const now = nowIso();
  const { error } = await supabase.from('whatsapp_guardian_status').upsert({
    tenant_id: tenantId,
    status: 'RECOVERY',
    external_state: 'open',
    external_checked_at: now,
    state_entered_at: now,
    updated_at: now,
  }, { onConflict: 'tenant_id' });
  if (error) throw new Error(`RECOVERY constraint rejected status: ${error.message}`);

  const { data, error: selectError } = await supabase
    .from('whatsapp_guardian_status')
    .select('status, external_state')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  assertCondition(data?.status === 'RECOVERY', `Expected RECOVERY, got ${data?.status}`);
  return { persistedStatus: data.status, externalState: data.external_state };
}

async function testColdOpenExpiredQuarantineMovesToRecovery() {
  const enteredAt = nowIso(-2 * 60 * 60 * 1000);
  await updateOrThrow('whatsapp_guardian_status', {
    status: 'COLD',
    external_state: 'open',
    external_checked_at: nowIso(-70 * 60 * 1000),
    connected_at: nowIso(-2 * 60 * 60 * 1000),
    quarantined_until: nowIso(-5 * 60 * 1000),
    circuit_open_until: null,
    last_disconnect_reason_code: null,
    state_entered_at: enteredAt,
    updated_at: nowIso(),
  }, 'tenant_id', tenantId);

  const pureDecision = shouldMoveColdToRecovery({
    guardianStatus: {
      status: 'COLD',
      external_state: 'open',
      connected_at: nowIso(-2 * 60 * 60 * 1000),
      quarantined_until: nowIso(-5 * 60 * 1000),
      circuit_open_until: null,
      last_disconnect_reason_code: null,
    },
    externalState: 'open',
    quarantineMinutes: 60,
  });
  assertCondition(pureDecision === true, 'Pure COLD/open expired-quarantine decision did not allow RECOVERY.');

  const response = await postWebhook({
    event: 'connection.update',
    instance: instanceName,
    data: {
      state: 'open',
      instance: { instanceName },
    },
  });
  assertCondition(response.ok, `connection.update failed: ${JSON.stringify(response.body)}`);

  const { data: status, error } = await supabase
    .from('whatsapp_guardian_status')
    .select('status, external_state, state_reason_code')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  assertCondition(status?.status === 'RECOVERY', `Expected RECOVERY after webhook, got ${status?.status}`);

  const { data: event } = await supabase
    .from('whatsapp_connection_events')
    .select('reason_code, local_status_before, local_status_after')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    pureDecision,
    webhookStatus: response.status,
    responseReason: response.body?.reason_code,
    persistedStatus: status.status,
    stateReasonCode: status.state_reason_code,
    lastEvent: event,
  };
}

async function testRecoveryPromotionGate() {
  const nowMs = Date.now();
  const baseStatus = {
    status: 'RECOVERY',
    external_state: 'open',
    state_entered_at: new Date(nowMs - 61 * 60 * 1000).toISOString(),
    circuit_open_until: null,
  };
  const positive = shouldPromoteRecoveryToNormal({
    guardianStatus: baseStatus,
    externalState: 'open',
    minDurationMinutes: 60,
    minSuccessfulSends: 2,
    successfulSends: 2,
    criticalEvents: 0,
    duePending: 0,
    nowMs,
  });
  const blockedByDuration = shouldPromoteRecoveryToNormal({
    guardianStatus: { ...baseStatus, state_entered_at: new Date(nowMs - 30 * 60 * 1000).toISOString() },
    externalState: 'open',
    minDurationMinutes: 60,
    minSuccessfulSends: 2,
    successfulSends: 2,
    criticalEvents: 0,
    duePending: 0,
    nowMs,
  });
  const blockedBySends = shouldPromoteRecoveryToNormal({
    guardianStatus: baseStatus,
    externalState: 'open',
    minDurationMinutes: 60,
    minSuccessfulSends: 2,
    successfulSends: 1,
    criticalEvents: 0,
    duePending: 0,
    nowMs,
  });
  const blockedByCritical = shouldPromoteRecoveryToNormal({
    guardianStatus: baseStatus,
    externalState: 'open',
    minDurationMinutes: 60,
    minSuccessfulSends: 2,
    successfulSends: 2,
    criticalEvents: 1,
    duePending: 0,
    nowMs,
  });
  const blockedByDueQueue = shouldPromoteRecoveryToNormal({
    guardianStatus: baseStatus,
    externalState: 'open',
    minDurationMinutes: 60,
    minSuccessfulSends: 2,
    successfulSends: 2,
    criticalEvents: 0,
    duePending: 1,
    nowMs,
  });

  assertCondition(positive === true, 'Expected promotion only when every gate is satisfied.');
  assertCondition(blockedByDuration === false, 'Promotion should block before minimum duration.');
  assertCondition(blockedBySends === false, 'Promotion should block before minimum successful sends.');
  assertCondition(blockedByCritical === false, 'Promotion should block when critical events exist.');
  assertCondition(blockedByDueQueue === false, 'Promotion should block while due queue exists.');

  return { positive, blockedByDuration, blockedBySends, blockedByCritical, blockedByDueQueue };
}

async function testAtomicQueueClaimConcurrency() {
  await insertOrThrow('pending_outbound', {
    id: pendingId,
    tenant_id: tenantId,
    conversation_id: conversationId,
    content: `Phase 11 concurrency ${runId}`,
    scheduled_for: nowIso(-60_000),
    created_at: nowIso(-60_000),
    idempotency_key: `${runId}_pending`,
    attempts: 0,
    message_type: 'REACTIVE_REPLY',
    priority: 1,
  });

  const claim = (owner: string) => supabase.rpc('claim_due_pending_outbound', {
    p_tenant_id: tenantId,
    p_owner: owner,
    p_limit: 1,
    p_claim_ttl_seconds: 900,
    p_excluded_conversation_ids: [],
  });

  const [left, right] = await Promise.all([claim(`${runId}_worker_a`), claim(`${runId}_worker_b`)]);
  if (left.error) throw new Error(`left claim failed: ${left.error.message}`);
  if (right.error) throw new Error(`right claim failed: ${right.error.message}`);

  const leftRows = Array.isArray(left.data) ? left.data : [];
  const rightRows = Array.isArray(right.data) ? right.data : [];
  const claimedIds = [...leftRows, ...rightRows].map((row: any) => row.id);
  assertCondition(claimedIds.length === 1, `Expected exactly one row claimed, got ${claimedIds.length}`);
  assertCondition(claimedIds[0] === pendingId, `Unexpected claimed id: ${claimedIds[0]}`);

  const { data: row } = await supabase
    .from('pending_outbound')
    .select('id, processing_owner, processing_expires_at')
    .eq('id', pendingId)
    .maybeSingle();

  return {
    leftClaimed: leftRows.length,
    rightClaimed: rightRows.length,
    claimedIds,
    persistedOwner: row?.processing_owner,
    processingExpiresAt: row?.processing_expires_at,
  };
}

async function testWebhookDuplicateDoesNotDuplicateMessage() {
  const payload = {
    event: 'messages.upsert',
    instance: instanceName,
    data: {
      key: {
        id: whatsappMessageId,
        remoteJid: `${testPhone}@s.whatsapp.net`,
        fromMe: false,
      },
      pushName: `Phase 11 Lead ${runId}`,
      messageType: 'conversation',
      message: {
        conversation: `Mensagem duplicada controlada ${runId}`,
      },
    },
  };

  const first = await postWebhook(payload);
  const second = await postWebhook(payload);
  assertCondition(first.ok && first.body?.accepted === true, `first webhook not accepted: ${JSON.stringify(first)}`);
  assertCondition(second.ok && second.body?.accepted === true, `second webhook not accepted: ${JSON.stringify(second)}`);

  const ledger = await waitFor('webhook duplicate ledger', async () => {
    const { data } = await supabase
      .from('evolution_webhook_processing_events')
      .select('id, status, attempts, tenant_id, message_id, result')
      .eq('event_name', 'messages.upsert')
      .eq('instance_name', instanceName)
      .eq('whatsapp_message_id', whatsappMessageId)
      .maybeSingle();
    if (data && Number(data.attempts || 0) >= 2 && ['PROCESSED', 'SKIPPED'].includes(String(data.status))) {
      return data;
    }
    return null;
  }, 20_000);

  const { count: messageCount, error: messageError } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('whatsapp_message_id', whatsappMessageId);
  if (messageError) throw new Error(messageError.message);

  const { count: leadEventCount } = await supabase
    .from('lead_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .eq('event_type', 'message_received');

  assertCondition(messageCount === 1, `Expected one message for duplicate webhook, got ${messageCount}`);
  assertCondition(leadEventCount === 1, `Expected one lead_event, got ${leadEventCount}`);

  return {
    firstAckMs: first.elapsedMs,
    secondAckMs: second.elapsedMs,
    ledgerAttempts: ledger.attempts,
    ledgerStatus: ledger.status,
    messageCount,
    leadEventCount,
  };
}

async function testTimeoutGuards() {
  const sendMessagesSource = readFileSync('supabase/functions/send-messages/index.ts', 'utf8');
  const webhookSource = readFileSync('supabase/functions/webhook-evolution/index.ts', 'utf8');

  const staticChecks = {
    evolutionSendTimeout: sendMessagesSource.includes('EVOLUTION_SEND_TIMEOUT_MS')
      && sendMessagesSource.includes('AbortSignal.timeout(timeoutMs)'),
    openAiHelperTimeout: sendMessagesSource.includes('OPENAI_HELPER_TIMEOUT_MS')
      && sendMessagesSource.includes('AbortSignal.timeout(timeoutMs)'),
    openAiWebhookTimeout: webhookSource.includes('OPENAI_WEBHOOK_TIMEOUT_MS')
      && webhookSource.includes('AbortSignal.timeout(timeoutMs)'),
  };

  assertCondition(staticChecks.evolutionSendTimeout, 'send-messages Evolution send timeout guard not found.');
  assertCondition(staticChecks.openAiHelperTimeout, 'send-messages OpenAI helper timeout guard not found.');
  assertCondition(staticChecks.openAiWebhookTimeout, 'webhook-evolution OpenAI timeout guard not found.');

  const server = createServer((_req, _res) => {
    // Intentionally never respond; the client timeout must abort this request.
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  assertCondition(port, 'Could not start local hanging server.');

  const started = Date.now();
  let aborted = false;
  let errorName = '';
  try {
    await fetch(`http://127.0.0.1:${port}/hang`, {
      signal: AbortSignal.timeout(350),
    });
  } catch (err: any) {
    aborted = true;
    errorName = String(err?.name || err?.message || err);
  } finally {
    server.close();
  }
  const elapsedMs = Date.now() - started;
  assertCondition(aborted, 'Hanging request was not aborted.');
  assertCondition(elapsedMs < 1500, `Abort took too long: ${elapsedMs}ms`);

  return { staticChecks, abortRuntime: { aborted, errorName, elapsedMs } };
}

async function testPanelRealtimeWithoutReload() {
  const panelSource = readFileSync('apps/web/src/app/(dashboard)/configuracoes/page.tsx', 'utf8');
  const requiredTables = [
    'whatsapp_guardian_status',
    'whatsapp_connection_events',
    'whatsapp_guardian_state_transitions',
    'pending_outbound',
    'leads',
    'conversations',
    'messages',
  ];
  const staticChecks = {
    usesPostgresChanges: panelSource.includes("'postgres_changes'"),
    usesTenantFilter: panelSource.includes('filter: `tenant_id=eq.${tenantId}`'),
    authenticatesRealtimeSocket: panelSource.includes('supabase.realtime.setAuth'),
    noLocationReload: !panelSource.includes('location.reload'),
    tablesPresent: requiredTables.filter((table) => panelSource.includes(`'${table}'`)),
  };
  assertCondition(staticChecks.usesPostgresChanges, 'Panel does not subscribe to postgres_changes.');
  assertCondition(staticChecks.usesTenantFilter, 'Panel realtime subscription is not tenant-filtered.');
  assertCondition(staticChecks.authenticatesRealtimeSocket, 'Panel does not sync the authenticated JWT into the Realtime socket.');
  assertCondition(staticChecks.noLocationReload, 'Panel source contains location.reload.');
  assertCondition(staticChecks.tablesPresent.length === requiredTables.length, 'Panel does not subscribe to every operational table.');

  let realtimePayload: any = null;
  let updatesSent = 0;
  const subscribedAt = Date.now();
  const channel = realtimeClient.channel(`phase11-whatsapp-status:${tenantId}`);
  try {
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_guardian_status',
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload) => {
        realtimePayload = payload;
      },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Realtime subscribe timeout.')), 10_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          reject(new Error(`Realtime subscription failed: ${status}`));
        }
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    let lastRealtimeError: unknown = null;
    for (let attempt = 1; attempt <= 3 && !realtimePayload; attempt += 1) {
      updatesSent = attempt;
      const updateAt = nowIso();
      await updateOrThrow('whatsapp_guardian_status', {
        state_reason_code: `PHASE11_REALTIME_GATE_${attempt}`,
        external_checked_at: updateAt,
        updated_at: updateAt,
      }, 'tenant_id', tenantId);

      try {
        await waitFor('realtime whatsapp_guardian_status update', async () => realtimePayload, attempt === 3 ? 12_000 : 5_000);
      } catch (err) {
        lastRealtimeError = err;
      }
    }

    if (!realtimePayload && lastRealtimeError) {
      throw lastRealtimeError;
    }
    assertCondition(realtimePayload, 'Realtime update payload was not received.');
  } finally {
    await realtimeClient.removeChannel(channel).catch(() => undefined);
  }

  return {
    staticChecks,
    subscribedInMs: Date.now() - subscribedAt,
    updatesSent,
    receivedEvent: realtimePayload?.eventType,
    receivedTenantId: realtimePayload?.new?.tenant_id,
    receivedUpdatedAt: realtimePayload?.new?.updated_at,
    receivedReasonCode: realtimePayload?.new?.state_reason_code,
  };
}

async function main() {
  try {
    await cleanup();
    await setupFixture();
    await timed('Migration: constraint aceita RECOVERY', testMigrationAcceptsRecovery);
    await timed('Worker/Webhook: COLD/open/quarentena expirada -> RECOVERY', testColdOpenExpiredQuarantineMovesToRecovery);
    await timed('Recovery: promove NORMAL somente com todos os gates satisfeitos', testRecoveryPromotionGate);
    await timed('Concurrency: dois workers nao pegam a mesma mensagem', testAtomicQueueClaimConcurrency);
    await timed('Webhook: duplicidade nao duplica mensagem', testWebhookDuplicateDoesNotDuplicateMessage);
    await timed('Timeout: Evolution/OpenAI travados nao travam runtime', testTimeoutGuards);
    await timed('Painel: status muda em realtime sem reload', testPanelRealtimeWithoutReload);
  } finally {
    await cleanup();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    runId,
    tenantId,
    ok: failed.length === 0,
    results,
  }, null, 2));
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({
    runId,
    tenantId,
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    results,
  }, null, 2));
  process.exit(1);
});
