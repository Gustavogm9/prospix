import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../_lib/auth';

// =========================================================================
// PATCH /api/admin/users/[id] — Update user
// Body: { name?, email?, whatsapp?, role?, susep? }
// =========================================================================
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const adminId = auth.userId;
  const { id: userId } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'VALIDATION', message: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const { data: user, error: findErr } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, tenant_id')
      .eq('id', userId)
      .single();
    if (findErr || !user) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.whatsapp !== undefined) updateData.whatsapp = body.whatsapp || null;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.susep !== undefined) updateData.susep = body.susep || null;
    updateData.updated_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('users')
      .update(updateData as any)
      .eq('id', userId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'user.update',
      target_type: 'user',
      target_id: userId,
      tenant_id: user.tenant_id,
      payload: body,
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error('admin/users/[id] → PATCH failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao atualizar usuário.' }, { status: 500 });
  }
}

// =========================================================================
// DELETE /api/admin/users/[id] — Deactivate user (soft delete)
// =========================================================================
export async function DELETE(
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
      .select('id, name, role, tenant_id, deleted_at')
      .eq('id', userId)
      .single();
    if (findErr || !user) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' }, { status: 404 });
    }
    if (user.deleted_at) {
      return NextResponse.json({ error: 'VALIDATION', message: 'Usuário já está desativado.' }, { status: 400 });
    }
    if (user.role === 'GUILDS_ADMIN') {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Não é possível desativar super-admins.' }, { status: 403 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', userId);
    if (updateErr) throw updateErr;

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'user.deactivate',
      target_type: 'user',
      target_id: userId,
      tenant_id: user.tenant_id,
      payload: { user_name: user.name },
    });

    return NextResponse.json({ success: true, message: 'Usuário desativado com sucesso.' });
  } catch (err) {
    console.error('admin/users/[id] → DELETE failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao desativar usuário.' }, { status: 500 });
  }
}
