import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

type ControlRow = {
  tenant_id: string;
  paused: boolean;
  paused_at: string | null;
  paused_by: string | null;
  pause_reason: string | null;
  resumed_at: string | null;
  resumed_by: string | null;
  resume_reason: string | null;
  updated_at: string | null;
};

function mapControl(row: ControlRow | null, tenantId: string) {
  return {
    tenantId,
    paused: row?.paused === true,
    pausedAt: row?.paused_at ?? null,
    pausedBy: row?.paused_by ?? null,
    pauseReason: row?.pause_reason ?? null,
    resumedAt: row?.resumed_at ?? null,
    resumedBy: row?.resumed_by ?? null,
    resumeReason: row?.resume_reason ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function loadTenant(id: string) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, status')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data;
}

async function loadControl(id: string): Promise<ControlRow | null> {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from('tenant_ai_outbound_controls')
    .select(
      'tenant_id, paused, paused_at, paused_by, pause_reason, resumed_at, resumed_by, resume_reason, updated_at',
    )
    .eq('tenant_id', id)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    const tenant = await loadTenant(id);
    if (!tenant) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' }, { status: 404 });
    }

    const control = await loadControl(id);
    return NextResponse.json({ success: true, data: mapControl(control, id) });
  } catch (err) {
    console.error('admin/tenants/[id]/ai-outbound-pause GET failed', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Falha ao carregar controle de IA.' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const adminId = auth.userId;
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const requestedPaused = body?.paused;
    const reason = String(body?.reason ?? '').trim();

    if (typeof requestedPaused !== 'boolean') {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Informe paused como true ou false.' },
        { status: 400 },
      );
    }

    if (requestedPaused && reason.length < 8) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Informe um motivo com pelo menos 8 caracteres.' },
        { status: 400 },
      );
    }

    const tenant = await loadTenant(id);
    if (!tenant) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' }, { status: 404 });
    }

    const db = supabaseAdmin as any;
    const previous = await loadControl(id);
    const previousPaused = previous?.paused === true;

    if (previous && previousPaused === requestedPaused) {
      return NextResponse.json({
        success: true,
        changed: false,
        data: mapControl(previous, id),
      });
    }

    const { data: updated, error: rpcError } = await db.rpc('set_tenant_ai_outbound_pause', {
      p_tenant_id: id,
      p_paused: requestedPaused,
      p_actor_user_id: adminId,
      p_reason: reason || null,
      p_metadata: {
        tenant_name: tenant.name,
        tenant_status: tenant.status,
        source: 'admin_panel',
      },
    });
    if (rpcError) throw rpcError;

    await supabaseAdmin.from('audit_log').insert({
      tenant_id: id,
      user_id: adminId,
      action: requestedPaused ? 'tenant.ai_outbound_pause' : 'tenant.ai_outbound_resume',
      target_type: 'tenant',
      target_id: id,
      payload: {
        previous_paused: previous ? previousPaused : null,
        new_paused: requestedPaused,
        reason: reason || null,
      },
    });

    return NextResponse.json({
      success: true,
      changed: true,
      data: mapControl(updated as ControlRow, id),
    });
  } catch (err) {
    console.error('admin/tenants/[id]/ai-outbound-pause POST failed', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Falha ao atualizar controle de IA.' },
      { status: 500 },
    );
  }
}
