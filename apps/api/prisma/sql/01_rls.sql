-- =============================================================================
-- Prospix · Row Level Security (RLS) policies
-- =============================================================================
-- Aplicar APÓS `prisma migrate dev --name init`.
--
-- Estratégia:
--   1. RLS ON em toda tabela de domínio com tenant_id.
--   2. Policy padrão: `tenant_id = current_setting('app.tenant_id')`.
--   3. Super-admin Guilds usa connection com role `guilds_admin` (BYPASSRLS).
--   4. Workers e API regulares NUNCA usam guilds_admin · sempre injetam tenant_id.
--
-- Cinturão e suspensório:
--   Mesmo com RLS, código de aplicação SEMPRE inclui `tenant_id` no WHERE.
--   Lint customizado bloqueia raw queries sem `tenant_id`.
-- =============================================================================

-- ── 1. Role super-admin Guilds (bypassa RLS · uso restrito) ─────────────────
-- Criado uma vez · idempotente
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guilds_admin') THEN
    CREATE ROLE guilds_admin BYPASSRLS NOINHERIT;
  END IF;

  -- ⚠️  PRODUCTION OVERRIDE REQUIRED
  -- The password 'prospix_dev' below is for LOCAL DEVELOPMENT ONLY.
  -- In production and staging, override this password BEFORE running
  -- the migration by setting the DATABASE_ROLE_PASSWORD environment
  -- variable and replacing the literal below, e.g.:
  --   ALTER ROLE prospix_app WITH PASSWORD :'db_role_password';
  -- Never deploy with the default 'prospix_dev' password.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prospix_app') THEN
    CREATE ROLE prospix_app LOGIN PASSWORD 'prospix_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE prospix_app WITH LOGIN PASSWORD 'prospix_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT pg_has_role(current_user, 'guilds_admin', 'member') THEN
    EXECUTE format('GRANT guilds_admin TO %I', current_user);
  END IF;

  IF NOT pg_has_role('prospix_app', 'guilds_admin', 'member') THEN
    GRANT guilds_admin TO prospix_app;
  END IF;
END$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO prospix_app', current_database());
END$$;

GRANT USAGE ON SCHEMA public TO prospix_app, guilds_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prospix_app, guilds_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prospix_app, guilds_admin;

-- ── 2. Função helper · retorna tenant_id do contexto ────────────────────────
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ── 3. Habilitar e Forçar RLS em todas as tabelas de domínio ─────────────────
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions               FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets         FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_configs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_configs      FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lgpd_requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations     FORCE ROW LEVEL SECURITY;
ALTER TABLE lgpd_requests          FORCE ROW LEVEL SECURITY;
ALTER TABLE campaigns              ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns              FORCE ROW LEVEL SECURITY;
ALTER TABLE leads                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                  FORCE ROW LEVEL SECURITY;
ALTER TABLE lead_notes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_notes             FORCE ROW LEVEL SECURITY;
ALTER TABLE health_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_profiles        FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations          FORCE ROW LEVEL SECURITY;
ALTER TABLE messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages               FORCE ROW LEVEL SECURITY;
ALTER TABLE pending_outbound       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_outbound       FORCE ROW LEVEL SECURITY;
ALTER TABLE meetings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings               FORCE ROW LEVEL SECURITY;
ALTER TABLE scripts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts                FORCE ROW LEVEL SECURITY;
ALTER TABLE script_variations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_variations      FORCE ROW LEVEL SECURITY;
ALTER TABLE lead_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events            FORCE ROW LEVEL SECURITY;
ALTER TABLE optouts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE optouts                FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage           FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing         FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_notes           FORCE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions        FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys       FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              FORCE ROW LEVEL SECURITY;

-- ── 4. Policies de isolamento por tenant ────────────────────────────────────
-- Padrão: `tenant_id = current_tenant_id()` em SELECT, INSERT, UPDATE, DELETE.

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  FOR ALL USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_sessions ON sessions;
CREATE POLICY tenant_isolation_sessions ON sessions
  FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE tenant_id IS NULL OR tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS tenant_isolation_tenant_secrets ON tenant_secrets;
CREATE POLICY tenant_isolation_tenant_secrets ON tenant_secrets
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_tenant_ai_configs ON tenant_ai_configs;
CREATE POLICY tenant_isolation_tenant_ai_configs ON tenant_ai_configs
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_tenant_invitations ON tenant_invitations;
CREATE POLICY tenant_isolation_tenant_invitations ON tenant_invitations
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_lgpd_requests ON lgpd_requests;
CREATE POLICY tenant_isolation_lgpd_requests ON lgpd_requests
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_campaigns ON campaigns;
CREATE POLICY tenant_isolation_campaigns ON campaigns
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_leads ON leads;
CREATE POLICY tenant_isolation_leads ON leads
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_lead_notes ON lead_notes;
CREATE POLICY tenant_isolation_lead_notes ON lead_notes
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_health_profiles ON health_profiles;
CREATE POLICY tenant_isolation_health_profiles ON health_profiles
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_conversations ON conversations;
CREATE POLICY tenant_isolation_conversations ON conversations
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_messages ON messages;
CREATE POLICY tenant_isolation_messages ON messages
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_pending_outbound ON pending_outbound;
CREATE POLICY tenant_isolation_pending_outbound ON pending_outbound
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_meetings ON meetings;
CREATE POLICY tenant_isolation_meetings ON meetings
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_scripts ON scripts;
CREATE POLICY tenant_isolation_scripts ON scripts
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_script_variations ON script_variations;
CREATE POLICY tenant_isolation_script_variations ON script_variations
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_lead_events ON lead_events;
CREATE POLICY tenant_isolation_lead_events ON lead_events
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_optouts ON optouts;
CREATE POLICY tenant_isolation_optouts ON optouts
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_tenant_usage ON tenant_usage;
CREATE POLICY tenant_isolation_tenant_usage ON tenant_usage
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_tenant_billing ON tenant_billing;
CREATE POLICY tenant_isolation_tenant_billing ON tenant_billing
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_notifications ON notifications;
CREATE POLICY tenant_isolation_notifications ON notifications
  FOR ALL USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_notification_preferences ON notification_preferences;
CREATE POLICY tenant_isolation_notification_preferences ON notification_preferences
  FOR ALL USING (
    user_id IN (SELECT id FROM users WHERE tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS tenant_isolation_tenant_notes ON tenant_notes;
CREATE POLICY tenant_isolation_tenant_notes ON tenant_notes
  FOR ALL USING (tenant_id = current_tenant_id());

-- Prompts: global Guilds (tenant_id IS NULL) acessível para todos;
-- prompts customizados ficam isolados por tenant.
DROP POLICY IF EXISTS tenant_isolation_prompt_versions ON prompt_versions;
CREATE POLICY tenant_isolation_prompt_versions ON prompt_versions
  FOR ALL USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_idempotency_keys ON idempotency_keys;
CREATE POLICY tenant_isolation_idempotency_keys ON idempotency_keys
  FOR ALL USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- Audit log: tenant só lê o próprio · admin Guilds usa BYPASSRLS
DROP POLICY IF EXISTS tenant_isolation_audit_log ON audit_log;
CREATE POLICY tenant_isolation_audit_log ON audit_log
  FOR ALL USING (tenant_id = current_tenant_id());

-- ── 5. Tabelas sem RLS (master library Guilds) ──────────────────────────────
-- script_templates é compartilhado entre todos os tenants (Guilds-owned).
-- Não habilita RLS. Mutação restrita por role na app (guilds_admin only).

-- ── 6. Constraints adicionais ───────────────────────────────────────────────

-- Apenas 1 prompt ativo por (tenant_id, prompt_type)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_prompt_per_type
  ON prompt_versions (tenant_id, prompt_type)
  WHERE is_active = true;

-- Apenas 1 invitation ativo por tenant (não consumido + não revogado + não expirado)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_invitation_per_tenant
  ON tenant_invitations (tenant_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- ── 7. Auditoria do PostgreSQL (opcional · produção) ────────────────────────
-- CREATE EXTENSION IF NOT EXISTS pgaudit;
-- ALTER SYSTEM SET pgaudit.log = 'write,ddl';
-- SELECT pg_reload_conf();

-- ── 8. Teste de fumaça (rodar em CI) ────────────────────────────────────────
-- Sem tenant_id no contexto · query retorna 0 rows (não erro):
--   SET LOCAL app.tenant_id TO '';
--   SELECT count(*) FROM leads;  -- deve ser 0
--
-- Com tenant_id A · só vê leads do A:
--   SET LOCAL app.tenant_id TO '<uuid-a>';
--   SELECT count(*) FROM leads;
