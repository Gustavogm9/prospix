-- ═══════════════════════════════════════════════════════════════════════════
-- Campaign Sources & State Migration
-- Adds capture_sources (multi-select) and state (UF) columns to campaigns
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS capture_sources text[] DEFAULT ARRAY['GOOGLE_MAPS'];
COMMENT ON COLUMN campaigns.capture_sources IS 'Array of discovery source types enabled for this campaign';

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS state text DEFAULT 'SP';
COMMENT ON COLUMN campaigns.state IS 'Brazilian state (UF) for regional source lookups (e.g. CRM_SP, OAB_SP)';
