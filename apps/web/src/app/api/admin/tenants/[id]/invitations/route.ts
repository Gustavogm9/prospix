import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITATION_CODE_TTL_DAYS = Number(process.env.INVITATION_CODE_TTL_DAYS || '14');

function generateInvitationCode(): string {
  const generateSegment = (length: number): string => {
    let result = '';
    const bytes = randomBytes(length);
    for (let i = 0; i < length; i++) {
      const byte = bytes[i];
      if (byte !== undefined) {
        const char = ALPHABET[byte % ALPHABET.length];
        if (char !== undefined) {
          result += char;
        }
      }
    }
    return result;
  };
  return `PRSPX-${generateSegment(4)}-${generateSegment(4)}`;
}

// =========================================================================
// POST /api/admin/tenants/[id]/invitations — Create invitation code
// =========================================================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const adminId = auth.userId;
  const { id: tenantId } = await params;

  let body: any = {};
  try {
    body = await request.json();
  } catch { /* empty body is OK */ }
  const { notes } = body;

  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .single();
    if (!tenant) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' }, { status: 404 });
    }

    // Check active invitation
    const { data: activeInvitation } = await supabaseAdmin
      .from('tenant_invitations')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (activeInvitation) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'This tenant already has an active invitation code.' },
        { status: 400 },
      );
    }

    // Generate unique code
    let code = generateInvitationCode();
    let codeCollision = await supabaseAdmin.from('tenant_invitations').select('id').eq('code', code).maybeSingle();
    while (codeCollision.data) {
      code = generateInvitationCode();
      codeCollision = await supabaseAdmin.from('tenant_invitations').select('id').eq('code', code).maybeSingle();
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_CODE_TTL_DAYS);

    const { data: invitation, error: invErr } = await supabaseAdmin
      .from('tenant_invitations')
      .insert({
        id: randomUUID(),
        code,
        tenant_id: tenantId,
        role: 'OWNER',
        created_by_id: adminId,
        expires_at: expiresAt.toISOString(),
        notes,
      })
      .select()
      .single();
    if (invErr) throw invErr;

    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'tenant.invitation_created',
      target_type: 'tenant',
      target_id: tenantId,
      payload: { code: invitation.code },
    });

    return NextResponse.json(invitation, { status: 201 });
  } catch (err) {
    console.error('admin/tenants/[id]/invitations → POST failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao criar convite.' }, { status: 500 });
  }
}

// =========================================================================
// GET /api/admin/tenants/[id]/invitations — List invitations
// =========================================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id: tenantId } = await params;

  try {
    const { data: invitations, error } = await supabaseAdmin
      .from('tenant_invitations')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ data: invitations });
  } catch (err) {
    console.error('admin/tenants/[id]/invitations → GET failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao listar convites.' }, { status: 500 });
  }
}
