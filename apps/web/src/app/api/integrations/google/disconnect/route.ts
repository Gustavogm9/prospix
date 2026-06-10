import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId, role } = auth;

  if (role !== 'OWNER' && role !== 'GUILDS_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Only tenant owners can manage integration credentials' },
      { status: 403 }
    );
  }

  try {
    const { error } = await supabaseAdmin
      .from('tenant_secrets')
      .update({
        google_oauth_refresh_encrypted: null,
        google_calendar_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error disconnecting Google Calendar:', error);
      return NextResponse.json(
        { error: 'InternalServerError', message: 'Failed to disconnect Google Calendar' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Google Calendar disconnected successfully.' });
  } catch (err) {
    console.error('Disconnect API error:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
