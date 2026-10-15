import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';
import { loadTenantWhatsAppChannel, logoutWahaSession } from '../../../_lib/whatsapp-provider';
import { readStoredSecret } from '@/lib/secrets';

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId, role } = auth;

  if (role !== 'OWNER' && role !== 'GUILDS_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Somente o proprietário pode desconectar o WhatsApp.' },
      { status: 403 },
    );
  }

  try {
    const activeChannel = await loadTenantWhatsAppChannel(supabaseAdmin, tenantId);
    if (activeChannel?.provider === 'WAHA') {
      await logoutWahaSession(activeChannel);
      const nowIso = new Date().toISOString();

      if (activeChannel.id) {
        await supabaseAdmin
          .from('whatsapp_channels')
          .update({
            connection_status: 'DISCONNECTED',
            external_state: 'logout_requested',
            disconnected_at: nowIso,
            last_checked_at: nowIso,
            last_error: null,
          })
          .eq('id', activeChannel.id);
      }

      await supabaseAdmin
        .from('whatsapp_guardian_status')
        .upsert(
          {
            tenant_id: tenantId,
            status: 'SUSPENDED',
            external_state: 'logout_requested',
            state_reason_code: 'WA_LOGOUT_REQUESTED',
            last_disconnect_reason_code: 'WA_LOGOUT_REQUESTED',
            external_checked_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: 'tenant_id' }
        );

      return NextResponse.json({
        success: true,
        provider: 'WAHA',
        message: 'WhatsApp session disconnected successfully',
      });
    }

    const { data: secretRecord } = await supabaseAdmin
      .from('tenant_secrets')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!secretRecord || !secretRecord.evolution_instance_name) {
      return NextResponse.json(
        { error: 'BadRequest', message: 'WhatsApp integration is not configured' },
        { status: 400 }
      );
    }

    const instanceName = secretRecord.evolution_instance_name;
    const baseUrl = secretRecord.evolution_base_url || process.env.EVOLUTION_BASE_URL;
    const apiKey = secretRecord.evolution_api_key_encrypted
      ? readStoredSecret(secretRecord.evolution_api_key_encrypted, undefined, {
          allowLegacyPlaintext: process.env.ALLOW_LEGACY_PLAINTEXT_SECRETS === 'true',
        })
      : process.env.EVOLUTION_GUILDS_API_KEY || '';

    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: 'ConfigurationError', message: 'Evolution API não configurada.' },
        { status: 503 },
      );
    }

    // Logout instance
    await fetch(`${baseUrl}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: { apikey: apiKey },
    });

    // Delete instance
    await fetch(`${baseUrl}/instance/delete/${instanceName}`, {
      method: 'DELETE',
      headers: { apikey: apiKey },
    });

    // Clear the API key in tenant_secrets
    await supabaseAdmin
      .from('tenant_secrets')
      .update({
        evolution_api_key_encrypted: null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    return NextResponse.json({ success: true, message: 'WhatsApp session disconnected successfully' });
  } catch (err) {
    console.error('Error disconnecting WhatsApp integration:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to process WhatsApp integration request' },
      { status: 500 }
    );
  }
}
