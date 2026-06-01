import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../../_lib/auth';

// =========================================================================
// GET /api/admin/tenants/[id]/discovery/drafts — Read raw voice profile + scripts
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
      .select('voice_profile_draft, scripts_draft')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    return NextResponse.json({
      data: {
        voiceProfile: discovery?.voice_profile_draft ?? null,
        scripts: discovery?.scripts_draft ?? null,
      },
    });
  } catch (err) {
    console.error('admin/discovery/drafts → GET failed', err);
    return NextResponse.json({ message: 'Falha ao carregar drafts.' }, { status: 500 });
  }
}
