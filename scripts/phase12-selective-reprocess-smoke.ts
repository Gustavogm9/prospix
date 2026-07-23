import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const rootEnv = dotenv.config({ path: '.env' }).parsed || {};
const webEnv = dotenv.config({ path: 'apps/web/.env' }).parsed || {};
const env = { ...rootEnv, ...webEnv, ...process.env };

const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const runId = `phase12_reprocess_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const eventId = crypto.randomUUID();
const instanceName = `${runId}_instance`;
const whatsappMessageId = `${runId}_wa_msg`;
const dispatcherUrl = `${supabaseUrl}/functions/v1/admin-monitoring-dispatcher`;

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count || 0;
}

async function cleanup() {
  await supabase.from('evolution_webhook_processing_events').delete().eq('id', eventId);
}

async function postDispatcher(body: Record<string, unknown>) {
  const started = Date.now();
  const response = await fetch(dispatcherUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ ...body, source: 'phase12-selective-reprocess-smoke' }),
    signal: AbortSignal.timeout(20_000),
  });
  const parsed = await response.json().catch(() => ({}));
  return {
    httpStatus: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - started,
    body: parsed,
  };
}

async function waitForEventFinalStatus(timeoutMs = 15_000) {
  const started = Date.now();
  let last: any = null;
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await supabase
      .from('evolution_webhook_processing_events')
      .select('id, status, attempts, skip_reason, error_message, result, updated_at')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`event lookup failed: ${error.message}`);
    last = data;
    const status = String(data?.status || '').toUpperCase();
    if (['PROCESSED', 'SKIPPED', 'FAILED'].includes(status) && Number(data?.attempts || 0) >= 2) {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`event final status timed out. Last value: ${JSON.stringify(last)}`);
}

async function main() {
  await cleanup();
  try {
    const payload = {
      event: 'messages.upsert',
      instance: instanceName,
      data: {
        key: {
          id: whatsappMessageId,
          remoteJid: '120363123456789012@g.us',
          fromMe: false,
        },
        message: {
          conversation: 'Smoke test de reprocessamento seletivo Fase 12.',
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    };

    const failedAt = nowIso(-10 * 60 * 1000);
    const { error: insertError } = await supabase
      .from('evolution_webhook_processing_events')
      .insert({
        id: eventId,
        event_name: 'messages.upsert',
        instance_name: instanceName,
        whatsapp_message_id: whatsappMessageId,
        from_me: false,
        status: 'FAILED',
        error_message: 'PHASE12_SYNTHETIC_FAILED_EVENT',
        attempts: 1,
        payload,
        payload_redacted: {
          event: 'messages.upsert',
          instance: instanceName,
          data: { key: { id: whatsappMessageId, remoteJid: 'group-redacted@g.us', fromMe: false } },
        },
        accepted_at: failedAt,
        processing_started_at: failedAt,
        failed_at: failedAt,
        updated_at: failedAt,
        last_seen_at: failedAt,
      });
    if (insertError) throw new Error(`processing event insert failed: ${insertError.message}`);

    const dryRun = await postDispatcher({
      mode: 'webhook_reprocess',
      processing_event_id: eventId,
      dry_run: true,
      reason: 'Smoke test Fase 12: validar elegibilidade do reprocessamento seletivo.',
    });
    const dryRunResult = dryRun.body?.result || dryRun.body;
    assertCondition(
      dryRun.ok && dryRunResult?.ok === true && dryRunResult?.dry_run === true,
      `dry-run reprocess did not return ok: ${JSON.stringify(dryRun)}`,
    );
    assertCondition(
      dryRunResult?.replayable === true,
      `dry-run did not mark FAILED event as replayable: ${JSON.stringify(dryRunResult)}`,
    );

    const replay = await postDispatcher({
      mode: 'webhook_reprocess',
      processing_event_id: eventId,
      dry_run: false,
      reason: 'Smoke test Fase 12: executar reprocessamento seletivo com payload sintético seguro.',
    });
    const replayResult = replay.body?.result || replay.body;
    assertCondition(
      replay.ok && replayResult?.status === 'ACCEPTED',
      `reprocess execution was not accepted: ${JSON.stringify(replay)}`,
    );

    const finalEvent = await waitForEventFinalStatus();
    assertCondition(finalEvent.status === 'SKIPPED', `synthetic group message should be skipped, got ${finalEvent.status}.`);
    assertCondition(finalEvent.skip_reason === 'group message', `unexpected skip reason: ${finalEvent.skip_reason}`);

    const { data: runs, error: runsError } = await supabase
      .from('evolution_webhook_reprocess_runs')
      .select('id, dry_run, status, previous_status, previous_attempts, response_status, error, completed_at')
      .eq('processing_event_id', eventId)
      .order('created_at', { ascending: true });
    if (runsError) throw new Error(`runs lookup failed: ${runsError.message}`);

    const messageCount = await countRows('messages', 'whatsapp_message_id', whatsappMessageId);
    assertCondition(messageCount === 0, `synthetic reprocess created ${messageCount} message row(s).`);

    const evidence = {
      runId,
      eventId,
      ok: true,
      dryRun: {
        httpStatus: dryRun.httpStatus,
        elapsedMs: dryRun.elapsedMs,
        runId: dryRunResult?.run_id,
        replayable: dryRunResult?.replayable,
        status: dryRunResult?.status,
        previousStatus: dryRunResult?.previous_status,
      },
      replay: {
        httpStatus: replay.httpStatus,
        elapsedMs: replay.elapsedMs,
        runId: replayResult?.run_id,
        status: replayResult?.status,
        previousStatus: replayResult?.previous_status,
        responseStatus: replayResult?.response_status,
      },
      finalEvent: {
        status: finalEvent.status,
        attempts: finalEvent.attempts,
        skipReason: finalEvent.skip_reason,
        updatedAt: finalEvent.updated_at,
      },
      auditRuns: runs,
      sideEffects: {
        messagesWithSyntheticWhatsappId: messageCount,
      },
    };

    await cleanup();
    const cleanupEvidence = {
      processingEventsRemaining: await countRows('evolution_webhook_processing_events', 'id', eventId),
      reprocessRunsRemaining: await countRows('evolution_webhook_reprocess_runs', 'processing_event_id', eventId),
      messagesRemaining: await countRows('messages', 'whatsapp_message_id', whatsappMessageId),
    };

    console.log(JSON.stringify({ ...evidence, cleanup: cleanupEvidence }, null, 2));
  } catch (err) {
    await cleanup();
    throw err;
  }
}

main();
