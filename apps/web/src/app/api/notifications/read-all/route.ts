import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';

// PATCH /api/notifications/read-all — Mark all notifications as read
export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { userId, tenantId } = auth;

  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .is('read_at', null);

  if (error) {
    console.error('Error marking notifications as read:', error);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to mark notifications as read' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
