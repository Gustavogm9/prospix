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

const VALID_KINDS = ['audio', 'video', 'transcript', 'approval_proof'] as const;
type MaterialKind = (typeof VALID_KINDS)[number];

const KIND_TO_COLUMN: Record<MaterialKind, string> = {
  audio: 'audio_r2_key',
  video: 'video_r2_key',
  transcript: 'transcript_r2_key',
  approval_proof: 'approval_proof_r2_key',
};

function isValidKind(kind: string): kind is MaterialKind {
  return VALID_KINDS.includes(kind as MaterialKind);
}

// =========================================================================
// POST /api/admin/tenants/[id]/discovery/materials — presign or confirm
// Body for presign: { action: 'presign', kind, contentType, filename? }
// Body for confirm: { action: 'confirm', kind, key }
// =========================================================================
export async function POST(
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

  const action = body?.action ?? 'presign';

  if (action === 'confirm') {
    return handleConfirm(tenantId, body);
  }

  // Default: presign
  return handlePresign(tenantId, body);
}

async function handlePresign(tenantId: string, body: any) {
  const { kind, contentType, filename } = body;
  if (!kind || !isValidKind(kind) || !contentType) {
    return NextResponse.json({ message: 'kind e contentType são obrigatórios.' }, { status: 400 });
  }

  try {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('id', tenantId).single();
    if (!tenant) {
      return NextResponse.json({ message: 'Tenant não encontrado.' }, { status: 404 });
    }

    const safeName = (filename ?? `${kind}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const key = `tenant_${tenantId}/discovery/${kind}/${Date.now()}-${safeName}`;

    // Return upload endpoint URL (local filesystem mode)
    const apiUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const uploadUrl = `${apiUrl}/api/admin/tenants/${tenantId}/discovery/materials/upload`;
    const expiresAt = new Date(Date.now() + 900_000); // 15min
    return NextResponse.json({ data: { key, uploadUrl, expiresAt: expiresAt.toISOString(), local: true } });
  } catch (err) {
    console.error('admin/discovery/materials → presign failed', err);
    return NextResponse.json({ message: 'Falha ao gerar URL de upload.' }, { status: 500 });
  }
}

async function handleConfirm(tenantId: string, body: any) {
  const { kind, key } = body;
  if (!kind || !isValidKind(kind) || !key) {
    return NextResponse.json({ message: 'kind e key são obrigatórios.' }, { status: 400 });
  }

  const column = KIND_TO_COLUMN[kind as MaterialKind];

  try {
    const { data: existing } = await supabaseAdmin
      .from('tenant_discoveries')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    let result: any;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('tenant_discoveries')
        .update({ [column]: key } as any)
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
          [column]: key,
          updated_at: new Date().toISOString(),
        } as any)
        .select()
        .single();
      if (error) throw error;
      result = data;
    }
    return NextResponse.json({ data: serializeDiscovery(result) });
  } catch (err) {
    console.error('admin/discovery/materials → confirm failed', err);
    return NextResponse.json({ message: 'Falha ao salvar material.' }, { status: 500 });
  }
}

// =========================================================================
// DELETE /api/admin/tenants/[id]/discovery/materials — Delete a material
// Body: { kind }
// =========================================================================
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id: tenantId } = await params;

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  if (!kind || !isValidKind(kind)) {
    return NextResponse.json({ message: 'Parâmetro kind inválido.' }, { status: 400 });
  }

  const column = KIND_TO_COLUMN[kind as MaterialKind];

  try {
    const { data: updated, error } = await supabaseAdmin
      .from('tenant_discoveries')
      .update({ [column]: null } as any)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ data: serializeDiscovery(updated) });
  } catch (err) {
    console.error('admin/discovery/materials → delete failed', err);
    return NextResponse.json({ message: 'Falha ao remover material.' }, { status: 500 });
  }
}
