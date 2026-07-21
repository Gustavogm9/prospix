-- Guardian Engine V3 - Phase 1 additive schema.
-- This migration only adds schema. It does not activate the engine, seed configs,
-- modify queued messages, or change the current sending flow.

-- 1. Guardian catalog.
CREATE TABLE IF NOT EXISTS public.guardian_definitions (
  guardian_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (
    layer IN (
      'INBOUND',
      'LEAD',
      'IDENTITY',
      'CONVERSATION_STATE',
      'GENERATION',
      'POST_GENERATION',
      'QUEUE',
      'SEND',
      'INTEGRITY',
      'OBSERVABILITY',
      'ADMIN'
    )
  ),
  execution_stage TEXT NOT NULL,
  function_scope TEXT NOT NULL CHECK (
    function_scope IN (
      'webhook-evolution',
      'send-messages',
      'admin',
      'shared'
    )
  ),
  default_enabled BOOLEAN NOT NULL DEFAULT true,
  default_mode TEXT NOT NULL CHECK (
    default_mode IN ('OFF', 'OBSERVE', 'WARN', 'BLOCK', 'HARD_BLOCK')
  ),
  fail_policy TEXT NOT NULL CHECK (
    fail_policy IN ('FAIL_OPEN', 'FAIL_CLOSED', 'USE_LAST_KNOWN_GOOD_CONFIG')
  ),
  is_system_critical BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.guardian_variable_definitions (
  guardian_key TEXT NOT NULL REFERENCES public.guardian_definitions(guardian_key) ON DELETE CASCADE,
  variable_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (
    value_type IN (
      'boolean',
      'integer',
      'decimal',
      'string',
      'string_array',
      'json',
      'regex',
      'time',
      'duration_seconds',
      'enum'
    )
  ),
  default_value JSONB NOT NULL,
  min_value NUMERIC NULL,
  max_value NUMERIC NULL,
  allowed_values JSONB NULL,
  validation_regex TEXT NULL,
  unit TEXT NULL,
  is_required BOOLEAN NOT NULL DEFAULT true,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  requires_confirmation BOOLEAN NOT NULL DEFAULT false,
  requires_owner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_key, variable_key)
);

-- 2. Versioned tenant configuration.
CREATE TABLE IF NOT EXISTS public.guardian_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'ROLLED_BACK', 'ARCHIVED')),
  config_hash TEXT NOT NULL,
  created_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  activated_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  activated_at TIMESTAMP WITH TIME ZONE NULL,
  notes TEXT NULL,
  UNIQUE (tenant_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS guardian_one_active_version_per_tenant_idx
  ON public.guardian_config_versions (tenant_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS guardian_config_versions_tenant_status_idx
  ON public.guardian_config_versions (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.tenant_guardian_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  config_version_id UUID NOT NULL REFERENCES public.guardian_config_versions(id) ON DELETE CASCADE,
  guardian_key TEXT NOT NULL REFERENCES public.guardian_definitions(guardian_key) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('OFF', 'OBSERVE', 'WARN', 'BLOCK', 'HARD_BLOCK')),
  fail_policy TEXT NOT NULL CHECK (
    fail_policy IN ('FAIL_OPEN', 'FAIL_CLOSED', 'USE_LAST_KNOWN_GOOD_CONFIG')
  ),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, config_version_id, guardian_key)
);

CREATE INDEX IF NOT EXISTS tenant_guardian_settings_tenant_version_idx
  ON public.tenant_guardian_settings (tenant_id, config_version_id);

CREATE TABLE IF NOT EXISTS public.tenant_guardian_variable_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  config_version_id UUID NOT NULL REFERENCES public.guardian_config_versions(id) ON DELETE CASCADE,
  guardian_key TEXT NOT NULL,
  variable_key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, config_version_id, guardian_key, variable_key),
  FOREIGN KEY (guardian_key, variable_key)
    REFERENCES public.guardian_variable_definitions(guardian_key, variable_key)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS tenant_guardian_variable_values_tenant_version_idx
  ON public.tenant_guardian_variable_values (tenant_id, config_version_id);

-- 3. Candidate and validation audit trail.
CREATE TABLE IF NOT EXISTS public.ai_message_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  inbound_message_id TEXT NULL,
  model_name TEXT NULL,
  prompt_version TEXT NULL,
  guardian_config_version_id UUID NULL REFERENCES public.guardian_config_versions(id) ON DELETE SET NULL,
  candidate_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (
    status IN ('GENERATED', 'APPROVED', 'REWRITTEN', 'BLOCKED', 'ESCALATED', 'EXPIRED')
  ),
  final_messages JSONB NULL,
  block_reason_code TEXT NULL,
  validation_summary JSONB NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_message_candidates_tenant_status_created_idx
  ON public.ai_message_candidates (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_message_candidates_conversation_created_idx
  ON public.ai_message_candidates (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.outbound_validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.ai_message_candidates(id) ON DELETE CASCADE,
  guardian_key TEXT NOT NULL REFERENCES public.guardian_definitions(guardian_key) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (
    decision IN ('PASS', 'WARN', 'DELAY', 'REWRITE', 'ESCALATE', 'BLOCK', 'HARD_BLOCK')
  ),
  reason_code TEXT NOT NULL,
  confidence NUMERIC(5,4) NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode_applied TEXT NOT NULL CHECK (
    mode_applied IN ('OFF', 'OBSERVE', 'WARN', 'BLOCK', 'HARD_BLOCK')
  ),
  config_version_id UUID NULL REFERENCES public.guardian_config_versions(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_validation_results_candidate_idx
  ON public.outbound_validation_results (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS outbound_validation_results_tenant_guardian_idx
  ON public.outbound_validation_results (tenant_id, guardian_key, decision, created_at DESC);

CREATE TABLE IF NOT EXISTS public.guardian_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  conversation_id UUID NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  pending_outbound_id UUID NULL REFERENCES public.pending_outbound(id) ON DELETE SET NULL,
  candidate_id UUID NULL REFERENCES public.ai_message_candidates(id) ON DELETE SET NULL,
  guardian_key TEXT NOT NULL,
  execution_stage TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (
    decision IN ('PASS', 'WARN', 'DELAY', 'REWRITE', 'ESCALATE', 'BLOCK', 'HARD_BLOCK')
  ),
  reason_code TEXT NOT NULL,
  mode_applied TEXT NOT NULL CHECK (
    mode_applied IN ('OFF', 'OBSERVE', 'WARN', 'BLOCK', 'HARD_BLOCK')
  ),
  config_version_id UUID NULL REFERENCES public.guardian_config_versions(id) ON DELETE SET NULL,
  input_hash TEXT NULL,
  output_hash TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guardian_decisions_tenant_created_idx
  ON public.guardian_decisions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guardian_decisions_tenant_guardian_idx
  ON public.guardian_decisions (tenant_id, guardian_key, decision, created_at DESC);

CREATE INDEX IF NOT EXISTS guardian_decisions_candidate_idx
  ON public.guardian_decisions (candidate_id, created_at DESC)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS guardian_decisions_pending_outbound_idx
  ON public.guardian_decisions (pending_outbound_id, created_at DESC)
  WHERE pending_outbound_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS guardian_decisions_conversation_idx
  ON public.guardian_decisions (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

-- 4. Admin audit and simulation.
CREATE TABLE IF NOT EXISTS public.guardian_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'CREATE_DRAFT',
      'UPDATE_GUARDIAN',
      'UPDATE_VARIABLE',
      'RUN_SIMULATION',
      'ACTIVATE_VERSION',
      'ROLLBACK_VERSION',
      'BREAK_GLASS_ENABLE',
      'BREAK_GLASS_DISABLE'
    )
  ),
  guardian_key TEXT NULL,
  variable_key TEXT NULL,
  old_value JSONB NULL,
  new_value JSONB NULL,
  config_version_id UUID NULL REFERENCES public.guardian_config_versions(id) ON DELETE SET NULL,
  reason TEXT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guardian_admin_audit_log_tenant_created_idx
  ON public.guardian_admin_audit_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guardian_admin_audit_log_config_version_idx
  ON public.guardian_admin_audit_log (config_version_id, created_at DESC)
  WHERE config_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.guardian_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  input_payload JSONB NOT NULL,
  expected_decision TEXT NOT NULL CHECK (
    expected_decision IN ('PASS', 'WARN', 'DELAY', 'REWRITE', 'ESCALATE', 'BLOCK', 'HARD_BLOCK')
  ),
  expected_reason_code TEXT NULL,
  is_system_case BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guardian_test_cases_tenant_category_idx
  ON public.guardian_test_cases (tenant_id, category, active);

CREATE TABLE IF NOT EXISTS public.guardian_simulation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  config_version_id UUID NULL REFERENCES public.guardian_config_versions(id) ON DELETE SET NULL,
  actor_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  input_payload JSONB NOT NULL,
  result_payload JSONB NOT NULL,
  passed BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guardian_simulation_runs_tenant_created_idx
  ON public.guardian_simulation_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS guardian_simulation_runs_config_version_idx
  ON public.guardian_simulation_runs (config_version_id, created_at DESC)
  WHERE config_version_id IS NOT NULL;

-- 5. Additive columns on existing hot tables. All nullable to avoid backfill and
-- to keep the current production flow unchanged in Phase 1.
ALTER TABLE public.pending_outbound
  ADD COLUMN IF NOT EXISTS candidate_id UUID NULL REFERENCES public.ai_message_candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guardian_config_version_id UUID NULL REFERENCES public.guardian_config_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS validation_status TEXT NULL CHECK (
    validation_status IS NULL OR validation_status IN ('PENDING', 'APPROVED', 'BLOCKED', 'DELAYED', 'EXPIRED')
  ),
  ADD COLUMN IF NOT EXISTS validation_reason_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS final_guardian_checked_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS final_guardian_decision TEXT NULL CHECK (
    final_guardian_decision IS NULL OR final_guardian_decision IN ('PASS', 'WARN', 'DELAY', 'REWRITE', 'ESCALATE', 'BLOCK', 'HARD_BLOCK')
  );

CREATE INDEX IF NOT EXISTS pending_outbound_candidate_idx
  ON public.pending_outbound (candidate_id)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_outbound_guardian_config_version_idx
  ON public.pending_outbound (guardian_config_version_id)
  WHERE guardian_config_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_outbound_validation_status_idx
  ON public.pending_outbound (tenant_id, validation_status, scheduled_for)
  WHERE validation_status IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'pending_outbound_tenant_idempotency_key_idx'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.pending_outbound
    WHERE idempotency_key IS NOT NULL
    GROUP BY tenant_id, idempotency_key
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX pending_outbound_tenant_idempotency_key_idx
      ON public.pending_outbound (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS relevance_score NUMERIC(5,4) NULL,
  ADD COLUMN IF NOT EXISTS relevance_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone_validation_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone_validation_confidence NUMERIC(5,4) NULL,
  ADD COLUMN IF NOT EXISTS entity_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS identity_confidence NUMERIC(5,4) NULL,
  ADD COLUMN IF NOT EXISTS title_verified BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS gender_confidence NUMERIC(5,4) NULL,
  ADD COLUMN IF NOT EXISTS lead_guardian_flags JSONB NULL;

CREATE INDEX IF NOT EXISTS leads_guardian_relevance_idx
  ON public.leads (tenant_id, relevance_status, relevance_score DESC)
  WHERE relevance_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_phone_validation_status_idx
  ON public.leads (tenant_id, phone_validation_status)
  WHERE phone_validation_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_entity_type_idx
  ON public.leads (tenant_id, entity_type)
  WHERE entity_type IS NOT NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS guardian_state JSONB NULL,
  ADD COLUMN IF NOT EXISTS last_guardian_decision_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS last_ai_candidate_id UUID NULL REFERENCES public.ai_message_candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_lock_until TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS conversations_last_ai_candidate_idx
  ON public.conversations (last_ai_candidate_id)
  WHERE last_ai_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_guardian_decision_idx
  ON public.conversations (tenant_id, last_guardian_decision_at DESC)
  WHERE last_guardian_decision_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_lock_until_idx
  ON public.conversations (tenant_id, conversation_lock_until)
  WHERE conversation_lock_until IS NOT NULL;

COMMENT ON TABLE public.guardian_definitions IS
  'System catalog of Guardian Engine validators and operational guards.';
COMMENT ON TABLE public.guardian_config_versions IS
  'Versioned Guardian Engine configuration per tenant. Phase 1 creates schema only.';
COMMENT ON TABLE public.ai_message_candidates IS
  'AI-generated candidate payloads before approval into pending_outbound.';
COMMENT ON TABLE public.guardian_decisions IS
  'Universal audit log for Guardian Engine decisions across stages.';
COMMENT ON TABLE public.guardian_admin_audit_log IS
  'Audit log for Guardian admin changes, activation, rollback, simulation, and break-glass.';

COMMENT ON COLUMN public.pending_outbound.validation_status IS
  'Guardian Engine validation status for rows created after the candidate flow is enabled.';
COMMENT ON COLUMN public.leads.lead_guardian_flags IS
  'Guardian Engine evidence and risk flags for lead relevance, identity, phone, and compliance.';
COMMENT ON COLUMN public.conversations.guardian_state IS
  'Guardian Engine conversation state snapshot for deterministic state-machine checks.';

-- 6. RLS. Policies are additive and do not activate the engine.
ALTER TABLE public.guardian_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_variable_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_guardian_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_guardian_variable_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_message_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_simulation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guardian_definitions_select ON public.guardian_definitions;
CREATE POLICY guardian_definitions_select
  ON public.guardian_definitions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS guardian_variable_definitions_select ON public.guardian_variable_definitions;
CREATE POLICY guardian_variable_definitions_select
  ON public.guardian_variable_definitions
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS guardian_config_versions_select ON public.guardian_config_versions;
CREATE POLICY guardian_config_versions_select
  ON public.guardian_config_versions
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS tenant_guardian_settings_select ON public.tenant_guardian_settings;
CREATE POLICY tenant_guardian_settings_select
  ON public.tenant_guardian_settings
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS tenant_guardian_variable_values_select ON public.tenant_guardian_variable_values;
CREATE POLICY tenant_guardian_variable_values_select
  ON public.tenant_guardian_variable_values
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS ai_message_candidates_select ON public.ai_message_candidates;
CREATE POLICY ai_message_candidates_select
  ON public.ai_message_candidates
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS outbound_validation_results_select ON public.outbound_validation_results;
CREATE POLICY outbound_validation_results_select
  ON public.outbound_validation_results
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS guardian_decisions_select ON public.guardian_decisions;
CREATE POLICY guardian_decisions_select
  ON public.guardian_decisions
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS guardian_admin_audit_log_select ON public.guardian_admin_audit_log;
CREATE POLICY guardian_admin_audit_log_select
  ON public.guardian_admin_audit_log
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS guardian_test_cases_select ON public.guardian_test_cases;
CREATE POLICY guardian_test_cases_select
  ON public.guardian_test_cases
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS guardian_simulation_runs_select ON public.guardian_simulation_runs;
CREATE POLICY guardian_simulation_runs_select
  ON public.guardian_simulation_runs
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

-- Service-role insert/update/delete policies document the intended write path.
DROP POLICY IF EXISTS guardian_definitions_service_role_all ON public.guardian_definitions;
CREATE POLICY guardian_definitions_service_role_all
  ON public.guardian_definitions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS guardian_variable_definitions_service_role_all ON public.guardian_variable_definitions;
CREATE POLICY guardian_variable_definitions_service_role_all
  ON public.guardian_variable_definitions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS guardian_config_versions_service_role_all ON public.guardian_config_versions;
CREATE POLICY guardian_config_versions_service_role_all
  ON public.guardian_config_versions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS tenant_guardian_settings_service_role_all ON public.tenant_guardian_settings;
CREATE POLICY tenant_guardian_settings_service_role_all
  ON public.tenant_guardian_settings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS tenant_guardian_variable_values_service_role_all ON public.tenant_guardian_variable_values;
CREATE POLICY tenant_guardian_variable_values_service_role_all
  ON public.tenant_guardian_variable_values
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS ai_message_candidates_service_role_all ON public.ai_message_candidates;
CREATE POLICY ai_message_candidates_service_role_all
  ON public.ai_message_candidates
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS outbound_validation_results_service_role_all ON public.outbound_validation_results;
CREATE POLICY outbound_validation_results_service_role_all
  ON public.outbound_validation_results
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS guardian_decisions_service_role_all ON public.guardian_decisions;
CREATE POLICY guardian_decisions_service_role_all
  ON public.guardian_decisions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS guardian_admin_audit_log_service_role_all ON public.guardian_admin_audit_log;
CREATE POLICY guardian_admin_audit_log_service_role_all
  ON public.guardian_admin_audit_log
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS guardian_test_cases_service_role_all ON public.guardian_test_cases;
CREATE POLICY guardian_test_cases_service_role_all
  ON public.guardian_test_cases
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS guardian_simulation_runs_service_role_all ON public.guardian_simulation_runs;
CREATE POLICY guardian_simulation_runs_service_role_all
  ON public.guardian_simulation_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.guardian_definitions TO authenticated;
GRANT SELECT ON public.guardian_variable_definitions TO authenticated;
GRANT SELECT ON public.guardian_config_versions TO authenticated;
GRANT SELECT ON public.tenant_guardian_settings TO authenticated;
GRANT SELECT ON public.tenant_guardian_variable_values TO authenticated;
GRANT SELECT ON public.ai_message_candidates TO authenticated;
GRANT SELECT ON public.outbound_validation_results TO authenticated;
GRANT SELECT ON public.guardian_decisions TO authenticated;
GRANT SELECT ON public.guardian_admin_audit_log TO authenticated;
GRANT SELECT ON public.guardian_test_cases TO authenticated;
GRANT SELECT ON public.guardian_simulation_runs TO authenticated;

GRANT ALL ON public.guardian_definitions TO service_role;
GRANT ALL ON public.guardian_variable_definitions TO service_role;
GRANT ALL ON public.guardian_config_versions TO service_role;
GRANT ALL ON public.tenant_guardian_settings TO service_role;
GRANT ALL ON public.tenant_guardian_variable_values TO service_role;
GRANT ALL ON public.ai_message_candidates TO service_role;
GRANT ALL ON public.outbound_validation_results TO service_role;
GRANT ALL ON public.guardian_decisions TO service_role;
GRANT ALL ON public.guardian_admin_audit_log TO service_role;
GRANT ALL ON public.guardian_test_cases TO service_role;
GRANT ALL ON public.guardian_simulation_runs TO service_role;
