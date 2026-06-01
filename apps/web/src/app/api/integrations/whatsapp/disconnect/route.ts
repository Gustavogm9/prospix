import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
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
    const apiKey = process.env.EVOLUTION_GUILDS_API_KEY || '';

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
