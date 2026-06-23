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

    // Call Evolution API fetchInstances to get rich metadata about the instances
    const evoRes = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(4000),
    });

    if (!evoRes.ok) {
      // Se a chamada global falhar, tente a connectionState como fallback
      try {
        const fallbackRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
          headers: { apikey: apiKey },
          signal: AbortSignal.timeout(3000),
        });
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          const state = fallbackData?.instance?.state ?? fallbackData?.state;
          return NextResponse.json({
            status: state === 'open' ? 'connected' : 'disconnected',
            reason: 'other',
            configured: true,
            instanceName,
          });
        }
      } catch (_e) {}

      return NextResponse.json({
        status: 'disconnected',
        configured: true,
        instanceName,
        error: 'CONNECTION_STATE_UNAVAILABLE',
      });
    }

    const instances = await evoRes.json();
    const instance = Array.isArray(instances)
      ? instances.find((inst: any) => inst.name === instanceName || inst.instanceName === instanceName)
      : null;

    if (!instance) {
      return NextResponse.json({
        status: 'disconnected',
        configured: true,
        instanceName,
        reason: 'instance_not_found'
      });
    }

    const isConnected = instance.connectionStatus === 'open' || instance.connectionState?.state === 'open';
    let reason = 'other';

    if (!isConnected && instance.disconnectionObject) {
      try {
        const discObj = typeof instance.disconnectionObject === 'string'
          ? JSON.parse(instance.disconnectionObject)
          : instance.disconnectionObject;
        const errTag = discObj?.error?.data?.content?.[0]?.attrs?.type || discObj?.error?.data?.tag;
        if (errTag === 'device_removed' || JSON.stringify(discObj).includes('device_removed')) {
          reason = 'device_removed';
        }
      } catch (_e) {
        if (JSON.stringify(instance.disconnectionObject).includes('device_removed')) {
          reason = 'device_removed';
        }
      }
    }

    return NextResponse.json({
      status: isConnected ? 'connected' : 'disconnected',
      reason: isConnected ? null : reason,
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
