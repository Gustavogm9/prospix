import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, getSupabaseAdmin } from '../../../_lib/supabase-admin';
import { deleteEvent } from '../../../_lib/google-calendar';

/**
 * POST /api/integrations/calendar/cancel-event
 *
 * Deletes the linked Google Calendar event for a meeting
 * and clears the google_event_id reference.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    const body = await request.json();
    const { meetingId } = body;

    if (!meetingId) {
      return NextResponse.json(
        { error: 'BadRequest', message: 'meetingId is required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Load the meeting to get the linked google_event_id
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('id, google_event_id')
      .eq('id', meetingId)
      .eq('tenant_id', tenantId)
      .single();

    if (meetingError || !meeting) {
      console.error('Meeting lookup failed:', meetingError);
      return NextResponse.json(
        { error: 'NotFound', message: 'Meeting not found' },
        { status: 404 }
      );
    }

    // If there is no linked Google event, nothing to cancel
    if (!meeting.google_event_id) {
      return NextResponse.json({
        success: true,
        message: 'No Google event linked',
      });
    }

    // 2. Retrieve tenant secrets
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

    // 3. Delete the event from Google Calendar
    await deleteEvent(refreshToken, calendarId, meeting.google_event_id);

    // 4. Clear the reference on the meeting row
    const { error: updateError } = await supabaseAdmin
      .from('meetings')
      .update({
        google_event_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId);

    if (updateError) {
      console.error('Failed to clear google_event_id on meeting:', updateError);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error cancelling Google Calendar event:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to cancel Google Calendar event' },
      { status: 500 }
    );
  }
}
