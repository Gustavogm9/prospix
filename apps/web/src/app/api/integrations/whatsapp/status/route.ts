import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';

export async function GET(request: NextRequest) {
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
      return NextResponse.json({
        status: 'disconnected',
        configured: false,
        instanceName: null,
      });
    }

    const instanceName = secretRecord.evolution_instance_name;
    const baseUrl = secretRecord.evolution_base_url || process.env.EVOLUTION_BASE_URL;
    const apiKey = secretRecord.evolution_api_key_encrypted || process.env.EVOLUTION_GUILDS_API_KEY || '';

    // Call Evolution API to check connection state with a 4-second timeout limit
    const evoRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(4000),
    });

    if (!evoRes.ok) {
      return NextResponse.json({
        status: 'disconnected',
        configured: true,
        instanceName,
        error: 'CONNECTION_STATE_UNAVAILABLE',
      });
    }

    const evoData = await evoRes.json();
    const state = evoData?.instance?.state ?? evoData?.state;

    return NextResponse.json({
      status: state === 'open' ? 'connected' : 'disconnected',
      configured: true,
      instanceName,
    });
  } catch (err) {
    console.error('Error getting WhatsApp connection status:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to process WhatsApp integration request' },
      { status: 500 }
    );
  }
}
