/**
 * Script to apply RLS migration via Supabase Management API
 * Uses public schema for helper functions since Management API 
 * doesn't have permission on auth schema.
 * 
 * Run with: pnpm exec tsx supabase/apply-rls.ts (from apps/api)
 */

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const PROJECT_ID = process.env.SUPABASE_PROJECT_ID || 'yvbyplzfqfrlfujathii';
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`;

async function executeSQL(sql: string, label: string): Promise<boolean> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ ${label}: ${res.status} ${body}`);
    return false;
  }
  console.log(`✅ ${label}`);
  return true;
}

async function main() {
  console.log('🔒 Applying RLS migration...\n');

  // 1. Create helper functions in PUBLIC schema (Management API can't write to auth)
  await executeSQL(`
    CREATE OR REPLACE FUNCTION public.current_tenant_id()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $fn$
      SELECT COALESCE(
        (current_setting('request.jwt.claims', true)::json -> 'app_metadata' ->> 'tenant_id')::uuid,
        (current_setting('app.tenant_id', true))::uuid
      );
    $fn$;
  `, 'public.current_tenant_id()');

  await executeSQL(`
    CREATE OR REPLACE FUNCTION public.current_user_role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $fn$
      SELECT COALESCE(
        current_setting('request.jwt.claims', true)::json -> 'app_metadata' ->> 'role',
        current_setting('app.user_role', true),
        'anon'
      );
    $fn$;
  `, 'public.current_user_role()');

  // 2. Apply RLS on tenant-scoped tables
  const tenantTables = [
    'leads', 'lead_events', 'lead_notes', 'campaigns', 'conversations',
    'messages', 'scripts', 'script_variations', 'meetings', 'notifications',
    'optouts', 'pending_outbound', 'prompt_versions',
    'tenant_ai_configs', 'tenant_billing', 'tenant_discoveries',
    'tenant_invitations', 'tenant_notes', 'tenant_secrets', 'tenant_usage',
    'health_profiles', 'lgpd_requests', 'operational_alerts',
  ];

  for (const tbl of tenantTables) {
    const sql = `
      ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_select ON public.${tbl};
      DROP POLICY IF EXISTS tenant_insert ON public.${tbl};
      DROP POLICY IF EXISTS tenant_update ON public.${tbl};
      DROP POLICY IF EXISTS tenant_delete ON public.${tbl};
      CREATE POLICY tenant_select ON public.${tbl} FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'GUILDS_ADMIN');
      CREATE POLICY tenant_insert ON public.${tbl} FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
      CREATE POLICY tenant_update ON public.${tbl} FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
      CREATE POLICY tenant_delete ON public.${tbl} FOR DELETE USING (tenant_id = public.current_tenant_id());
    `;
    await executeSQL(sql, `RLS: ${tbl}`);
  }

  // 3. Users table
  await executeSQL(`
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS users_select ON public.users;
    DROP POLICY IF EXISTS users_insert ON public.users;
    DROP POLICY IF EXISTS users_update ON public.users;
    DROP POLICY IF EXISTS users_delete ON public.users;
    CREATE POLICY users_select ON public.users FOR SELECT USING (id = (current_setting('request.jwt.claim.sub', true))::text OR tenant_id = public.current_tenant_id() OR public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY users_insert ON public.users FOR INSERT WITH CHECK (public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY users_update ON public.users FOR UPDATE USING (id = (current_setting('request.jwt.claim.sub', true))::text OR public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY users_delete ON public.users FOR DELETE USING (public.current_user_role() = 'GUILDS_ADMIN');
  `, 'RLS: users');

  // 4. Tenants table
  await executeSQL(`
    ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenants_select ON public.tenants;
    DROP POLICY IF EXISTS tenants_insert ON public.tenants;
    DROP POLICY IF EXISTS tenants_update ON public.tenants;
    DROP POLICY IF EXISTS tenants_delete ON public.tenants;
    CREATE POLICY tenants_select ON public.tenants FOR SELECT USING (id = public.current_tenant_id() OR public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY tenants_insert ON public.tenants FOR INSERT WITH CHECK (public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY tenants_update ON public.tenants FOR UPDATE USING (id = public.current_tenant_id() OR public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY tenants_delete ON public.tenants FOR DELETE USING (public.current_user_role() = 'GUILDS_ADMIN');
  `, 'RLS: tenants');

  // 5. Global tables
  await executeSQL(`
    ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
    DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
    CREATE POLICY audit_log_select ON public.audit_log FOR SELECT USING (public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT WITH CHECK (true);
  `, 'RLS: audit_log');

  await executeSQL(`
    ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS sessions_select ON public.sessions;
    DROP POLICY IF EXISTS sessions_insert ON public.sessions;
    DROP POLICY IF EXISTS sessions_delete ON public.sessions;
    CREATE POLICY sessions_select ON public.sessions FOR SELECT USING (true);
    CREATE POLICY sessions_insert ON public.sessions FOR INSERT WITH CHECK (true);
    CREATE POLICY sessions_delete ON public.sessions FOR DELETE USING (true);
  `, 'RLS: sessions');

  await executeSQL(`
    ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS ff_select ON public.feature_flags;
    DROP POLICY IF EXISTS ff_insert ON public.feature_flags;
    DROP POLICY IF EXISTS ff_update ON public.feature_flags;
    DROP POLICY IF EXISTS ff_delete ON public.feature_flags;
    CREATE POLICY ff_select ON public.feature_flags FOR SELECT USING (true);
    CREATE POLICY ff_insert ON public.feature_flags FOR INSERT WITH CHECK (public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY ff_update ON public.feature_flags FOR UPDATE USING (public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY ff_delete ON public.feature_flags FOR DELETE USING (public.current_user_role() = 'GUILDS_ADMIN');
  `, 'RLS: feature_flags');

  await executeSQL(`
    ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS idem_select ON public.idempotency_keys;
    DROP POLICY IF EXISTS idem_insert ON public.idempotency_keys;
    CREATE POLICY idem_select ON public.idempotency_keys FOR SELECT USING (true);
    CREATE POLICY idem_insert ON public.idempotency_keys FOR INSERT WITH CHECK (true);
  `, 'RLS: idempotency_keys');

  await executeSQL(`
    ALTER TABLE public.script_templates ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS st_select ON public.script_templates;
    DROP POLICY IF EXISTS st_insert ON public.script_templates;
    DROP POLICY IF EXISTS st_update ON public.script_templates;
    CREATE POLICY st_select ON public.script_templates FOR SELECT USING (true);
    CREATE POLICY st_insert ON public.script_templates FOR INSERT WITH CHECK (public.current_user_role() = 'GUILDS_ADMIN');
    CREATE POLICY st_update ON public.script_templates FOR UPDATE USING (public.current_user_role() = 'GUILDS_ADMIN');
  `, 'RLS: script_templates');

  // 6. Grant permissions
  await executeSQL(`
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  `, 'GRANT permissions');

  console.log('\n🎉 RLS migration complete!');
}

main().catch(console.error);
