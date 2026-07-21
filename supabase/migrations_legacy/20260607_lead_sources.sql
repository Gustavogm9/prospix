-- ═══════════════════════════════════════════════════════════════════════════
-- Lead Sources System Migration
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create lead_sources table
CREATE TABLE IF NOT EXISTS lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  config jsonb DEFAULT '{}',
  addon_id uuid REFERENCES tenant_addons(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, source_type),
  CONSTRAINT valid_source_type CHECK (source_type IN (
    'GOOGLE_MAPS', 'RECEITA_FEDERAL', 'CRM_SP', 'OAB_SP', 'CRO_SP',
    'LINKEDIN', 'REFERRAL', 'LANDING_PAGE', 'MANUAL', 'IMPORTED'
  )),
  CONSTRAINT valid_status CHECK (status IN ('ACTIVE', 'PAUSED', 'DISABLED'))
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_tenant ON lead_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lead_sources_tenant_status ON lead_sources(tenant_id, status);

-- 2. Enable RLS on lead_sources
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS tenant_select ON lead_sources;
DROP POLICY IF EXISTS tenant_insert ON lead_sources;
DROP POLICY IF EXISTS tenant_update ON lead_sources;
DROP POLICY IF EXISTS tenant_delete ON lead_sources;

-- Create standard tenant policies
CREATE POLICY tenant_select ON lead_sources
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'GUILDS_ADMIN');

CREATE POLICY tenant_insert ON lead_sources
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update ON lead_sources
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete ON lead_sources
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- 3. Update tenant_addons constraint to allow source_linkedin
ALTER TABLE tenant_addons DROP CONSTRAINT IF EXISTS valid_addon_type;
ALTER TABLE tenant_addons ADD CONSTRAINT valid_addon_type 
  CHECK (addon_type IN ('extra_campaign', 'extra_leads_100', 'source_linkedin'));
