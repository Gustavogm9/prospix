import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, randomUUID } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

// =========================================================================
// POST /api/admin/impersonate — Start impersonation session
// Body: { tenantId, userId, reason, mode? }
// =========================================================================
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const adminId = auth.userId;

  let body: { tenantId?: string; userId?: string; reason?: string; mode?: string; sessionId?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'VALIDATION', message: 'Invalid JSON body.' }, { status: 400 });
  }

  // Route to "end" action if specified
  if (body.action === 'end' && body.sessionId) {
    return handleEnd(adminId, body.sessionId!, request);
  }

  const { tenantId, userId, reason, mode = 'READ_ONLY' } = body;

  if (!tenantId || !userId || !reason || reason.length < 5) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'tenantId, userId e reason (min 5 chars) são obrigatórios.' },
      { status: 400 },
    );
  }
  if (!['READ_ONLY', 'FULL_ACCESS'].includes(mode)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'mode deve ser READ_ONLY ou FULL_ACCESS.' },
      { status: 400 },
    );
  }

  try {
    // 1. Validate target tenant
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, status')
      .eq('id', tenantId)
      .single();
    if (tenantErr || !tenant) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant não encontrado.' }, { status: 404 });
    }

    // 2. Validate target user
    const { data: targetUser, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();
    if (userErr || !targetUser) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado neste tenant.' }, { status: 404 });
    }

    // 3. Check no active impersonation session
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { data: existingSession } = await supabaseAdmin
      .from('audit_log')
      .select('*')
      .eq('user_id', adminId)
      .eq('action', 'impersonation.start')
      .gte('created_at', twoHoursAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSession) {
      const { data: endSession } = await supabaseAdmin
        .from('audit_log')
        .select('*')
        .eq('user_id', adminId)
        .eq('action', 'impersonation.end')
        .gt('created_at', existingSession.created_at)
        .limit(1)
        .maybeSingle();

      if (!endSession) {
        return NextResponse.json(
          { error: 'CONFLICT', message: 'Já existe uma sessão de impersonificação ativa. Encerre-a primeiro.' },
          { status: 409 },
        );
      }
    }

    // 4. Generate impersonation token
    const sessionId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const impersonationToken = Buffer.from(
      JSON.stringify({
        sub: targetUser.id,
        tenant_id: tenantId,
        role: targetUser.role,
        imp: true,
        imp_admin_id: adminId,
        imp_session_id: sessionId,
        imp_mode: mode,
        exp: Math.floor(expiresAt.getTime() / 1000),
      }),
    ).toString('base64url');

    // 5. Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'impersonation.start',
      target_type: 'user',
      target_id: userId,
      tenant_id: tenantId,
      payload: {
        session_id: sessionId,
        target_user_name: targetUser.name,
        target_user_email: targetUser.email,
        target_tenant_name: tenant.name,
        reason,
        mode,
        expires_at: expiresAt.toISOString(),
      },
      ip_address: request.headers.get('x-forwarded-for') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    });

    // 6. Notify tenant owner(s)
    const { data: owners } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('role', 'OWNER')
      .is('deleted_at', null);

    for (const owner of owners ?? []) {
      await supabaseAdmin.from('notifications').insert({
        id: randomUUID(),
        user_id: owner.id,
        tenant_id: tenantId,
        type: 'SYSTEM',
        title: 'Acesso administrativo ao seu sistema',
        body: `Um administrador do Prospix acessou seu sistema em modo ${mode === 'READ_ONLY' ? 'somente leitura' : 'acesso completo'}. Motivo: ${reason}`,
        link: null,
      });
    }

    return NextResponse.json({
      data: {
        impersonationToken,
        sessionId,
        expiresAt: expiresAt.toISOString(),
        mode,
        targetUser: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role },
        targetTenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      },
    });
  } catch (err) {
    console.error('admin/impersonate → start failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao iniciar impersonificação.' }, { status: 500 });
  }
}

async function handleEnd(adminId: string, sessionId: string, request: NextRequest) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'impersonation.end',
      target_type: 'session',
      target_id: sessionId,
      payload: { session_id: sessionId },
      ip_address: request.headers.get('x-forwarded-for') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    });
    return NextResponse.json({ data: { message: 'Sessão de impersonificação encerrada.' } });
  } catch (err) {
    console.error('admin/impersonate → end failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao encerrar impersonificação.' }, { status: 500 });
  }
}

// =========================================================================
// GET /api/admin/impersonate — List active impersonation sessions
// =========================================================================
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const { data: starts, error: startsErr } = await supabaseAdmin
      .from('audit_log')
      .select('*, users!audit_log_user_id_fkey(id, name, email)')
      .eq('action', 'impersonation.start')
      .gte('created_at', twoHoursAgo.toISOString())
      .order('created_at', { ascending: false });
    if (startsErr) throw startsErr;

    const { data: ends, error: endsErr } = await supabaseAdmin
      .from('audit_log')
      .select('payload')
      .eq('action', 'impersonation.end')
      .gte('created_at', twoHoursAgo.toISOString());
    if (endsErr) throw endsErr;

    const endedSessionIds = new Set(
      (ends ?? []).map((e: any) => (e.payload as any)?.session_id).filter(Boolean),
    );

    const sessions = (starts ?? [])
      .filter((s: any) => !endedSessionIds.has((s.payload as any)?.session_id))
      .map((s: any) => ({
        sessionId: (s.payload as any)?.session_id,
        admin: s.users,
        targetUserName: (s.payload as any)?.target_user_name,
        targetTenantName: (s.payload as any)?.target_tenant_name,
        mode: (s.payload as any)?.mode,
        reason: (s.payload as any)?.reason,
        startedAt: s.created_at,
        expiresAt: (s.payload as any)?.expires_at,
      }));

    return NextResponse.json({ data: sessions });
  } catch (err) {
    console.error('admin/impersonate/active → GET failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao listar sessões ativas.' }, { status: 500 });
  }
}
