import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

// =========================================================================
// POST /api/admin/tenants/[id]/churn — Initiate churn process
// =========================================================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const adminId = auth.userId;
  const { id } = await params;

  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, status')
      .eq('id', id)
      .single();
    if (!tenant) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' }, { status: 404 });
    }

    // 1. Mark as churning
    await supabaseAdmin.from('tenants').update({ status: 'CHURNING' }).eq('id', id);

    // 2. Pause active campaigns
    await supabaseAdmin
      .from('campaigns')
      .update({ status: 'PAUSED' })
      .eq('tenant_id', id)
      .eq('status', 'ACTIVE');

    // 3. Grace period 7 days
    const graceDate = new Date();
    graceDate.setDate(graceDate.getDate() + 7);

    // 4. Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'tenant.churn',
      target_type: 'tenant',
      target_id: id,
      payload: { previous_status: tenant.status, grace_period_until: graceDate } as any,
    });

    return NextResponse.json({ success: true, message: 'Tenant churn initiated. 7 days grace period started.' });
  } catch (err) {
    console.error('admin/tenants/[id]/churn failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao iniciar churn.' }, { status: 500 });
  }
}
