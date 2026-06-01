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
// PUT /api/admin/tenants/[id]/discovery/voice-profile — Save voice profile draft
// =========================================================================
export async function PUT(
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
    return NextResponse.json({ message: 'Voice profile inválido.' }, { status: 400 });
  }

  const profile = body?.profile;
  if (!profile) {
    return NextResponse.json({ message: 'profile é obrigatório.' }, { status: 400 });
  }

  try {
    // Upsert
    const { data: existing } = await supabaseAdmin
      .from('tenant_discoveries')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    let result: any;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('tenant_discoveries')
        .update({ voice_profile_draft: profile as any })
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
          status: 'NOT_STARTED',
          voice_profile_draft: profile as any,
          updated_at: new Date().toISOString(),
        } as any)
        .select()
        .single();
      if (error) throw error;
      result = data;
    }
    return NextResponse.json({ data: serializeDiscovery(result) });
  } catch (err) {
    console.error('admin/discovery/voice-profile → PUT failed', err);
    return NextResponse.json({ message: 'Falha ao salvar voice profile.' }, { status: 500 });
  }
}
