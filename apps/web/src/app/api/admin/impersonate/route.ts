import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

const IMPERSONATION_UNAVAILABLE = {
  error: 'FEATURE_UNAVAILABLE',
  message:
    'A impersonificação está desativada até que a troca de identidade use sessão assinada, HttpOnly e isolada da sessão administrativa.',
};

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: { sessionId?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'O corpo da requisição precisa ser um JSON válido.' },
      { status: 400 },
    );
  }

  if (body.action === 'end') {
    if (!body.sessionId || !/^[a-f0-9]{32}$/i.test(body.sessionId)) {
      return NextResponse.json(
        { error: 'VALIDATION', message: 'Identificador de sessão inválido.' },
        { status: 400 },
      );
    }
    return handleEnd(auth.userId, body.sessionId, request);
  }

  // Fail closed: the previous implementation exposed an unsigned payload in the URL
  // and the application never validated or consumed it as an authenticated session.
  return NextResponse.json(IMPERSONATION_UNAVAILABLE, { status: 503 });
}

async function handleEnd(adminId: string, sessionId: string, request: NextRequest) {
  try {
    const { data: start, error: startError } = await supabaseAdmin
      .from('audit_log')
      .select('tenant_id, payload')
      .eq('action', 'impersonation.start')
      .contains('payload', { session_id: sessionId })
      .maybeSingle();
    if (startError) throw startError;
    if (!start) {
      return NextResponse.json(
        { error: 'RESOURCE_NOT_FOUND', message: 'Sessão de impersonificação não encontrada.' },
        { status: 404 },
      );
    }

    const { data: existingEnd, error: existingEndError } = await supabaseAdmin
      .from('audit_log')
      .select('id')
      .eq('action', 'impersonation.end')
      .contains('payload', { session_id: sessionId })
      .maybeSingle();
    if (existingEndError) throw existingEndError;
    if (existingEnd) {
      return NextResponse.json({ data: { message: 'Sessão já estava encerrada.' } });
    }

    const { error } = await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'impersonation.end',
      target_type: 'session',
      target_id: sessionId,
      tenant_id: start.tenant_id,
      payload: { session_id: sessionId },
      ip_address: request.headers.get('x-forwarded-for') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    });
    if (error) throw error;

    return NextResponse.json({ data: { message: 'Sessão de impersonificação encerrada.' } });
  } catch (error) {
    console.error('Falha ao encerrar sessão de impersonificação.', error);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Falha ao encerrar impersonificação.' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { data: starts, error: startsError } = await supabaseAdmin
      .from('audit_log')
      .select('*, users!audit_log_user_id_fkey(id, name, email)')
      .eq('action', 'impersonation.start')
      .gte('created_at', twoHoursAgo.toISOString())
      .order('created_at', { ascending: false });
    if (startsError) throw startsError;

    const { data: ends, error: endsError } = await supabaseAdmin
      .from('audit_log')
      .select('payload')
      .eq('action', 'impersonation.end')
      .gte('created_at', twoHoursAgo.toISOString());
    if (endsError) throw endsError;

    const endedSessionIds = new Set(
      (ends ?? []).map((entry: any) => (entry.payload as any)?.session_id).filter(Boolean),
    );
    const now = Date.now();
    const sessions = (starts ?? [])
      .filter((start: any) => {
        const payload = start.payload as any;
        const expiresAt = Date.parse(payload?.expires_at ?? '');
        return (
          payload?.session_id &&
          !endedSessionIds.has(payload.session_id) &&
          Number.isFinite(expiresAt) &&
          expiresAt > now
        );
      })
      .map((start: any) => ({
        sessionId: (start.payload as any).session_id,
        admin: start.users,
        targetUserName: (start.payload as any)?.target_user_name,
        targetTenantName: (start.payload as any)?.target_tenant_name,
        mode: (start.payload as any)?.mode,
        reason: (start.payload as any)?.reason,
        startedAt: start.created_at,
        expiresAt: (start.payload as any)?.expires_at,
      }));

    return NextResponse.json({ data: sessions, impersonationAvailable: false });
  } catch (error) {
    console.error('Falha ao listar sessões de impersonificação.', error);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Falha ao listar sessões ativas.' },
      { status: 500 },
    );
  }
}
