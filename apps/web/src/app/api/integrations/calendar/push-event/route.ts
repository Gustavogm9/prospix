import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, getSupabaseAdmin } from '../../../_lib/supabase-admin';
import { createEvent } from '../../../_lib/google-calendar';

/**
 * POST /api/integrations/calendar/push-event
 *
 * Pushes a meeting to Google Calendar and stores the returned
 * event ID back on the meetings row for future updates/cancellations.
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

    // 1. Load the meeting together with its associated lead
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('*, leads(name, email, whatsapp, metadata)')
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

    // 3. Build the Google Calendar event payload
    const lead = meeting.leads as any; // joined relation
    const companyName =
      lead?.metadata?.cnpj_info?.nomeFantasia || '—';

    const startISO = meeting.scheduled_for as string;
    const durationMs = (meeting.duration_minutes || 30) * 60_000;
    const endISO = new Date(
      new Date(startISO).getTime() + durationMs
    ).toISOString();

    const eventData = {
      summary: `Reunião Prospix — ${lead?.name || 'Lead'}`,
      description: [
        `📋 Lead: ${lead?.name || '—'}`,
        `📱 WhatsApp: ${lead?.whatsapp || '—'}`,
        `🏢 Empresa: ${companyName}`,
        '',
        '🤖 Agendado via Prospix',
      ].join('\n'),
      start: startISO,
      end: endISO,
      location: meeting.location || undefined,
      attendees: lead?.email ? [{ email: lead.email }] : undefined,
    };

    // 4. Push event to Google Calendar
    const eventId = await createEvent(refreshToken, calendarId, eventData);

    // 5. Store the google_event_id on the meeting row
    const { error: updateError } = await supabaseAdmin
      .from('meetings')
      .update({
        google_event_id: eventId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId);

    if (updateError) {
      console.error('Failed to update meeting with google_event_id:', updateError);
      // The event was created successfully, so we still return success
    }

    return NextResponse.json({ success: true, eventId });
  } catch (err) {
    console.error('Error pushing event to Google Calendar:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to push event to Google Calendar' },
      { status: 500 }
    );
  }
}
