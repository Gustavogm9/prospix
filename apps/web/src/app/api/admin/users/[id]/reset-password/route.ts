import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

function generateTempPassword(): string {
  return randomBytes(6).toString('base64url').slice(0, 12);
}

function hashPassword(password: string): string {
  const crypto = require('crypto');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// =========================================================================
// POST /api/admin/users/[id]/reset-password — Reset user password
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
      .select('id, name, email, tenant_id')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();
    if (findErr || !user) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' }, { status: 404 });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = hashPassword(tempPassword);

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({
        password_hash: passwordHash,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', userId);
    if (updateErr) throw updateErr;

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'user.reset_password',
      target_type: 'user',
      target_id: userId,
      tenant_id: user.tenant_id,
      payload: { user_name: user.name, user_email: user.email },
    });

    return NextResponse.json({
      data: {
        userId: user.id,
        tempPassword,
        message: 'Senha resetada com sucesso. Forneça a senha temporária ao usuário.',
      },
    });
  } catch (err) {
    console.error('admin/users/[id]/reset-password → POST failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao resetar senha.' }, { status: 500 });
  }
}
