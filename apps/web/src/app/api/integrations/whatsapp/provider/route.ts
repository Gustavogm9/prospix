import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';
import {
  fetchWahaSession,
  loadTenantWahaChannel,
} from '../../../_lib/whatsapp-provider';

async function readRequestBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    return await request.json();
  } catch (_err) {
    return {};
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;
  const body = await readRequestBody(request);
  const provider = String(body.provider || '').toUpperCase();
  const action = String(body.action || '').toLowerCase();

  if (provider !== 'WAHA' || action !== 'promote') {
    return NextResponse.json(
      { error: 'BadRequest', message: 'Acao de provedor invalida.' },
      { status: 400 }
    );
  }

  const channel = await loadTenantWahaChannel(supabaseAdmin, tenantId);
  if (!channel?.id) {
    return NextResponse.json(
      { error: 'NotFound', message: 'Canal WAHA nao encontrado para este tenant.' },
      { status: 404 }
    );
  }

  if (!channel.apiKey) {
    return NextResponse.json(
      { error: 'ConfigurationError', message: 'Canal WAHA sem chave configurada.' },
      { status: 500 }
    );
  }

  const session = await fetchWahaSession(channel);
  if (!session.ok || session.status !== 'WORKING') {
    return NextResponse.json(
      {
        error: 'WahaNotReady',
        message: 'O WAHA ainda nao esta conectado. Leia o QR Code antes de ativar como principal.',
        sessionStatus: session.status,
      },
      { status: 409 }
    );
  }

  const { data: promoted, error: promoteError } = await (supabaseAdmin as any)
    .rpc('promote_whatsapp_channel_to_primary', {
      p_tenant_id: tenantId,
      p_channel_id: channel.id,
      p_source: 'settings_provider_promote',
    })
    .maybeSingle();

  if (promoteError || !promoted) {
    console.error('Failed to promote WAHA channel:', promoteError);
    return NextResponse.json(
      { error: 'DatabaseError', message: 'Nao foi possivel ativar WAHA como canal principal.' },
      { status: 500 }
    );
  }

  const nowIso = new Date().toISOString();
  const { data: previousStatus } = await supabaseAdmin
    .from('whatsapp_guardian_status')
    .select('status')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  await supabaseAdmin
    .from('whatsapp_guardian_status')
    .upsert(
      {
        tenant_id: tenantId,
        status: 'NORMAL',
        external_state: 'open',
        external_checked_at: nowIso,
        last_disconnect_reason_code: null,
        quarantined_until: null,
        circuit_open_until: null,
        state_entered_at: nowIso,
        state_reason_code: 'WAHA_PRIMARY_PROMOTED',
        state_source: 'settings_provider_promote',
        updated_at: nowIso,
      },
      { onConflict: 'tenant_id' }
    );

  await supabaseAdmin
    .from('whatsapp_guardian_state_transitions')
    .insert({
      tenant_id: tenantId,
      previous_status: previousStatus?.status || null,
      status: 'NORMAL',
      external_state: 'open',
      reason_code: 'WAHA_PRIMARY_PROMOTED',
      source: 'settings_provider_promote',
      impact_level: 'INFO',
      operation_state: 'ACTIVE',
      operator_summary: 'WAHA conectado foi ativado como canal principal do tenant.',
      allow_send: true,
      allow_new_active: true,
      entered_at: nowIso,
      metadata: {
        provider: 'WAHA',
        instance_name: channel.instanceName,
      },
    });

  return NextResponse.json({
    success: true,
    provider: 'WAHA',
    instanceName: promoted.instance_name,
  });
}
