import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, getSupabaseAdmin } from '../../../_lib/supabase-admin';
import { listCalendars } from '../../../_lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/calendar/calendars
 *
 * Returns the list of Google Calendars available to the
 * authenticated tenant so the user can pick which one to sync.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Retrieve tenant secrets
    const { data: secretRecord } = await supabaseAdmin
      .from('tenant_secrets')
      .select('google_oauth_refresh_encrypted')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!secretRecord || !secretRecord.google_oauth_refresh_encrypted) {
      return NextResponse.json(
        {
          error: 'NotConfigured',
          message:
            'Google Calendar integration is not configured. Connect via Settings → Integrations.',
        },
        { status: 400 }
      );
    }

    const refreshToken = secretRecord.google_oauth_refresh_encrypted as string;

    // 2. Fetch calendars from Google
    const calendars = await listCalendars(refreshToken);

    return NextResponse.json({ calendars });
  } catch (err) {
    console.error('Error listing Google Calendars:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to list Google Calendars' },
      { status: 500 }
    );
  }
}
