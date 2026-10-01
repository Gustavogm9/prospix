import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  discoveryErrorMessage,
  discoveryErrorStatus,
  discoveryRequestSchema,
  isTrustedMutationOrigin,
} from '@/lib/discovery-request';
import { authenticateRequest, getSupabaseAdmin } from '../_lib/supabase-admin';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200, correlationId?: string) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
    },
  });
}

function requestFingerprint(request: NextRequest, userId: string): string | null {
  const salt = process.env.DISCOVERY_RATE_LIMIT_SALT;
  if (!salt) return process.env.NODE_ENV === 'production' ? null : `dev:${userId}`;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
  return createHmac('sha256', salt).update(`${userId}|${ip}`).digest('hex');
}

/**
 * Starts one authorized and budgeted lead-discovery run.
 * The browser never receives the service role key and cannot choose another tenant.
 */
export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  if (!isTrustedMutationOrigin({
    requestUrl: request.url,
    origin: request.headers.get('origin'),
    forwardedHost: request.headers.get('x-forwarded-host') || request.headers.get('host'),
    configuredAppUrl: process.env.NEXT_PUBLIC_APP_URL,
  })) {
    return json(
      { ok: false, error: { code: 'FORBIDDEN_ORIGIN', message: 'Origem da requisição não permitida.' } },
      403,
      correlationId,
    );
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  if (!/^[A-Za-z0-9:_-]{16,128}$/.test(idempotencyKey)) {
    return json(
      { ok: false, error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Atualize a tela e tente novamente.' } },
      400,
      correlationId,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json(
      { ok: false, error: { code: 'INVALID_JSON', message: 'Dados da busca inválidos.' } },
      400,
      correlationId,
    );
  }

  const parsed = discoveryRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Revise os campos da busca.' } },
      400,
      correlationId,
    );
  }

  const input = parsed.data;
  if (auth.role !== 'GUILDS_ADMIN' && auth.tenantId !== input.tenant_id) {
    return json(
      { ok: false, error: { code: 'DISCOVERY_FORBIDDEN', message: discoveryErrorMessage('DISCOVERY_FORBIDDEN') } },
      403,
      correlationId,
    );
  }

  const fingerprint = requestFingerprint(request, auth.userId);
  if (!fingerprint) {
    return json(
      { ok: false, error: { code: 'SERVER_NOT_CONFIGURED', message: 'Busca temporariamente indisponível.' } },
      503,
      correlationId,
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: gateResult, error: gateError } = await supabase.rpc('begin_prospecting_run', {
    p_user_id: auth.userId,
    p_tenant_id: input.tenant_id,
    p_campaign_id: input.campaign_id,
    p_source_type: input.source_type,
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: fingerprint,
    p_requested_limit: input.config.daily_limit,
    p_config: input.config,
    p_trigger_type: 'MANUAL',
  });

  if (gateError) {
    console.error('[discover] gate failed', { correlationId, code: gateError.code });
    return json(
      { ok: false, error: { code: 'DISCOVERY_GATE_FAILED', message: 'Não foi possível autorizar a busca.' } },
      500,
      correlationId,
    );
  }

  const gate = gateResult as {
    ok?: boolean;
    code?: string;
    replayed?: boolean;
    run_id?: string;
    status?: string;
    effective_limit?: number;
    remaining_budget_cents?: number;
  } | null;
  if (!gate?.ok || !gate.run_id) {
    const code = gate?.code || 'DISCOVERY_REJECTED';
    return json(
      { ok: false, error: { code, message: discoveryErrorMessage(code) } },
      discoveryErrorStatus(code),
      correlationId,
    );
  }

  if (gate.replayed) {
    return json({
      ok: true,
      replayed: true,
      run_id: gate.run_id,
      status: gate.status,
    }, 200, correlationId);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    await supabase.rpc('finish_prospecting_run', {
      p_run_id: gate.run_id,
      p_status: 'FAILED',
      p_discovered_count: 0,
      p_inserted_count: 0,
      p_duplicate_count: 0,
      p_eligible_count: 0,
      p_error_code: 'SERVER_NOT_CONFIGURED',
      p_error_message: 'Discovery function environment is incomplete',
    });
    return json(
      { ok: false, error: { code: 'SERVER_NOT_CONFIGURED', message: 'Busca temporariamente indisponível.' } },
      503,
      correlationId,
    );
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/discover-leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        'X-Prospix-Discovery-Run': gate.run_id,
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({
        tenant_id: input.tenant_id,
        campaign_id: input.campaign_id,
        source_type: input.source_type,
        run_id: gate.run_id,
        config: {
          ...input.config,
          daily_limit: gate.effective_limit,
        },
      }),
      signal: AbortSignal.timeout(55_000),
    });

    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || data?.ok === false) {
      console.warn('[discover] worker rejected run', {
        correlationId,
        runId: gate.run_id,
        status: response.status,
      });
      return json(
        { ok: false, run_id: gate.run_id, error: { code: 'DISCOVERY_WORKER_FAILED', message: 'A busca não foi concluída.' } },
        response.status >= 400 && response.status < 500 ? response.status : 502,
        correlationId,
      );
    }

    return json({
      ...data,
      run_id: gate.run_id,
      remaining_budget_cents: gate.remaining_budget_cents,
    }, 200, correlationId);
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'TimeoutError'
      ? 'DISCOVERY_TIMEOUT'
      : 'DISCOVERY_UPSTREAM_ERROR';
    await supabase.rpc('finish_prospecting_run', {
      p_run_id: gate.run_id,
      p_status: 'FAILED',
      p_discovered_count: 0,
      p_inserted_count: 0,
      p_duplicate_count: 0,
      p_eligible_count: 0,
      p_error_code: code,
      p_error_message: code,
    });
    console.error('[discover] upstream failed', { correlationId, runId: gate.run_id, code });
    return json(
      { ok: false, run_id: gate.run_id, error: { code, message: 'A busca não respondeu a tempo. Tente novamente.' } },
      504,
      correlationId,
    );
  }
}
