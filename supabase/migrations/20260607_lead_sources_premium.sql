-- ═══════════════════════════════════════════════════════════════════════════
-- Premium Lead Sources System Migration
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Atualizar constraint de tipos de add-on no tenant_addons
ALTER TABLE tenant_addons DROP CONSTRAINT IF EXISTS valid_addon_type;
ALTER TABLE tenant_addons ADD CONSTRAINT valid_addon_type 
  CHECK (addon_type IN ('extra_campaign', 'extra_leads_100', 'source_cnpj_premium', 'source_socio_contact', 'source_instagram'));

-- 2. Atualizar constraint de tipos de fonte na tabela lead_sources
ALTER TABLE lead_sources DROP CONSTRAINT IF EXISTS valid_source_type;
ALTER TABLE lead_sources ADD CONSTRAINT valid_source_type CHECK (source_type IN (
  'GOOGLE_MAPS', 'RECEITA_FEDERAL', 'CRM_SP', 'OAB_SP', 'CRO_SP',
  'CNPJ_PREMIUM', 'SOCIO_CONTACT', 'INSTAGRAM_SCRAPER',
  'REFERRAL', 'LANDING_PAGE', 'MANUAL', 'IMPORTED'
));
