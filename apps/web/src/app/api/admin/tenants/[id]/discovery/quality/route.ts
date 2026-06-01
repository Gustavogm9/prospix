import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../../_lib/auth';

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

  const report = {
    voiceProfile: {
      objections: { count: objectionsCount, required: 6, ok: objectionsCount >= 6 },
      complianceNever: { count: complianceCount, required: 3, ok: complianceCount >= 3 },
    },
    scripts: { medicos, advogados, empresarios },
    approvalProof: !!d.approval_proof_r2_key,
    pmAssigned: !!d.pm_user_id,
    statusApproved: d.status === 'APPROVED',
    allOk: false,
    blockingReasons: [] as string[],
  };

  const reasons: string[] = [];
  if (!report.voiceProfile.objections.ok) reasons.push(`voice_profile.objections precisa ≥6 (atual ${objectionsCount}).`);
  if (!report.voiceProfile.complianceNever.ok) reasons.push(`voice_profile.compliance_never precisa ≥3 (atual ${complianceCount}).`);
  if (!medicos.ok) reasons.push(`scripts.medicos precisa ≥3 variações e ≥5 nodes (atual ${medicos.variations}/${medicos.nodes}).`);
  if (!advogados.ok) reasons.push(`scripts.advogados precisa ≥3 variações e ≥5 nodes (atual ${advogados.variations}/${advogados.nodes}).`);
  if (!empresarios.ok) reasons.push(`scripts.empresarios precisa ≥3 variações e ≥5 nodes (atual ${empresarios.variations}/${empresarios.nodes}).`);
  if (!report.approvalProof) reasons.push('approvalProofR2Key ausente — faça upload do print de aprovação.');
  if (!report.pmAssigned) reasons.push('pmUserId ausente — atribua o responsável.');
  if (!report.statusApproved) reasons.push(`Status precisa estar APPROVED para promoção (atual ${d.status}).`);

  report.blockingReasons = reasons;
  report.allOk = reasons.length === 0;
  return report;
}

// =========================================================================
// GET /api/admin/tenants/[id]/discovery/quality — Quality gate preview
// =========================================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id: tenantId } = await params;

  try {
    const { data: discovery } = await supabaseAdmin
      .from('tenant_discoveries')
      .select('status, voice_profile_draft, scripts_draft, approval_proof_r2_key, pm_user_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!discovery) {
      return NextResponse.json({ message: 'Discovery não inicializada.' }, { status: 404 });
    }

    return NextResponse.json({ data: evaluateQualityGates(discovery) });
  } catch (err) {
    console.error('admin/discovery/quality → GET failed', err);
    return NextResponse.json({ message: 'Falha ao calcular gates.' }, { status: 500 });
  }
}
