-- ═══════════════════════════════════════════════════════════════════════════
-- Campaign System Enhancement Migration
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add search_tags column to campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS search_tags text[] DEFAULT '{}';
COMMENT ON COLUMN campaigns.search_tags IS 'Google Maps search terms used by the scraper for this campaign';

-- 2. Plan limits configuration table
CREATE TABLE IF NOT EXISTS plan_limits (
  plan text PRIMARY KEY,
  max_active_campaigns int NOT NULL DEFAULT 1,
  max_leads_per_day int NOT NULL DEFAULT 50,
  max_messages_per_day int NOT NULL DEFAULT 50,
  price_cents int NOT NULL DEFAULT 0
);

INSERT INTO plan_limits (plan, max_active_campaigns, max_leads_per_day, max_messages_per_day, price_cents)
VALUES
  ('STARTER',  1, 50,  50,  29000),
  ('STANDARD', 2, 150, 150, 49000),
  ('PREMIUM',  3, 500, 500, 89000)
ON CONFLICT (plan) DO NOTHING;

-- 3. Tenant add-ons table
CREATE TABLE IF NOT EXISTS tenant_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  addon_type text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  price_cents int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT valid_addon_type CHECK (addon_type IN ('extra_campaign', 'extra_leads_100'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_addons_tenant ON tenant_addons(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_addons_active ON tenant_addons(tenant_id, active) WHERE active = true;

-- 4. Enable RLS on new tables
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_addons ENABLE ROW LEVEL SECURITY;

-- plan_limits is readable by all authenticated users (it's config data)
CREATE POLICY "plan_limits_read" ON plan_limits FOR SELECT TO authenticated USING (true);

-- tenant_addons: users can only see their own tenant's add-ons
CREATE POLICY "tenant_addons_read" ON tenant_addons FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "tenant_addons_insert" ON tenant_addons FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 5. Fix any BUSINESS_OWNER values in campaigns table to ENTREPRENEUR
UPDATE campaigns SET profession = 'ENTREPRENEUR' WHERE profession = 'BUSINESS_OWNER';
