import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../../_lib/auth';

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
// POST /api/admin/tenants/[id]/discovery/validate — Mark validation round (max 2)
// =========================================================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id: tenantId } = await params;

  try {
    const { data: current } = await supabaseAdmin
      .from('tenant_discoveries')
      .select('validation_rounds, status')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!current) {
      return NextResponse.json({ message: 'Discovery não inicializada.' }, { status: 404 });
    }
    if (current.validation_rounds >= 2) {
      return NextResponse.json(
        { message: 'Máximo de 2 rodadas de validação atingido. Reavalie escopo antes de nova tentativa.' },
        { status: 409 },
      );
    }

    const { data: updated, error } = await supabaseAdmin
      .from('tenant_discoveries')
      .update({
        validation_rounds: current.validation_rounds + 1,
        validated_at: new Date().toISOString(),
        status: 'VALIDATING',
      })
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ data: serializeDiscovery(updated) });
  } catch (err) {
    console.error('admin/discovery/validate → POST failed', err);
    return NextResponse.json({ message: 'Falha ao registrar validação.' }, { status: 500 });
  }
}
