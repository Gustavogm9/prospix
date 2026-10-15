import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

const PAGE_SIZE = 1_000;
const IN_FILTER_CHUNK_SIZE = 100;

type ScriptImpact = { id: string; tenant_id: string };
type TenantImpact = { id: string; name: string; slug: string; status: string };

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

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
      return NextResponse.json(
        { error: 'RESOURCE_NOT_FOUND', message: 'Template não encontrado.' },
        { status: 404 },
      );
    }

    // Count scripts cloned from this template
    const { count: scriptsCloned } = await supabaseAdmin
      .from('scripts')
      .select('*', { count: 'exact', head: true })
      .eq('cloned_from_template_id', id)
      .is('archived_at', null);

    // Resolve impact with parameterized PostgREST filters. Never pass URL data to raw SQL.
    const impactedScripts: ScriptImpact[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from('scripts')
        .select('id, tenant_id')
        .eq('cloned_from_template_id', id)
        .is('archived_at', null)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;
      const page = (data ?? []) as ScriptImpact[];
      impactedScripts.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    const scriptIds = impactedScripts.map((script) => script.id);
    const tenantIds = [...new Set(impactedScripts.map((script) => script.tenant_id))];
    const tenantsUsing: TenantImpact[] = [];

    for (const tenantIdChunk of chunks(tenantIds, IN_FILTER_CHUNK_SIZE)) {
      const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, status')
        .in('id', tenantIdChunk);
      if (error) throw error;
      tenantsUsing.push(...((data ?? []) as TenantImpact[]));
    }

    let activeCampaignsCount = 0;
    for (const scriptIdChunk of chunks(scriptIds, IN_FILTER_CHUNK_SIZE)) {
      const { count, error } = await supabaseAdmin
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'ACTIVE')
        .in('active_script_id', scriptIdChunk);
      if (error) throw error;
      activeCampaignsCount += count ?? 0;
    }

    return NextResponse.json({
      data: {
        templateId: template.id,
        templateName: template.name,
        scriptsCloned: scriptsCloned ?? 0,
        tenantsCount: tenantsUsing.length,
        tenants: tenantsUsing,
        activeCampaigns: activeCampaignsCount,
      },
    });
  } catch (err) {
    console.error('admin/templates/[id]/impact → GET failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao calcular impacto.' }, { status: 500 });
  }
}
