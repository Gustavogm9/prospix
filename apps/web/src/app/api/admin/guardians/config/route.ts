import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../_lib/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// =========================================================================
// GET /api/admin/guardians/config?tenant_id=...
// Returns the active Guardian Engine V3 config for admin inspection.
// =========================================================================
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') || auth.tenantId;

  if (!tenantId || !UUID_RE.test(tenantId)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'tenant_id invalido ou ausente.' },
      { status: 400 },
    );
  }

  try {
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug')
      .eq('id', tenantId)
      .maybeSingle();

    if (tenantErr) throw tenantErr;
    if (!tenant) {
      return NextResponse.json(
        { error: 'RESOURCE_NOT_FOUND', message: 'Tenant nao encontrado.' },
        { status: 404 },
      );
    }

    const { data: config, error: configErr } = await supabaseAdmin.rpc('get_guardian_active_config', {
      p_tenant_id: tenantId,
    });

    if (configErr) throw configErr;
    if (!config) {
      return NextResponse.json(
        { error: 'CONFIG_NOT_FOUND', message: 'Configuracao ativa dos guardioes nao encontrada para o tenant.' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: {
        tenant,
        config,
      },
    });
  } catch (err) {
    console.error('admin/guardians/config -> GET failed', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Falha ao carregar configuracao dos guardioes.' },
      { status: 500 },
    );
  }
}
