import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/supabase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!/^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
      return NextResponse.json({ error: 'INVITATION_INVALID', message: 'Código inválido.' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const { data: invitation, error } = await admin.from('tenant_invitations')
      .select('tenant_id, role, expires_at, used_at, revoked_at')
      .eq('code', code).maybeSingle();
    if (error) throw error;
    if (!invitation) return NextResponse.json({ error: 'INVITATION_INVALID', message: 'Código inválido.' }, { status: 404 });
    if (invitation.used_at) return NextResponse.json({ error: 'INVITATION_USED', message: 'Este convite já foi utilizado.' }, { status: 410 });
    if (invitation.revoked_at) return NextResponse.json({ error: 'INVITATION_REVOKED', message: 'Este convite foi revogado.' }, { status: 410 });
    if (new Date(invitation.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: 'INVITATION_EXPIRED', message: 'Este convite expirou.' }, { status: 410 });
    const { data: tenant, error: tenantError } = await admin.from('tenants').select('name, status').eq('id', invitation.tenant_id).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant || !['ONBOARDING', 'ACTIVE'].includes(tenant.status)) {
      return NextResponse.json({ error: 'INVITATION_INVALID', message: 'Este convite não está disponível.' }, { status: 404 });
    }
    return NextResponse.json({ data: { tenant_name: tenant.name, role: invitation.role } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('invitations/verify failed', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Não foi possível verificar o convite. Tente novamente.' },
      { status: 500 }
    );
  }
}
