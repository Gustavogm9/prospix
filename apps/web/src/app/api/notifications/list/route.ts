import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';

// GET /api/notifications/list — List notifications for logged user
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { userId, tenantId } = auth;

  const [notifRes, countRes] = await Promise.all([
    supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .is('read_at', null),
  ]);

  if (notifRes.error) {
    console.error('Error fetching notifications:', notifRes.error);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: notifRes.data, unreadCount: countRes.count ?? 0 });
}
