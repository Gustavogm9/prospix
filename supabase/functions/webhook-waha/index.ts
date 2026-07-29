// ProspIX - Supabase Edge Function: Webhook from WAHA
// Normalizes WAHA events into the existing Evolution-compatible processing path.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function toLoggableText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch (_err) {
    return String(value ?? '');
  }
}

function redactText(value: unknown): string {
  return toLoggableText(value)
    .replace(/55\d{10,13}/g, '[PHONE_REDACTED]')
    .replace(/[A-Za-z0-9_=-]{48,}/g, '[TOKEN_REDACTED]')
    .slice(0, 1000);
}

function redactPayload(value: unknown): Record<string, unknown> {
  return { preview: redactText(value) };
}

async function shortHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value || 'unknown');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getPath(value: unknown, path: string[]): unknown {
  let current: any = value;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return null;
    current = current[key];
  }
  return current;
}

function extractSession(payload: any): string {
  return String(
    payload?.session ||
      payload?.instance ||
      payload?.instanceName ||
      payload?.payload?.session ||
      payload?.payload?.sessionName ||
      '',
  );
}

function extractWahaMessageId(payload: any): string {
  return String(
    payload?.payload?.id ||
      payload?.payload?._data?.id?.id ||
      payload?.payload?.key?.id ||
      payload?.id ||
      '',
  );
}

function normalizeWahaEvent(event: unknown): string {
  return String(event || '').toLowerCase();
}

function mapWahaStatus(status: unknown): { state: string; reasonCode: string | null } {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'WORKING') return { state: 'open', reasonCode: null };
  if (normalized === 'SCAN_QR_CODE') return { state: 'connecting', reasonCode: 'WA_WAHA_QR_REQUIRED' };
  if (normalized === 'STARTING') return { state: 'connecting', reasonCode: 'WA_WAHA_STARTING' };
  if (normalized === 'STOPPED') return { state: 'closed', reasonCode: 'WA_WAHA_STOPPED' };
  if (normalized === 'FAILED') return { state: 'close', reasonCode: 'WA_WAHA_FAILED' };
  return { state: normalized ? normalized.toLowerCase() : 'unknown', reasonCode: 'WA_WAHA_STATUS_UNKNOWN' };
}

function mapWahaAckStatus(ack: unknown): string | number | null {
  const normalized = String(ack || '').toUpperCase();
  if (ack === 3 || normalized === 'DELIVERY_ACK' || normalized === 'DEVICE') return 'DELIVERY_ACK';
  if (ack === 4 || normalized === 'READ') return 'READ';
  if (ack === 5 || normalized === 'PLAYED') return 'PLAYED';
  return null;
}

function normalizeWahaPayload(payload: any): { normalized: Record<string, unknown> | null; skipReason?: string } {
  const event = normalizeWahaEvent(payload?.event);
  const session = extractSession(payload);

  if (!session) {
    return { normalized: null, skipReason: 'missing session' };
  }

  if (event === 'session.status' || event === 'session_status') {
    const status = payload?.payload?.status || payload?.status || getPath(payload, ['data', 'status']);
    const mapped = mapWahaStatus(status);
    return {
      normalized: {
        event: 'CONNECTION_UPDATE',
        instance: session,
        data: {
          instance: {
            instanceName: session,
            state: mapped.state,
          },
          state: mapped.state,
          statusReason: mapped.reasonCode,
          provider: 'WAHA',
          waha_status: status || null,
          waha_payload: payload,
        },
      },
    };
  }

  if (event === 'message' || event === 'message.any') {
    const message = payload?.payload || {};
    const messageId = extractWahaMessageId(payload);
    const remoteJid = String(message.from || message.to || message.chatId || '');
    const text = String(message.body || message.text || message.caption || '');
    const fromMe = Boolean(message.fromMe);

    if (!messageId) {
      return { normalized: null, skipReason: 'missing message id' };
    }

    return {
      normalized: {
        event: 'MESSAGES_UPSERT',
        instance: session,
        data: {
          key: {
            id: messageId,
            remoteJid,
            fromMe,
          },
          message: {
            conversation: text,
            extendedTextMessage: { text },
          },
          messageType: 'conversation',
          pushName: message.pushName || message.notifyName || null,
          messageTimestamp: message.timestamp || null,
          provider: 'WAHA',
          waha_payload: payload,
        },
      },
    };
  }

  if (event === 'message.ack' || event === 'message_ack') {
    const message = payload?.payload || {};
    const messageId = extractWahaMessageId(payload);
    const status = mapWahaAckStatus(message.ack ?? message.ackName ?? message.status);

    if (!messageId || !status) {
      return { normalized: null, skipReason: 'unsupported ack' };
    }

    return {
      normalized: {
        event: 'MESSAGES_UPDATE',
        instance: session,
        data: {
          keyId: messageId,
          key: { id: messageId },
          status,
          provider: 'WAHA',
          waha_payload: payload,
        },
      },
    };
  }

  return { normalized: null, skipReason: `unsupported event: ${payload?.event || 'unknown'}` };
}

async function recordWebhookEvent(params: {
  payload: any;
  normalized: Record<string, unknown> | null;
  status: 'ACCEPTED' | 'SKIPPED' | 'PROCESSED' | 'FAILED';
  skipReason?: string | null;
  errorMessage?: string | null;
}): Promise<string | null> {
  try {
    const event = String(params.payload?.event || 'unknown');
    const instanceName = extractSession(params.payload) || null;
    const providerMessageId = extractWahaMessageId(params.payload) || null;
    const remoteJid = String(params.payload?.payload?.from || params.payload?.payload?.to || '');

    const { data } = await supabase
      .from('whatsapp_webhook_processing_events')
      .insert({
        provider: 'WAHA',
        event_name: event,
        instance_name: instanceName,
        provider_message_id: providerMessageId,
        provider_message_id_hash: providerMessageId ? await shortHash(providerMessageId) : null,
        remote_jid_hash: remoteJid ? await shortHash(remoteJid) : null,
        from_me: typeof params.payload?.payload?.fromMe === 'boolean'
          ? params.payload.payload.fromMe
          : null,
        status: params.status,
        skip_reason: params.skipReason || null,
        error_message: params.errorMessage || null,
        result: params.normalized ? { normalized_event: params.normalized.event || null } : {},
        payload_redacted: redactPayload(params.payload),
        processing_started_at: params.status === 'ACCEPTED' ? new Date().toISOString() : null,
        processed_at: params.status === 'PROCESSED' ? new Date().toISOString() : null,
        failed_at: params.status === 'FAILED' ? new Date().toISOString() : null,
      })
      .select('id')
      .maybeSingle();

    return data?.id || null;
  } catch (err) {
    console.warn('[webhook-waha] ledger skipped:', redactText(err));
    return null;
  }
}

async function updateWebhookEvent(
  id: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!id) return;
  try {
    await supabase
      .from('whatsapp_webhook_processing_events')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', id);
  } catch (err) {
    console.warn('[webhook-waha] ledger update skipped:', redactText(err));
  }
}

async function verifyWahaWebhookSecret(
  instanceName: string,
  req: Request,
): Promise<{ ok: boolean; status: number; reason: string }> {
  const supplied = req.headers.get('x-prospix-webhook-secret') || '';
  try {
    const { data, error } = await supabase
      .from('whatsapp_channels')
      .select('webhook_secret')
      .eq('provider', 'WAHA')
      .eq('instance_name', instanceName)
      .eq('active', true)
      .maybeSingle();

    if (error || !data?.webhook_secret) {
      return { ok: false, status: 202, reason: 'waha channel webhook secret not configured' };
    }

    if (supplied && supplied === data.webhook_secret) {
      return { ok: true, status: 200, reason: 'ok' };
    }

    return { ok: false, status: 401, reason: 'invalid waha webhook secret' };
  } catch (err) {
    console.warn('[webhook-waha] webhook secret check failed:', redactText(err));
    return { ok: false, status: 503, reason: 'waha webhook secret check failed' };
  }
}

async function forwardToEvolutionProcessor(normalized: Record<string, unknown>): Promise<{
  status: number;
  ok: boolean;
  body: string;
}> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/webhook-evolution`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(normalized),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text().catch(() => '');
  return {
    status: response.status,
    ok: response.ok,
    body: body.slice(0, 1500),
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-Prospix-Webhook-Secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'method not allowed' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (_err) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { normalized, skipReason } = normalizeWahaPayload(payload);
  if (!normalized) {
    await recordWebhookEvent({
      payload,
      normalized,
      status: 'SKIPPED',
      skipReason,
    });
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: skipReason }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const instanceName = String(normalized.instance || extractSession(payload) || '');
  const secretCheck = await verifyWahaWebhookSecret(instanceName, req);
  if (!secretCheck.ok) {
    await recordWebhookEvent({
      payload,
      normalized,
      status: 'SKIPPED',
      skipReason: secretCheck.reason,
    });
    return new Response(
      JSON.stringify({
        ok: secretCheck.status === 202,
        skipped: true,
        reason: secretCheck.reason,
      }),
      {
        status: secretCheck.status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const ledgerId = await recordWebhookEvent({
    payload,
    normalized,
    status: 'ACCEPTED',
  });

  try {
    const forwarded = await forwardToEvolutionProcessor(normalized);
    await updateWebhookEvent(ledgerId, {
      status: forwarded.ok ? 'PROCESSED' : 'FAILED',
      processed_at: forwarded.ok ? new Date().toISOString() : null,
      failed_at: forwarded.ok ? null : new Date().toISOString(),
      error_message: forwarded.ok ? null : `forwarded HTTP ${forwarded.status}`,
      result: {
        forwarded_status: forwarded.status,
        forwarded_ok: forwarded.ok,
        forwarded_body_preview: redactText(forwarded.body),
      },
    });

    return new Response(
      JSON.stringify({
        ok: forwarded.ok,
        forwarded_status: forwarded.status,
        provider: 'WAHA',
        normalized_event: normalized.event,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    await updateWebhookEvent(ledgerId, {
      status: 'FAILED',
      failed_at: new Date().toISOString(),
      error_message: redactText(err),
      result: { error: redactText(err) },
    });
    return new Response(
      JSON.stringify({
        ok: false,
        provider: 'WAHA',
        normalized_event: normalized.event,
        error: 'forward failed',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
});
