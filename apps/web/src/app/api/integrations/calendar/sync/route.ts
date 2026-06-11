import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, getSupabaseAdmin } from '../../../_lib/supabase-admin';
import { listEvents } from '../../../_lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/calendar/sync
 *
 * Fetches Google Calendar events for the current and next week,
 * tagging any that originated from Prospix.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Retrieve tenant secrets
    const { data: secretRecord } = await supabaseAdmin
      .from('tenant_secrets')
      .select('google_oauth_refresh_encrypted, google_calendar_id')
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
    const calendarId = (secretRecord.google_calendar_id as string) || 'primary';

    // 2. Calculate time window: start of current week (Monday 00:00 BRT)
    //    to end of next week (Sunday 23:59 BRT).
    //    BRT = UTC-3, represented as America/Sao_Paulo.
    const now = new Date();

    // Get current day of week (0=Sun, 1=Mon, …)
    const dayOfWeek = now.getDay();
    // Offset to reach the previous Monday (or today if Monday)
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + mondayOffset);
    startOfWeek.setHours(0, 0, 0, 0);

    // End of next week = startOfWeek + 14 days - 1 ms
    const endOfNextWeek = new Date(startOfWeek);
    endOfNextWeek.setDate(startOfWeek.getDate() + 14);
    endOfNextWeek.setMilliseconds(endOfNextWeek.getMilliseconds() - 1);

    const timeMin = startOfWeek.toISOString();
    const timeMax = endOfNextWeek.toISOString();

    // 3. Fetch events from Google Calendar
    const rawEvents = await listEvents(refreshToken, calendarId, timeMin, timeMax);

    // 4. Map and tag Prospix-originated events
    const events = rawEvents.map((ev) => ({
      id: ev.id,
      summary: ev.summary,
      start: ev.start,
      end: ev.end,
      isProspixEvent: ev.description?.includes('Prospix') ?? false,
    }));

    return NextResponse.json({
      success: true,
      events,
      calendarId,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error syncing calendar:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to sync calendar' },
      { status: 500 }
    );
  }
}
