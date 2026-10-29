import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/supabase-admin';
import { findUniqueOwnerByEmail, normalizeOwnerEmail } from '../../../../../lib/onboarding-validation';

// The invite is the one-time credential. The server binds it to the pending owner
// email before creating an Auth account; browser-provided tenant/role are ignored.
export async function POST(request: NextRequest) {
  let authUserId: string | null = null;
  let inviteId: string | null = null;
  let oldProfileId: string | null = null;
  let profileRekeyed = false;
  let inviteClaimed = false;
  const admin = getSupabaseAdmin();
  try {
    const body = await request.json();
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    const input = body.user && typeof body.user === 'object' ? body.user : {};
    const email = normalizeOwnerEmail(input.email);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const whatsapp = typeof input.whatsapp === 'string' ? input.whatsapp.replace(/\D/g, '') : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!/^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) || !email || !name || name.length > 160 ||
        !/^55\d{10,11}$/.test(whatsapp) || password.length < 8 || password.length > 128 || body.accept_terms !== true) {
      return NextResponse.json({ error: 'VALIDATION', message: 'Revise o código, e-mail, WhatsApp, senha e aceite dos termos.' }, { status: 400 });
    }
    const { data: invitation, error: inviteError } = await admin.from('tenant_invitations')
      .select('id, tenant_id, role, expires_at, used_at, revoked_at').eq('code', code).maybeSingle();
    if (inviteError) throw inviteError;
    if (!invitation || invitation.role !== 'OWNER' || invitation.used_at || invitation.revoked_at ||
        new Date(invitation.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'INVITATION_INVALID', message: 'Convite indisponível. Peça um novo código ao administrador.' }, { status: 410 });
    }
    inviteId = invitation.id;

    const { data: tenant, error: tenantError } = await admin.from('tenants')
      .select('id, status').eq('id', invitation.tenant_id).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant || !['ONBOARDING', 'ACTIVE'].includes(tenant.status)) {
      return NextResponse.json({ error: 'INVITATION_INVALID', message: 'Este tenant não pode receber cadastros.' }, { status: 410 });
    }

    const { data: owners, error: ownerError } = await admin.from('users')
      .select('id, email').eq('tenant_id', invitation.tenant_id).eq('role', 'OWNER').is('deleted_at', null);
    if (ownerError) throw ownerError;
    const owner = findUniqueOwnerByEmail(owners, email);
    if (!owner) {
      return NextResponse.json({ error: 'EMAIL_MISMATCH', message: 'O e-mail informado não corresponde ao responsável cadastrado. Peça a correção ao administrador.' }, { status: 400 });
    }
    oldProfileId = owner.id;
    const { data: existingAuth } = await admin.auth.admin.getUserById(owner.id);
    if (existingAuth.user) return NextResponse.json({ error: 'INVITATION_USED', message: 'Este responsável já possui acesso.' }, { status: 409 });

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name, tenant_id: invitation.tenant_id },
    });
    if (createError || !created.user) {
      return NextResponse.json({ error: 'ACCOUNT_CREATE_FAILED', message: 'Não foi possível criar a conta. Confirme se este e-mail já possui cadastro.' }, { status: 409 });
    }
    authUserId = created.user.id;

    const { data: claimed, error: claimError } = await admin.from('tenant_invitations')
      .update({ used_at: new Date().toISOString(), used_by_user_id: authUserId })
      .eq('id', invitation.id).is('used_at', null).is('revoked_at', null)
      .gt('expires_at', new Date().toISOString()).select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new Error('Convite já resgatado em outra sessão.');
    inviteClaimed = true;

    const { data: updated, error: profileError } = await admin.from('users').update({
      id: authUserId, name, email, whatsapp,
      susep: typeof input.susep === 'string' ? input.susep.trim().slice(0, 80) || null : null,
      city: typeof input.city === 'string' ? input.city.trim().slice(0, 120) || null : null,
      updated_at: new Date().toISOString(),
    }).eq('id', owner.id).eq('tenant_id', invitation.tenant_id).eq('email', owner.email).select('id').maybeSingle();
    if (profileError) throw profileError;
    if (!updated) throw new Error('O cadastro do responsável mudou durante o resgate.');
    profileRekeyed = true;

    const { error: auditError } = await admin.from('audit_log').insert({
      user_id: authUserId, action: 'tenant.invitation_redeemed', target_type: 'tenant',
      target_id: invitation.tenant_id, payload: { invitation_id: invitation.id },
    });
    if (auditError) console.error('invitations/redeem audit failed', { code: auditError.code });
    return NextResponse.json({ data: { user_id: authUserId } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('invitations/redeem failed', err);
    if (authUserId) {
      if (profileRekeyed && oldProfileId) {
        await admin.from('users').update({ id: oldProfileId }).eq('id', authUserId);
      }
      if (inviteClaimed && inviteId) {
        await admin.from('tenant_invitations').update({ used_at: null, used_by_user_id: null }).eq('id', inviteId).eq('used_by_user_id', authUserId);
      }
      await admin.auth.admin.deleteUser(authUserId);
    }
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Não foi possível concluir o cadastro. Tente novamente ou fale com o administrador.' },
      { status: 500 }
    );
  }
}
