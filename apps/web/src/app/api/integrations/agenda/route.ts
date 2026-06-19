import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';

// GET /api/integrations/agenda — Retrieve agenda settings
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    const { data: settings, error } = await supabaseAdmin
      .from('meeting_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching meeting settings:', error);
      return NextResponse.json({ error: 'InternalServerError', message: 'Failed to fetch settings' }, { status: 500 });
    }

    // Default configuration if none saved yet
    const config = settings || {
      tenant_id: tenantId,
      available_days: [1, 2, 3, 4, 5],
      start_hour: '09:00',
      end_hour: '18:00',
      lunch_start: '12:00',
      lunch_end: '13:30',
      default_duration: 30,
      buffer_minutes: 15,
    };

    // Map to camelCase for the frontend
    return NextResponse.json({
      data: {
        availableDays: config.available_days,
        startHour: config.start_hour,
        endHour: config.end_hour,
        lunchStart: config.lunch_start,
        lunchEnd: config.lunch_end,
        defaultDuration: config.default_duration,
        bufferMinutes: config.buffer_minutes,
      }
    });
  } catch (err) {
    console.error('Error in GET /api/integrations/agenda:', err);
    return NextResponse.json({ error: 'InternalServerError', message: 'Failed to process request' }, { status: 500 });
  }
}

// PATCH /api/integrations/agenda — Store agenda settings
export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId, role } = auth;

  if (role !== 'OWNER' && role !== 'GUILDS_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Only tenant owners can manage agenda settings' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const settings = body.agendaSettings;

    if (!settings) {
      return NextResponse.json({ error: 'BadRequest', message: 'Missing agendaSettings' }, { status: 400 });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('meeting_settings')
      .upsert({
        tenant_id: tenantId,
        available_days: settings.availableDays,
        start_hour: settings.startHour,
        end_hour: settings.endHour,
        lunch_start: settings.lunchStart,
        lunch_end: settings.lunchEnd,
        default_duration: settings.defaultDuration,
        buffer_minutes: settings.bufferMinutes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' })
      .select()
      .single();

    if (error) {
      console.error('Error updating meeting settings:', error);
      return NextResponse.json({ error: 'InternalServerError', message: 'Failed to save settings' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        availableDays: updated.available_days,
        startHour: updated.start_hour,
        endHour: updated.end_hour,
        lunchStart: updated.lunch_start,
        lunchEnd: updated.lunch_end,
        defaultDuration: updated.default_duration,
        bufferMinutes: updated.buffer_minutes,
      }
    });
  } catch (err) {
    console.error('Error in PATCH /api/integrations/agenda:', err);
    return NextResponse.json({ error: 'InternalServerError', message: 'Failed to process request' }, { status: 500 });
  }
}
