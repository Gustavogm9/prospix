import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';
import { normalizeOwnerEmail } from '@/lib/onboarding-validation';

// Correct the pending owner's address before invitation redemption.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id: tenantId } = await params;
  let body: { email?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: 'Dados inválidos.' }, { status: 400 });
  }
  const email = normalizeOwnerEmail(body.email);
  if (!email) return NextResponse.json({ message: 'Informe um e-mail válido.' }, { status: 400 });

  try {
    const { data: tenant, error: tenantError } = await supabaseAdmin.from('tenants')
      .select('id, status').eq('id', tenantId).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return NextResponse.json({ message: 'Tenant não encontrado.' }, { status: 404 });
    if (tenant.status !== 'ONBOARDING') return NextResponse.json({ message: 'A correção por convite só está disponível durante o onboarding.' }, { status: 409 });

    const { data: owner, error: ownerError } = await supabaseAdmin.from('users')
      .select('id, email').eq('tenant_id', tenantId).eq('role', 'OWNER').is('deleted_at', null).maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) return NextResponse.json({ message: 'Responsável não encontrado.' }, { status: 404 });
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(owner.id);
    if (authUser.user) return NextResponse.json({ message: 'Esta conta já foi ativada. Solicite a alteração de e-mail com confirmação da identidade do responsável.' }, { status: 409 });
    const { data: otherUser, error: collisionError } = await supabaseAdmin.from('users')
      .select('id').ilike('email', email).neq('id', owner.id).maybeSingle();
    if (collisionError) throw collisionError;
    if (otherUser) return NextResponse.json({ message: 'Este e-mail já pertence a outra conta.' }, { status: 409 });

    const { data: updated, error: updateError } = await supabaseAdmin.from('users')
      .update({ email, updated_at: new Date().toISOString() })
      .eq('id', owner.id).eq('tenant_id', tenantId).eq('email', owner.email).select('id, email').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return NextResponse.json({ message: 'O e-mail foi alterado por outra sessão. Atualize a página.' }, { status: 409 });

    await supabaseAdmin.from('audit_log').insert({
      user_id: auth.userId, action: 'tenant.owner_email_corrected', target_type: 'tenant',
      target_id: tenantId, payload: { owner_id: owner.id },
    });
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error('admin/tenants/[id]/owner-email → PATCH failed', err);
    return NextResponse.json({ message: 'Falha ao corrigir e-mail do responsável.' }, { status: 500 });
  }
}
