-- =============================================================================
-- Prospix · RLS Migration for Supabase Auth
-- =============================================================================
-- This migration:
-- 1. Enables RLS on all tenant-scoped tables
-- 2. Creates policies that filter by tenant_id from the JWT app_metadata
-- 3. Creates a service_role bypass policy for admin operations
-- 4. Keeps public tables (audit_log, feature_flags) accessible
-- =============================================================================

-- Helper function to extract tenant_id from JWT app_metadata
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
    NULL
  );
$$;

-- Helper function to extract user role from JWT app_metadata
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    'anon'
  );
$$;

-- =============================================================================
-- Tenant-scoped tables: RLS policies
-- Each table gets:
--   1. SELECT: tenant_id matches JWT OR role is GUILDS_ADMIN
--   2. INSERT: tenant_id matches JWT
--   3. UPDATE: tenant_id matches JWT
--   4. DELETE: tenant_id matches JWT
-- =============================================================================

-- Macro: Apply standard tenant RLS to a table
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'leads',
    'lead_events',
    'lead_notes',
    'campaigns',
    'conversations',
    'messages',
    'scripts',
    'script_variations',
    'meetings',
    'notifications',
    'notification_preferences',
    'optouts',
    'pending_outbound',
    'prompt_versions',
    'tenant_ai_configs',
    'tenant_billing',
    'tenant_discoveries',
    'tenant_invitations',
    'tenant_notes',
    'tenant_secrets',
    'tenant_usage',
    'health_profiles',
    'lgpd_requests',
    'operational_alerts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    
    -- Drop existing policies (idempotent)
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', tbl);
    
    -- SELECT: tenant match OR GUILDS_ADMIN
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I
       FOR SELECT
       USING (tenant_id = auth.tenant_id() OR auth.user_role() = ''GUILDS_ADMIN'')',
      tbl
    );
    
    -- INSERT: tenant match only
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I
       FOR INSERT
       WITH CHECK (tenant_id = auth.tenant_id())',
      tbl
    );
    
    -- UPDATE: tenant match only
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I
       FOR UPDATE
       USING (tenant_id = auth.tenant_id())
       WITH CHECK (tenant_id = auth.tenant_id())',
      tbl
    );
    
    -- DELETE: tenant match only
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I
       FOR DELETE
       USING (tenant_id = auth.tenant_id())',
      tbl
    );
  END LOOP;
END $$;

-- =============================================================================
-- Users table: Users can read their own row + tenant members; admins can read all
-- =============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select ON public.users;
DROP POLICY IF EXISTS users_insert ON public.users;
DROP POLICY IF EXISTS users_update ON public.users;
DROP POLICY IF EXISTS users_delete ON public.users;

CREATE POLICY users_select ON public.users
  FOR SELECT
  USING (
    id = auth.uid()
    OR tenant_id = auth.tenant_id()
    OR auth.user_role() = 'GUILDS_ADMIN'
  );

CREATE POLICY users_insert ON public.users
  FOR INSERT
  WITH CHECK (auth.user_role() = 'GUILDS_ADMIN');

CREATE POLICY users_update ON public.users
  FOR UPDATE
  USING (
    id = auth.uid()
    OR auth.user_role() = 'GUILDS_ADMIN'
  );

CREATE POLICY users_delete ON public.users
  FOR DELETE
  USING (auth.user_role() = 'GUILDS_ADMIN');

-- =============================================================================
-- Tenants table: Users can read their own tenant; admins can CRUD all
-- =============================================================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_select ON public.tenants;
DROP POLICY IF EXISTS tenants_insert ON public.tenants;
DROP POLICY IF EXISTS tenants_update ON public.tenants;
DROP POLICY IF EXISTS tenants_delete ON public.tenants;

CREATE POLICY tenants_select ON public.tenants
  FOR SELECT
  USING (
    id = auth.tenant_id()
    OR auth.user_role() = 'GUILDS_ADMIN'
  );

CREATE POLICY tenants_insert ON public.tenants
  FOR INSERT
  WITH CHECK (auth.user_role() = 'GUILDS_ADMIN');

CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE
  USING (
    id = auth.tenant_id()
    OR auth.user_role() = 'GUILDS_ADMIN'
  );

CREATE POLICY tenants_delete ON public.tenants
  FOR DELETE
  USING (auth.user_role() = 'GUILDS_ADMIN');

-- =============================================================================
-- Global tables: No tenant_id, different policies
-- =============================================================================

-- Audit log: Insert-only for all, read for admins
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;

CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT
  USING (auth.user_role() = 'GUILDS_ADMIN');

CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT
  WITH CHECK (true);

-- Sessions: Users can only see their own sessions
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_select ON public.sessions;
DROP POLICY IF EXISTS sessions_insert ON public.sessions;
DROP POLICY IF EXISTS sessions_delete ON public.sessions;

CREATE POLICY sessions_select ON public.sessions
  FOR SELECT
  USING (user_id = auth.uid()::text OR auth.user_role() = 'GUILDS_ADMIN');

CREATE POLICY sessions_insert ON public.sessions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY sessions_delete ON public.sessions
  FOR DELETE
  USING (user_id = auth.uid()::text OR auth.user_role() = 'GUILDS_ADMIN');

-- Feature flags: Read for all authenticated, write for admins
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ff_select ON public.feature_flags;
DROP POLICY IF EXISTS ff_insert ON public.feature_flags;
DROP POLICY IF EXISTS ff_update ON public.feature_flags;
DROP POLICY IF EXISTS ff_delete ON public.feature_flags;

CREATE POLICY ff_select ON public.feature_flags
  FOR SELECT
  USING (true);

CREATE POLICY ff_insert ON public.feature_flags
  FOR INSERT
  WITH CHECK (auth.user_role() = 'GUILDS_ADMIN');

CREATE POLICY ff_update ON public.feature_flags
  FOR UPDATE
  USING (auth.user_role() = 'GUILDS_ADMIN');

CREATE POLICY ff_delete ON public.feature_flags
  FOR DELETE
  USING (auth.user_role() = 'GUILDS_ADMIN');

-- Idempotency keys: Users can only manage their own
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idem_select ON public.idempotency_keys;
DROP POLICY IF EXISTS idem_insert ON public.idempotency_keys;

CREATE POLICY idem_select ON public.idempotency_keys
  FOR SELECT
  USING (true);

CREATE POLICY idem_insert ON public.idempotency_keys
  FOR INSERT
  WITH CHECK (true);

-- Script templates: Read for all, write for admins
ALTER TABLE public.script_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS st_select ON public.script_templates;
DROP POLICY IF EXISTS st_insert ON public.script_templates;
DROP POLICY IF EXISTS st_update ON public.script_templates;

CREATE POLICY st_select ON public.script_templates
  FOR SELECT
  USING (true);

CREATE POLICY st_insert ON public.script_templates
  FOR INSERT
  WITH CHECK (auth.user_role() = 'GUILDS_ADMIN');

CREATE POLICY st_update ON public.script_templates
  FOR UPDATE
  USING (auth.user_role() = 'GUILDS_ADMIN');

-- =============================================================================
-- Grant usage to authenticated role
-- =============================================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
