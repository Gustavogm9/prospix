-- ═══════════════════════════════════════════════════════════════════════════
-- Premium Lead Sources System Migration (All 6 Premium Add-ons)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Atualizar constraint de tipos de add-on no tenant_addons
ALTER TABLE tenant_addons DROP CONSTRAINT IF EXISTS valid_addon_type;
ALTER TABLE tenant_addons ADD CONSTRAINT valid_addon_type 
  CHECK (addon_type IN (
    'extra_campaign', 'extra_leads_100', 
    'source_cnpj_premium', 'source_socio_contact', 'source_instagram',
    'source_cyber_risk', 'source_ads_tracker', 'source_email_scraper',
    'source_fleet_tracker', 'source_judicial_tracker', 'source_technographic'
  ));

-- 2. Atualizar constraint de tipos de fonte na tabela lead_sources
ALTER TABLE lead_sources DROP CONSTRAINT IF EXISTS valid_source_type;
ALTER TABLE lead_sources ADD CONSTRAINT valid_source_type CHECK (source_type IN (
  'GOOGLE_MAPS', 'RECEITA_FEDERAL', 'CRM_SP', 'OAB_SP', 'CRO_SP',
  'CNPJ_PREMIUM', 'SOCIO_CONTACT', 'INSTAGRAM_SCRAPER',
  'CYBER_RISK', 'ADS_TRACKER', 'EMAIL_SCRAPER', 'FLEET_TRACKER', 'JUDICIAL_TRACKER', 'TECHNOGRAPHIC',
  'LANDING_PAGE', 'IMPORTED', 'MANUAL', 'REFERRAL'
));
