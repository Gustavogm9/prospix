import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

// =========================================================================
// POST /api/admin/tenants/[id]/suspend — Suspend tenant + pause campaigns
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

    // 1. Suspend tenant
    await supabaseAdmin.from('tenants').update({ status: 'SUSPENDED' }).eq('id', id);

    // 2. Pause all active campaigns
    await supabaseAdmin
      .from('campaigns')
      .update({ status: 'PAUSED' })
      .eq('tenant_id', id)
      .eq('status', 'ACTIVE');

    // 3. Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'tenant.suspend',
      target_type: 'tenant',
      target_id: id,
      payload: { previous_status: tenant.status },
    });

    return NextResponse.json({ success: true, message: 'Tenant suspended and campaigns paused successfully' });
  } catch (err) {
    console.error('admin/tenants/[id]/suspend failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao suspender tenant.' }, { status: 500 });
  }
}
