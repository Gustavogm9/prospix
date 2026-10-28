import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

const PAGE_SIZE = 50;

// Auth owns real sign-in timestamps. public.sessions is a legacy table and is
// not populated by Supabase Auth; never report its empty rows as zero logins.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0);
  const tenantFilter = request.nextUrl.searchParams.get('tenantId') || '';

  try {
    const authUsers: Array<{ id: string; email?: string; last_sign_in_at?: string | null }> = [];
    for (let page = 1; page <= 25; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      authUsers.push(...data.users);
      if (data.users.length < 200) break;
      if (page === 25) throw new Error('Limite de contas para a página de atividade excedido.');
    }

    const profiles: Array<Record<string, any>> = [];
    for (let index = 0; index < authUsers.length; index += 200) {
      const ids = authUsers.slice(index, index + 200).map((user) => user.id);
      const { data, error } = await supabaseAdmin.from('users')
        .select('id, name, email, role, tenant_id, deleted_at, tenants(id, name, slug, status)')
        .in('id', ids);
      if (error) throw error;
      profiles.push(...(data ?? []));
    }
    const byId = new Map(profiles.filter((profile) => !profile.deleted_at).map((profile) => [profile.id, profile]));
    const signedIn = authUsers.flatMap((authUser) => {
      const profile = byId.get(authUser.id);
      if (!profile || !authUser.last_sign_in_at) return [];
      const tenant = profile.tenants && !Array.isArray(profile.tenants) ? profile.tenants : null;
      return [{
        id: authUser.id, userName: profile.name, userEmail: authUser.email ?? profile.email, userRole: profile.role,
        tenantId: profile.tenant_id, tenantName: tenant?.name ?? null, tenantSlug: tenant?.slug ?? null,
        createdAt: authUser.last_sign_in_at,
      }];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const { data: tenants, error: tenantsError } = await supabaseAdmin.from('tenants')
      .select('id, name, slug, status').is('deleted_at', null).in('status', ['ACTIVE', 'ONBOARDING']).order('name');
    if (tenantsError) throw tenantsError;
    const now = Date.now();
    const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = dayFormatter.format(new Date());
    const recent14d = now - 14 * 86400_000;
    const dormantTenants = (tenants ?? []).filter((tenant) => !signedIn.some((login) => login.tenantId === tenant.id && new Date(login.createdAt).getTime() >= recent14d));
    const filtered = tenantFilter ? signedIn.filter((login) => login.tenantId === tenantFilter) : signedIn;
    const total = filtered.length;

    return NextResponse.json({
      data: filtered.slice(offset, offset + PAGE_SIZE),
      pagination: { total, limit: PAGE_SIZE, offset, hasMore: offset + PAGE_SIZE < total },
      tenants: (tenants ?? []).map((tenant) => ({ id: tenant.id, name: tenant.name })),
      summary: {
        usersWithLogin: signedIn.length,
        loginsToday: signedIn.filter((login) => dayFormatter.format(new Date(login.createdAt)) === today).length,
        loginsWeek: signedIn.filter((login) => new Date(login.createdAt).getTime() >= now - 7 * 86400_000).length,
        dormantTenantsCount: dormantTenants.length,
        dormantTenants: dormantTenants.map((tenant) => ({ id: tenant.id, name: tenant.name, slug: tenant.slug })),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('admin/activity → GET failed', err);
    return NextResponse.json({ message: 'Falha ao carregar os acessos recentes.' }, { status: 500 });
  }
}
