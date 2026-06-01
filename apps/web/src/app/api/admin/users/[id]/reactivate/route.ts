import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

// =========================================================================
// POST /api/admin/users/[id]/reactivate — Reactivate a soft-deleted user
// =========================================================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const adminId = auth.userId;
  const { id: userId } = await params;

  try {
    const { data: user, error: findErr } = await supabaseAdmin
      .from('users')
      .select('id, name, tenant_id, deleted_at')
      .eq('id', userId)
      .single();
    if (findErr || !user) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' }, { status: 404 });
    }
    if (!user.deleted_at) {
      return NextResponse.json({ error: 'VALIDATION', message: 'Usuário já está ativo.' }, { status: 400 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ deleted_at: null, updated_at: new Date().toISOString() } as any)
      .eq('id', userId);
    if (updateErr) throw updateErr;

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'user.reactivate',
      target_type: 'user',
      target_id: userId,
      tenant_id: user.tenant_id,
      payload: { user_name: user.name },
    });

    return NextResponse.json({ success: true, message: 'Usuário reativado com sucesso.' });
  } catch (err) {
    console.error('admin/users/[id]/reactivate → POST failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao reativar usuário.' }, { status: 500 });
  }
}
