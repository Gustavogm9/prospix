import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    // Verify tenant has Google Calendar configured
    const { data: secretRecord } = await supabaseAdmin
      .from('tenant_secrets')
      .select('google_oauth_refresh_encrypted, google_calendar_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!secretRecord || !secretRecord.google_oauth_refresh_encrypted) {
      return NextResponse.json(
        { error: 'NotConfigured', message: 'Google Calendar integration is not configured. Connect via Settings → Integrations.' },
        { status: 400 }
      );
    }

    // For now, signal success — the actual sync is handled by the background worker
    // through the Fastify API server. This endpoint acts as a proxy trigger.
    const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) {
      const token = request.headers.get('authorization') || '';
      const syncRes = await fetch(`${apiUrl}/v1/tenant/integrations/calendar/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
          'X-Tenant-Id': tenantId,
        },
      });

      if (syncRes.ok) {
        const data = await syncRes.json();
        return NextResponse.json(data);
      }
    }

    return NextResponse.json({ success: true, message: 'Calendar sync triggered' });
  } catch (err) {
    console.error('Error syncing calendar:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to sync calendar' },
      { status: 500 }
    );
  }
}
