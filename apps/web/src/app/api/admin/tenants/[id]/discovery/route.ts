import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

function serializeDiscovery(d: any) {
  if (!d) return null;
  return {
    tenantId: d.tenant_id,
    status: d.status,
    scheduledFor: d.scheduled_for ?? null,
    conductedAt: d.conducted_at ?? null,
    validatedAt: d.validated_at ?? null,
    validationRounds: d.validation_rounds,
    approvedAt: d.approved_at ?? null,
    pmUserId: d.pm_user_id ?? null,
    notes: d.notes ?? null,
    hasAudio: !!d.audio_r2_key,
    hasVideo: !!d.video_r2_key,
    hasTranscript: !!d.transcript_r2_key,
    hasVoiceProfileDraft: d.voice_profile_draft !== null,
    hasScriptsDraft: d.scripts_draft !== null,
    hasApprovalProof: !!d.approval_proof_r2_key,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

// =========================================================================
// GET /api/admin/tenants/[id]/discovery — Get discovery state (upsert NOT_STARTED)
// =========================================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id: tenantId } = await params;

  try {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('id', tenantId).single();
    if (!tenant) {
      return NextResponse.json({ message: 'Tenant não encontrado.' }, { status: 404 });
    }

    // Try to find existing
    const { data: existing } = await supabaseAdmin
      .from('tenant_discoveries')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ data: serializeDiscovery(existing) });
    }

    // Create if not exists
    const { data: created, error: createErr } = await supabaseAdmin
      .from('tenant_discoveries')
      .insert({
        tenant_id: tenantId,
        status: 'NOT_STARTED',
        updated_at: new Date().toISOString(),
      } as any)
      .select()
      .single();
    if (createErr) throw createErr;

    return NextResponse.json({ data: serializeDiscovery(created) });
  } catch (err) {
    console.error('admin/discovery → GET failed', err);
    return NextResponse.json({ message: 'Falha ao carregar discovery do tenant.' }, { status: 500 });
  }
}

// =========================================================================
// PATCH /api/admin/tenants/[id]/discovery — Update status/dates/notes/pm
// =========================================================================
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id: tenantId } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Payload inválido.' }, { status: 400 });
  }

  const { status, scheduledFor, conductedAt, notes, pmUserId } = body;

  try {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('id', tenantId).single();
    if (!tenant) {
      return NextResponse.json({ message: 'Tenant não encontrado.' }, { status: 404 });
    }

    if (pmUserId) {
      const { data: pm } = await supabaseAdmin.from('users').select('id').eq('id', pmUserId).single();
      if (!pm) {
        return NextResponse.json({ message: 'pmUserId não corresponde a um usuário existente.' }, { status: 400 });
      }
    }

    // Upsert
    const { data: existing } = await supabaseAdmin
      .from('tenant_discoveries')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    let result: any;
    if (existing) {
      const updateData: Record<string, unknown> = {};
      if (status !== undefined) updateData.status = status;
      if (scheduledFor !== undefined) updateData.scheduled_for = scheduledFor;
      if (conductedAt !== undefined) updateData.conducted_at = conductedAt;
      if (notes !== undefined) updateData.notes = notes;
      if (pmUserId !== undefined) updateData.pm_user_id = pmUserId;

      const { data, error } = await supabaseAdmin
        .from('tenant_discoveries')
        .update(updateData as any)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('tenant_discoveries')
        .insert({
          tenant_id: tenantId,
          status: status ?? 'NOT_STARTED',
          scheduled_for: scheduledFor ?? null,
          conducted_at: conductedAt ?? null,
          notes: notes ?? null,
          pm_user_id: pmUserId ?? null,
          updated_at: new Date().toISOString(),
        } as any)
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ data: serializeDiscovery(result) });
  } catch (err) {
    console.error('admin/discovery → PATCH failed', err);
    return NextResponse.json({ message: 'Falha ao atualizar discovery do tenant.' }, { status: 500 });
  }
}
