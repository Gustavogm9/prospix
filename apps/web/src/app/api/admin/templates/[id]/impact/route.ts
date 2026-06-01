import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

// =========================================================================
// GET /api/admin/templates/[id]/impact — Count usage per tenant before delete
// =========================================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const { data: template } = await supabaseAdmin
      .from('script_templates')
      .select('id, name')
      .eq('id', id)
      .single();
    if (!template) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' }, { status: 404 });
    }

    // Count scripts cloned from this template
    const { count: scriptsCloned } = await supabaseAdmin
      .from('scripts')
      .select('*', { count: 'exact', head: true })
      .eq('cloned_from_template_id', id)
      .is('archived_at', null);

    // Get distinct tenants using this template
    let tenantsUsingRaw: any[] = [];
    try {
      const { data } = await supabaseAdmin.rpc('exec_sql' as any, {
        query: `
          SELECT DISTINCT s.tenant_id, t.id, t.name, t.slug, t.status
          FROM scripts s
          JOIN tenants t ON s.tenant_id = t.id
          WHERE s.cloned_from_template_id = '${id}' AND s.archived_at IS NULL
        `,
      });
      tenantsUsingRaw = data ?? [];
    } catch { /* RPC may not exist, fallback to count only */ }

    // Count active campaigns using scripts cloned from this template
    let activeCampaignsCount = 0;
    try {
      const { data } = await supabaseAdmin.rpc('exec_sql' as any, {
        query: `
          SELECT COUNT(DISTINCT c.id)::bigint AS cnt
          FROM campaigns c
          JOIN scripts s ON c.active_script_id = s.id
          WHERE c.status = 'ACTIVE' AND s.cloned_from_template_id = '${id}' AND s.archived_at IS NULL
        `,
      });
      activeCampaignsCount = Number(data?.[0]?.cnt ?? 0);
    } catch { /* fallback */ }

    return NextResponse.json({
      data: {
        templateId: template.id,
        templateName: template.name,
        scriptsCloned: scriptsCloned ?? 0,
        tenantsCount: tenantsUsingRaw.length,
        tenants: tenantsUsingRaw.map((t: any) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
        })),
        activeCampaigns: activeCampaignsCount,
      },
    });
  } catch (err) {
    console.error('admin/templates/[id]/impact → GET failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao calcular impacto.' }, { status: 500 });
  }
}
