import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../../../../_lib/auth';

// Profession enum values from @prospix/shared-types
const SEGMENT_TO_PROFESSION: Record<'medicos' | 'advogados' | 'empresarios', string> = {
  medicos: 'DOCTOR',
  advogados: 'LAWYER',
  empresarios: 'ENTREPRENEUR',
};

function evaluateQualityGates(d: {
  status: string;
  voice_profile_draft: unknown;
  scripts_draft: unknown;
  approval_proof_r2_key: string | null;
  pm_user_id: string | null;
}) {
  const voiceProfile = (d.voice_profile_draft ?? {}) as { objections?: unknown[]; compliance_never?: unknown[] };
  const objectionsCount = Array.isArray(voiceProfile.objections) ? voiceProfile.objections.length : 0;
  const complianceCount = Array.isArray(voiceProfile.compliance_never) ? voiceProfile.compliance_never.length : 0;

  const scripts = (d.scripts_draft ?? {}) as Record<string, { initial_message_variations?: unknown[]; nodes?: unknown[] }>;
  const measure = (key: string) => {
    const seg = scripts[key] ?? {};
    const variations = Array.isArray(seg.initial_message_variations) ? seg.initial_message_variations.length : 0;
    const nodes = Array.isArray(seg.nodes) ? seg.nodes.length : 0;
    return { variations, nodes, ok: variations >= 3 && nodes >= 5 };
  };

  const medicos = measure('medicos');
  const advogados = measure('advogados');
  const empresarios = measure('empresarios');

  const reasons: string[] = [];
  if (objectionsCount < 6) reasons.push(`voice_profile.objections precisa ≥6 (atual ${objectionsCount}).`);
  if (complianceCount < 3) reasons.push(`voice_profile.compliance_never precisa ≥3 (atual ${complianceCount}).`);
  if (!medicos.ok) reasons.push(`scripts.medicos precisa ≥3 variações e ≥5 nodes.`);
  if (!advogados.ok) reasons.push(`scripts.advogados precisa ≥3 variações e ≥5 nodes.`);
  if (!empresarios.ok) reasons.push(`scripts.empresarios precisa ≥3 variações e ≥5 nodes.`);
  if (!d.approval_proof_r2_key) reasons.push('approvalProofR2Key ausente.');
  if (!d.pm_user_id) reasons.push('pmUserId ausente.');
  if (d.status !== 'APPROVED') reasons.push(`Status precisa estar APPROVED (atual ${d.status}).`);

  return {
    voiceProfile: {
      objections: { count: objectionsCount, required: 6, ok: objectionsCount >= 6 },
      complianceNever: { count: complianceCount, required: 3, ok: complianceCount >= 3 },
    },
    scripts: { medicos, advogados, empresarios },
    approvalProof: !!d.approval_proof_r2_key,
    pmAssigned: !!d.pm_user_id,
    statusApproved: d.status === 'APPROVED',
    allOk: reasons.length === 0,
    blockingReasons: reasons,
  };
}

// =========================================================================
// POST /api/admin/tenants/[id]/discovery/promote — Create Script records + update Tenant
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
  } catch { /* empty body ok */ }
  const actorUserId = body?.actorUserId;

  try {
    const { data: discovery } = await supabaseAdmin
      .from('tenant_discoveries')
      .select('status, voice_profile_draft, scripts_draft, approval_proof_r2_key, pm_user_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!discovery) {
      return NextResponse.json({ message: 'Discovery não inicializada.' }, { status: 404 });
    }

    const gates = evaluateQualityGates(discovery);
    if (!gates.allOk) {
      return NextResponse.json(
        { message: 'Gates de promoção não atendidos.', blockingReasons: gates.blockingReasons },
        { status: 409 },
      );
    }

    const scriptsDraft = discovery.scripts_draft as Record<string, { initial_message_variations?: string[]; nodes?: unknown[] }>;

    // 1. Update tenant voice profile
    const { error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .update({ ai_voice_profile: discovery.voice_profile_draft as any })
      .eq('id', tenantId);
    if (tenantErr) throw tenantErr;

    // 2. Create scripts for each segment
    const createdScripts: string[] = [];
    for (const segmentKey of ['medicos', 'advogados', 'empresarios'] as const) {
      const seg = scriptsDraft[segmentKey];
      if (!seg) continue;
      const baseMessage = seg.initial_message_variations?.[0] ?? null;

      const { data: created, error: scriptErr } = await supabaseAdmin
        .from('scripts')
        .insert({
          id: randomUUID(),
          tenant_id: tenantId,
          name: `Discovery — ${segmentKey}`,
          category: 'APPROACH',
          target_profession: SEGMENT_TO_PROFESSION[segmentKey] as any,
          status: 'ACTIVE',
          flow: seg as any,
          base_message: baseMessage,
          updated_at: new Date().toISOString(),
        } as any)
        .select('id')
        .single();
      if (scriptErr) throw scriptErr;

      // Create message variations (B, C, D)
      if (seg.initial_message_variations && seg.initial_message_variations.length > 1) {
        const variations = seg.initial_message_variations.slice(1, 4).map((message, index) => ({
          id: randomUUID(),
          tenant_id: tenantId,
          script_id: created.id,
          variant_letter: String.fromCharCode(66 + index), // 'B', 'C', 'D'
          message,
          updated_at: new Date().toISOString(),
        }));
        if (variations.length > 0) {
          const { error: varErr } = await supabaseAdmin.from('script_variations').insert(variations);
          if (varErr) throw varErr;
        }
      }
      createdScripts.push(created.id);
    }

    // 3. Audit log
    await supabaseAdmin.from('audit_log').insert({
      tenant_id: tenantId,
      user_id: actorUserId ?? discovery.pm_user_id ?? adminId,
      action: 'discovery.promote',
      target_type: 'TenantDiscovery',
      target_id: tenantId,
      payload: {
        scriptsCreated: createdScripts,
        voiceProfileApplied: true,
        gatesSnapshot: gates,
      } as any,
    });

    return NextResponse.json({
      data: { tenantId, scriptsCreated: createdScripts, aiVoiceProfileUpdated: true, gates },
    });
  } catch (err) {
    console.error('admin/discovery/promote → POST failed', err);
    return NextResponse.json({ message: 'Falha ao promover discovery.' }, { status: 500 });
  }
}
