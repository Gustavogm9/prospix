import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, randomUUID } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

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
// POST /api/admin/users — Create user for a tenant
// Body: { tenantId, name, email, whatsapp, role, susep? }
// =========================================================================
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const adminId = auth.userId;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'VALIDATION', message: 'Invalid JSON body.' }, { status: 400 });
  }

  const { tenantId, name, email, whatsapp, role, susep } = body;

  if (!tenantId || !name || !email) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'tenantId, name e email são obrigatórios.' },
      { status: 400 },
    );
  }
  if (!['OWNER', 'ASSISTANT'].includes(role)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'role deve ser OWNER ou ASSISTANT.' },
      { status: 400 },
    );
  }

  const tempPassword = generateTempPassword();
  const passwordHash = hashPassword(tempPassword);

  try {
    // Check tenant exists
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .single();
    if (tenantErr || !tenant) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant não encontrado.' }, { status: 404 });
    }

    // Check email uniqueness
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'CONFLICT', message: 'Email já cadastrado no sistema.' }, { status: 409 });
    }

    const { data: user, error: createErr } = await supabaseAdmin
      .from('users')
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        name,
        email,
        whatsapp: whatsapp || null,
        role,
        susep: susep || null,
        password_hash: passwordHash,
        updated_at: new Date().toISOString(),
      })
      .select('id, name, email, role, tenant_id, created_at')
      .single();
    if (createErr) throw createErr;

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'user.create',
      target_type: 'user',
      target_id: user.id,
      tenant_id: tenantId,
      payload: { name, email, role },
      ip_address: request.headers.get('x-forwarded-for') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    });

    return NextResponse.json(
      {
        data: {
          ...user,
          tenantId: user.tenant_id,
          createdAt: user.created_at,
          tempPassword,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('admin/users → POST create failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao criar usuário.' }, { status: 500 });
  }
}
