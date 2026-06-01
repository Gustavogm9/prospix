import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

// =========================================================================
// POST /api/admin/tenants/[id]/resume — Resume (re-activate) a suspended tenant
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

    await supabaseAdmin.from('tenants').update({ status: 'ACTIVE' }).eq('id', id);

    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'tenant.resume',
      target_type: 'tenant',
      target_id: id,
      payload: { previous_status: tenant.status },
    });

    return NextResponse.json({ success: true, message: 'Tenant re-activated successfully' });
  } catch (err) {
    console.error('admin/tenants/[id]/resume failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao reativar tenant.' }, { status: 500 });
  }
}
