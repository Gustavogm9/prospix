import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';

// PATCH /api/notifications/[id]/read — Mark a single notification as read
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('Error marking notification as read:', error);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to mark notification as read' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
