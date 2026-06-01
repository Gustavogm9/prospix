import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';

// GET /api/notifications/preferences — Get notification preferences
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { userId } = auth;

  const { data: preferences, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching notification preferences:', error);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to fetch preferences' },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: preferences });
}

// PUT /api/notifications/preferences — Upsert notification preference
export async function PUT(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { userId } = auth;
  const body = await request.json();

  const { eventType, channels, enabled = true } = body;

  if (!eventType || !Array.isArray(channels) || channels.length === 0) {
    return NextResponse.json(
      { error: 'Validation Error', message: 'eventType and at least one channel are required' },
      { status: 400 }
    );
  }

  // Check if preference exists
  const { data: existing } = await supabaseAdmin
    .from('notification_preferences')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .maybeSingle();

  let preference;
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .update({
        channels,
        enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating preference:', error);
      return NextResponse.json(
        { error: 'InternalServerError', message: 'Failed to update preference' },
        { status: 500 }
      );
    }
    preference = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        event_type: eventType,
        channels,
        enabled,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating preference:', error);
      return NextResponse.json(
        { error: 'InternalServerError', message: 'Failed to create preference' },
        { status: 500 }
      );
    }
    preference = data;
  }

  return NextResponse.json({ data: preference });
}
