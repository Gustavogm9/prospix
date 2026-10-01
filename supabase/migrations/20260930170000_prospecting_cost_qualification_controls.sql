-- Controlled prospecting, attributable provider usage, billing imports and
-- deterministic qualification state.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS search_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS capture_sources TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'SP',
  ADD COLUMN IF NOT EXISTS discovery_daily_budget_cents BIGINT NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_cost_per_eligible_lead_cents BIGINT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_provider_calls_per_run INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS discovery_auto_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS homologation_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS homologation_lead_limit INTEGER NOT NULL DEFAULT 20;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_discovery_daily_budget_nonnegative,
  ADD CONSTRAINT campaigns_discovery_daily_budget_nonnegative
    CHECK (discovery_daily_budget_cents >= 0),
  DROP CONSTRAINT IF EXISTS campaigns_cost_per_eligible_nonnegative,
  ADD CONSTRAINT campaigns_cost_per_eligible_nonnegative
    CHECK (max_cost_per_eligible_lead_cents >= 0),
  DROP CONSTRAINT IF EXISTS campaigns_provider_calls_positive,
  ADD CONSTRAINT campaigns_provider_calls_positive
    CHECK (max_provider_calls_per_run BETWEEN 1 AND 1000),
  DROP CONSTRAINT IF EXISTS campaigns_homologation_limit_positive,
  ADD CONSTRAINT campaigns_homologation_limit_positive
    CHECK (homologation_lead_limit BETWEEN 1 AND 100);

ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS qualification_config JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE TABLE IF NOT EXISTS public.prospecting_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (trigger_type IN ('MANUAL', 'CRON', 'QA')),
  requested_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  request_fingerprint TEXT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'STOPPED_BUDGET', 'SKIPPED')),
  requested_limit INTEGER NOT NULL CHECK (requested_limit BETWEEN 1 AND 100),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  provider_calls INTEGER NOT NULL DEFAULT 0 CHECK (provider_calls >= 0),
  estimated_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
  billed_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK (billed_cost_cents >= 0),
  daily_budget_cents BIGINT NOT NULL CHECK (daily_budget_cents >= 0),
  max_cost_per_eligible_lead_cents BIGINT NOT NULL CHECK (max_cost_per_eligible_lead_cents >= 0),
  max_provider_calls INTEGER NOT NULL CHECK (max_provider_calls BETWEEN 1 AND 1000),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  stop_reason TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS prospecting_runs_campaign_created_idx
  ON public.prospecting_runs (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prospecting_runs_tenant_status_idx
  ON public.prospecting_runs (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS prospecting_runs_rate_user_idx
  ON public.prospecting_runs (requested_by_id, created_at DESC)
  WHERE requested_by_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospecting_runs_rate_fingerprint_idx
  ON public.prospecting_runs (request_fingerprint, created_at DESC)
  WHERE request_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.provider_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID NULL REFERENCES public.campaigns(id) ON DELETE SET NULL,
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  prospecting_run_id UUID NULL REFERENCES public.prospecting_runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  source_type TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('ATTEMPTED', 'SUCCEEDED', 'FAILED')),
  quantity NUMERIC NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'request',
  estimated_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
  billed_cost_cents BIGINT NULL CHECK (billed_cost_cents IS NULL OR billed_cost_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = UPPER(currency)),
  external_request_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS provider_usage_events_run_idx
  ON public.provider_usage_events (prospecting_run_id, occurred_at);
CREATE INDEX IF NOT EXISTS provider_usage_events_campaign_idx
  ON public.provider_usage_events (campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS provider_usage_events_lead_idx
  ON public.provider_usage_events (lead_id, occurred_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.provider_cost_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checksum TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('GOOGLE_BILLING_EXPORT', 'CSV_IMPORT', 'API_IMPORT', 'MANUAL')),
  file_name TEXT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  total_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_cost_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = UPPER(currency) AND length(currency) = 3),
  created_by_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_cost_ledger
  ADD COLUMN IF NOT EXISTS campaign_id UUID NULL REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prospecting_run_id UUID NULL REFERENCES public.prospecting_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_usage_event_id UUID NULL REFERENCES public.provider_usage_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS import_id UUID NULL REFERENCES public.provider_cost_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allocation_method TEXT NOT NULL DEFAULT 'DIRECT'
    CHECK (allocation_method IN ('DIRECT', 'REQUEST_ID', 'PROPORTIONAL', 'UNALLOCATED'));

ALTER TABLE public.provider_cost_ledger
  DROP CONSTRAINT IF EXISTS provider_cost_ledger_provider_check;
ALTER TABLE public.provider_cost_ledger
  ADD CONSTRAINT provider_cost_ledger_provider_check CHECK (
    provider IN (
      'GOOGLE_CLOUD', 'GOOGLE_MAPS', 'OPENAI', 'WHATSAPP', 'EVOLUTION',
      'WAHA', 'TAVILY', 'FIRECRAWL', 'CNPJA', 'APIFY', 'INFOSIMPLES',
      'ESCAVADOR', 'INFRA', 'OTHER'
    )
  );

CREATE INDEX IF NOT EXISTS provider_cost_ledger_campaign_period_idx
  ON public.provider_cost_ledger (campaign_id, period_month DESC)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_cost_ledger_run_idx
  ON public.provider_cost_ledger (prospecting_run_id)
  WHERE prospecting_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_cost_ledger_lead_idx
  ON public.provider_cost_ledger (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.qualification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID NULL REFERENCES public.campaigns(id) ON DELETE SET NULL,
  script_id UUID NULL REFERENCES public.scripts(id) ON DELETE SET NULL,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  framework TEXT NOT NULL DEFAULT 'METLIFE_PROTECTION_INCOME_V1',
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'QUALIFIED', 'DISQUALIFIED', 'ESCALATED')),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  facts JSONB NOT NULL DEFAULT '{}'::JSONB,
  missing_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  current_question_key TEXT NULL,
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  last_source_message_id UUID NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  qualified_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS qualification_sessions_lead_idx
  ON public.qualification_sessions (tenant_id, lead_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS qualification_sessions_status_idx
  ON public.qualification_sessions (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.qualification_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  criterion_key TEXT NOT NULL,
  value JSONB NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_message_id UUID NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  evidence_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.qualification_sessions(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (session_id, criterion_key, source_message_id)
);

CREATE INDEX IF NOT EXISTS qualification_answers_session_idx
  ON public.qualification_answers (session_id, created_at);

CREATE TABLE IF NOT EXISTS public.campaign_qa_allowlist (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  approved_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, lead_id)
);

CREATE INDEX IF NOT EXISTS campaign_qa_allowlist_expires_idx
  ON public.campaign_qa_allowlist (expires_at);

ALTER TABLE public.prospecting_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_cost_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_qa_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospecting_runs_select ON public.prospecting_runs;
CREATE POLICY prospecting_runs_select ON public.prospecting_runs
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS provider_usage_events_select ON public.provider_usage_events;
CREATE POLICY provider_usage_events_select ON public.provider_usage_events
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS provider_cost_imports_admin_select ON public.provider_cost_imports;
CREATE POLICY provider_cost_imports_admin_select ON public.provider_cost_imports
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'GUILDS_ADMIN');

DROP POLICY IF EXISTS qualification_sessions_select ON public.qualification_sessions;
CREATE POLICY qualification_sessions_select ON public.qualification_sessions
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS qualification_answers_select ON public.qualification_answers;
CREATE POLICY qualification_answers_select ON public.qualification_answers
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS campaign_qa_allowlist_select ON public.campaign_qa_allowlist;
CREATE POLICY campaign_qa_allowlist_select ON public.campaign_qa_allowlist
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = campaign_id
        AND (
          c.tenant_id = (SELECT public.current_tenant_id())
          OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
        )
    )
  );

GRANT SELECT ON public.prospecting_runs TO authenticated;
GRANT SELECT ON public.provider_usage_events TO authenticated;
GRANT SELECT ON public.provider_cost_imports TO authenticated;
GRANT SELECT ON public.qualification_sessions TO authenticated;
GRANT SELECT ON public.qualification_answers TO authenticated;
GRANT SELECT ON public.campaign_qa_allowlist TO authenticated;
GRANT ALL ON public.prospecting_runs TO service_role;
GRANT ALL ON public.provider_usage_events TO service_role;
GRANT ALL ON public.provider_cost_imports TO service_role;
GRANT ALL ON public.qualification_sessions TO service_role;
GRANT ALL ON public.qualification_answers TO service_role;
GRANT ALL ON public.campaign_qa_allowlist TO service_role;

CREATE OR REPLACE FUNCTION public.touch_prospecting_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prospecting_runs_updated_at ON public.prospecting_runs;
CREATE TRIGGER prospecting_runs_updated_at
  BEFORE UPDATE ON public.prospecting_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_prospecting_updated_at();

DROP TRIGGER IF EXISTS qualification_sessions_updated_at ON public.qualification_sessions;
CREATE TRIGGER qualification_sessions_updated_at
  BEFORE UPDATE ON public.qualification_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_prospecting_updated_at();

CREATE OR REPLACE FUNCTION public.begin_prospecting_run(
  p_user_id UUID,
  p_tenant_id UUID,
  p_campaign_id UUID,
  p_source_type TEXT,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT,
  p_requested_limit INTEGER,
  p_config JSONB DEFAULT '{}'::JSONB,
  p_trigger_type TEXT DEFAULT 'MANUAL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_campaign public.campaigns%ROWTYPE;
  v_existing public.prospecting_runs%ROWTYPE;
  v_run public.prospecting_runs%ROWTYPE;
  v_effective_limit INTEGER;
  v_cost_today_micros BIGINT;
  v_start_brt TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL OR p_tenant_id IS NULL OR p_campaign_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_INVALID_SCOPE');
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_source_type, '')), '') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_INVALID_REQUEST');
  END IF;

  -- Serialize user/origin quotas and one campaign+source execution so parallel
  -- clicks and cron overlap cannot pass the same gate concurrently.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discovery-user:' || p_user_id::TEXT, 0)
  );
  IF p_request_fingerprint IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('discovery-origin:' || p_request_fingerprint, 0)
    );
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'discovery-campaign:' || p_tenant_id::TEXT || ':' || p_campaign_id::TEXT || ':' || UPPER(p_source_type),
      0
    )
  );

  SELECT * INTO v_user
  FROM public.users
  WHERE id = p_user_id
    AND deleted_at IS NULL;
  IF NOT FOUND OR v_user.role::TEXT NOT IN ('OWNER', 'ASSISTANT', 'GUILDS_ADMIN') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_FORBIDDEN');
  END IF;
  IF v_user.role::TEXT <> 'GUILDS_ADMIN' AND v_user.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_FORBIDDEN');
  END IF;

  SELECT * INTO v_existing
  FROM public.prospecting_runs
  WHERE tenant_id = p_tenant_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.requested_by_id IS DISTINCT FROM p_user_id
      OR v_existing.campaign_id IS DISTINCT FROM p_campaign_id
      OR v_existing.source_type IS DISTINCT FROM UPPER(p_source_type)
      OR v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint
      OR v_existing.config IS DISTINCT FROM COALESCE(p_config, '{}'::JSONB) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'replayed', true,
      'run_id', v_existing.id,
      'status', v_existing.status,
      'effective_limit', v_existing.requested_limit
    );
  END IF;

  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id
    AND deleted_at IS NULL;
  IF NOT FOUND OR v_tenant.status::TEXT <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_TENANT_NOT_ACTIVE');
  END IF;

  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND tenant_id = p_tenant_id
    AND archived_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_CAMPAIGN_NOT_FOUND');
  END IF;
  IF v_campaign.status::TEXT <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_CAMPAIGN_NOT_ACTIVE');
  END IF;
  IF NOT (UPPER(p_source_type) = ANY(COALESCE(v_campaign.capture_sources, ARRAY[]::TEXT[]))) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_SOURCE_NOT_ENABLED');
  END IF;

  IF (
    SELECT count(*)
    FROM public.prospecting_runs r
    WHERE r.requested_by_id = p_user_id
      AND r.created_at >= statement_timestamp() - INTERVAL '1 minute'
  ) >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_RATE_LIMIT_USER');
  END IF;
  IF p_request_fingerprint IS NOT NULL AND (
    SELECT count(*)
    FROM public.prospecting_runs r
    WHERE r.request_fingerprint = p_request_fingerprint
      AND r.created_at >= statement_timestamp() - INTERVAL '1 minute'
  ) >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_RATE_LIMIT_ORIGIN');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.prospecting_runs r
    WHERE r.campaign_id = p_campaign_id
      AND r.source_type = UPPER(p_source_type)
      AND r.status IN ('QUEUED', 'RUNNING')
      AND r.created_at >= statement_timestamp() - INTERVAL '30 minutes'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_ALREADY_RUNNING');
  END IF;

  v_start_brt := date_trunc('day', statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')
    AT TIME ZONE 'America/Sao_Paulo';
  SELECT COALESCE(sum(e.estimated_cost_micros), 0)
  INTO v_cost_today_micros
  FROM public.provider_usage_events e
  WHERE e.campaign_id = p_campaign_id
    AND e.prospecting_run_id IS NOT NULL
    AND e.occurred_at >= v_start_brt;
  IF v_cost_today_micros >= v_campaign.discovery_daily_budget_cents * 10000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_DAILY_BUDGET_EXCEEDED');
  END IF;

  v_effective_limit := LEAST(
    GREATEST(COALESCE(p_requested_limit, v_campaign.daily_limit, 1), 1),
    GREATEST(v_campaign.daily_limit, 1),
    CASE WHEN v_campaign.homologation_mode THEN v_campaign.homologation_lead_limit ELSE 100 END,
    100
  );

  INSERT INTO public.prospecting_runs (
    tenant_id, campaign_id, source_type, trigger_type, requested_by_id,
    request_fingerprint, idempotency_key, requested_limit,
    daily_budget_cents, max_cost_per_eligible_lead_cents, max_provider_calls,
    config
  ) VALUES (
    p_tenant_id, p_campaign_id, UPPER(p_source_type),
    CASE WHEN p_trigger_type IN ('MANUAL', 'CRON', 'QA') THEN p_trigger_type ELSE 'MANUAL' END,
    p_user_id, p_request_fingerprint, p_idempotency_key, v_effective_limit,
    v_campaign.discovery_daily_budget_cents,
    v_campaign.max_cost_per_eligible_lead_cents,
    v_campaign.max_provider_calls_per_run,
    COALESCE(p_config, '{}'::JSONB)
  )
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'ok', true,
    'replayed', false,
    'run_id', v_run.id,
    'status', v_run.status,
    'effective_limit', v_run.requested_limit,
    'remaining_budget_cents', GREATEST(
      0,
      v_campaign.discovery_daily_budget_cents - CEIL(v_cost_today_micros / 10000.0)::BIGINT
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_prospecting_run(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_prospecting_run(UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, JSONB, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_scheduled_prospecting_run(
  p_tenant_id UUID,
  p_campaign_id UUID,
  p_source_type TEXT,
  p_idempotency_key TEXT,
  p_requested_limit INTEGER,
  p_config JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_campaign public.campaigns%ROWTYPE;
  v_existing public.prospecting_runs%ROWTYPE;
  v_run public.prospecting_runs%ROWTYPE;
  v_effective_limit INTEGER;
  v_cost_today_micros BIGINT;
  v_start_brt TIMESTAMPTZ;
BEGIN
  IF p_tenant_id IS NULL OR p_campaign_id IS NULL
    OR NULLIF(BTRIM(COALESCE(p_source_type, '')), '') IS NULL
    OR NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_INVALID_REQUEST');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'discovery-campaign:' || p_tenant_id::TEXT || ':' || p_campaign_id::TEXT || ':' || UPPER(p_source_type),
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.prospecting_runs
  WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.requested_by_id IS NOT NULL
      OR v_existing.campaign_id IS DISTINCT FROM p_campaign_id
      OR v_existing.source_type IS DISTINCT FROM UPPER(p_source_type)
      OR v_existing.config IS DISTINCT FROM COALESCE(p_config, '{}'::JSONB) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'replayed', true, 'run_id', v_existing.id,
      'status', v_existing.status, 'effective_limit', v_existing.requested_limit
    );
  END IF;

  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id AND deleted_at IS NULL AND status::TEXT = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_TENANT_NOT_ACTIVE');
  END IF;

  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND tenant_id = p_tenant_id
    AND archived_at IS NULL
    AND status::TEXT = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_CAMPAIGN_NOT_ACTIVE');
  END IF;
  IF NOT (UPPER(p_source_type) = ANY(COALESCE(v_campaign.capture_sources, ARRAY[]::TEXT[]))) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_SOURCE_NOT_ENABLED');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.prospecting_runs r
    WHERE r.campaign_id = p_campaign_id
      AND r.source_type = UPPER(p_source_type)
      AND r.status IN ('QUEUED', 'RUNNING')
      AND r.created_at >= statement_timestamp() - INTERVAL '30 minutes'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_ALREADY_RUNNING');
  END IF;

  v_start_brt := date_trunc('day', statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')
    AT TIME ZONE 'America/Sao_Paulo';
  SELECT COALESCE(sum(e.estimated_cost_micros), 0)
  INTO v_cost_today_micros
  FROM public.provider_usage_events e
  WHERE e.campaign_id = p_campaign_id
    AND e.prospecting_run_id IS NOT NULL
    AND e.occurred_at >= v_start_brt;
  IF v_cost_today_micros >= v_campaign.discovery_daily_budget_cents * 10000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISCOVERY_DAILY_BUDGET_EXCEEDED');
  END IF;

  v_effective_limit := LEAST(
    GREATEST(COALESCE(p_requested_limit, v_campaign.daily_limit, 1), 1),
    GREATEST(v_campaign.daily_limit, 1),
    CASE WHEN v_campaign.homologation_mode THEN v_campaign.homologation_lead_limit ELSE 100 END,
    100
  );

  INSERT INTO public.prospecting_runs (
    tenant_id, campaign_id, source_type, trigger_type, requested_by_id,
    request_fingerprint, idempotency_key, requested_limit,
    daily_budget_cents, max_cost_per_eligible_lead_cents, max_provider_calls, config
  ) VALUES (
    p_tenant_id, p_campaign_id, UPPER(p_source_type), 'CRON', NULL,
    NULL, p_idempotency_key, v_effective_limit,
    v_campaign.discovery_daily_budget_cents,
    v_campaign.max_cost_per_eligible_lead_cents,
    v_campaign.max_provider_calls_per_run,
    COALESCE(p_config, '{}'::JSONB)
  ) RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'ok', true, 'replayed', false, 'run_id', v_run.id,
    'status', v_run.status, 'effective_limit', v_run.requested_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_scheduled_prospecting_run(UUID, UUID, TEXT, TEXT, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_scheduled_prospecting_run(UUID, UUID, TEXT, TEXT, INTEGER, JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_provider_usage_event(
  p_tenant_id UUID,
  p_campaign_id UUID,
  p_lead_id UUID,
  p_prospecting_run_id UUID,
  p_provider TEXT,
  p_service TEXT,
  p_operation TEXT,
  p_source_type TEXT,
  p_status TEXT,
  p_quantity NUMERIC,
  p_unit TEXT,
  p_estimated_cost_micros BIGINT,
  p_external_request_id TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.provider_usage_events%ROWTYPE;
  v_run public.prospecting_runs%ROWTYPE;
  v_cost_per_eligible_cents BIGINT := 0;
  v_daily_cost_micros BIGINT := 0;
  v_start_brt TIMESTAMPTZ;
  v_campaign public.campaigns%ROWTYPE;
  v_should_stop BOOLEAN := false;
  v_stop_reason TEXT := NULL;
BEGIN
  IF p_tenant_id IS NULL OR NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid provider usage scope' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('ATTEMPTED', 'SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'invalid provider usage status' USING ERRCODE = '22023';
  END IF;
  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = p_campaign_id AND c.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'provider usage campaign scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id
      AND l.tenant_id = p_tenant_id
      AND (p_campaign_id IS NULL OR l.campaign_id = p_campaign_id)
  ) THEN
    RAISE EXCEPTION 'provider usage lead scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_prospecting_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.prospecting_runs r
    WHERE r.id = p_prospecting_run_id
      AND r.tenant_id = p_tenant_id
      AND (p_campaign_id IS NULL OR r.campaign_id = p_campaign_id)
  ) THEN
    RAISE EXCEPTION 'provider usage run scope mismatch' USING ERRCODE = '42501';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('provider-budget:' || p_campaign_id::TEXT, 0)
    );
  END IF;

  INSERT INTO public.provider_usage_events (
    tenant_id, campaign_id, lead_id, prospecting_run_id, provider, service,
    operation, source_type, status, quantity, unit, estimated_cost_micros,
    external_request_id, idempotency_key, metadata
  ) VALUES (
    p_tenant_id, p_campaign_id, p_lead_id, p_prospecting_run_id,
    UPPER(p_provider), p_service, p_operation, p_source_type, p_status,
    GREATEST(COALESCE(p_quantity, 1), 0), COALESCE(NULLIF(p_unit, ''), 'request'),
    GREATEST(COALESCE(p_estimated_cost_micros, 0), 0), p_external_request_id,
    p_idempotency_key, COALESCE(p_metadata, '{}'::JSONB)
  )
  ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
  SET
    status = EXCLUDED.status,
    external_request_id = COALESCE(EXCLUDED.external_request_id, public.provider_usage_events.external_request_id),
    metadata = public.provider_usage_events.metadata || EXCLUDED.metadata
  RETURNING * INTO v_event;

  IF v_event.campaign_id IS DISTINCT FROM p_campaign_id
    OR v_event.lead_id IS DISTINCT FROM p_lead_id
    OR v_event.prospecting_run_id IS DISTINCT FROM p_prospecting_run_id
    OR v_event.provider IS DISTINCT FROM UPPER(p_provider)
    OR v_event.service IS DISTINCT FROM p_service
    OR v_event.operation IS DISTINCT FROM p_operation
    OR v_event.source_type IS DISTINCT FROM p_source_type THEN
    RAISE EXCEPTION 'provider usage idempotency scope mismatch' USING ERRCODE = '42501';
  END IF;

  IF p_prospecting_run_id IS NOT NULL THEN
    UPDATE public.prospecting_runs r
    SET
      provider_calls = (
        SELECT count(*)::INTEGER
        FROM public.provider_usage_events e
        WHERE e.prospecting_run_id = r.id
      ),
      estimated_cost_micros = (
        SELECT COALESCE(sum(e.estimated_cost_micros), 0)
        FROM public.provider_usage_events e
        WHERE e.prospecting_run_id = r.id
      )
    WHERE r.id = p_prospecting_run_id
      AND r.tenant_id = p_tenant_id
    RETURNING * INTO v_run;

    IF v_run.id IS NOT NULL THEN
      v_start_brt := date_trunc('day', statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')
        AT TIME ZONE 'America/Sao_Paulo';
      SELECT COALESCE(sum(e.estimated_cost_micros), 0)
      INTO v_daily_cost_micros
      FROM public.provider_usage_events e
      WHERE e.campaign_id = v_run.campaign_id
        AND e.prospecting_run_id IS NOT NULL
        AND e.occurred_at >= v_start_brt;

      IF v_run.eligible_count > 0 THEN
        v_cost_per_eligible_cents := CEIL(
          v_run.estimated_cost_micros / 10000.0 / v_run.eligible_count
        )::BIGINT;
      END IF;
      IF v_daily_cost_micros >= v_run.daily_budget_cents * 10000 THEN
        v_should_stop := true;
        v_stop_reason := 'DAILY_BUDGET';
      ELSIF v_run.provider_calls >= v_run.max_provider_calls THEN
        v_should_stop := true;
        v_stop_reason := 'MAX_PROVIDER_CALLS';
      ELSIF v_run.estimated_cost_micros >= v_run.daily_budget_cents * 10000 THEN
        v_should_stop := true;
        v_stop_reason := 'RUN_BUDGET';
      ELSIF v_run.discovered_count >= LEAST(5, v_run.requested_limit)
        AND v_run.eligible_count = 0
        AND v_run.estimated_cost_micros > v_run.max_cost_per_eligible_lead_cents * 10000 THEN
        v_should_stop := true;
        v_stop_reason := 'NO_ELIGIBLE_LEADS';
      ELSIF v_run.discovered_count >= LEAST(5, v_run.requested_limit)
        AND v_run.eligible_count > 0
        AND v_cost_per_eligible_cents > v_run.max_cost_per_eligible_lead_cents THEN
        v_should_stop := true;
        v_stop_reason := 'COST_PER_ELIGIBLE_LEAD';
      END IF;

      IF v_should_stop THEN
        UPDATE public.prospecting_runs
        SET status = 'STOPPED_BUDGET', stop_reason = v_stop_reason,
            completed_at = statement_timestamp()
        WHERE id = v_run.id AND status IN ('QUEUED', 'RUNNING');
      END IF;
    END IF;
  ELSIF p_campaign_id IS NOT NULL AND UPPER(COALESCE(p_source_type, '')) = 'ENRICHMENT' THEN
    SELECT * INTO v_campaign
    FROM public.campaigns c
    WHERE c.id = p_campaign_id AND c.tenant_id = p_tenant_id;

    v_start_brt := date_trunc('day', statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')
      AT TIME ZONE 'America/Sao_Paulo';
    SELECT COALESCE(sum(e.estimated_cost_micros), 0)
    INTO v_daily_cost_micros
    FROM public.provider_usage_events e
    WHERE e.campaign_id = p_campaign_id
      AND e.occurred_at >= v_start_brt;

    IF v_campaign.id IS NOT NULL
      AND v_daily_cost_micros >= v_campaign.discovery_daily_budget_cents * 10000 THEN
      v_should_stop := true;
      v_stop_reason := 'DAILY_BUDGET';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'should_stop', v_should_stop,
    'stop_reason', v_stop_reason,
    'cost_per_eligible_lead_cents', v_cost_per_eligible_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_provider_usage_event(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, BIGINT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_provider_usage_event(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, BIGINT, TEXT, TEXT, JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.update_prospecting_run_progress(
  p_run_id UUID,
  p_discovered_delta INTEGER DEFAULT 0,
  p_eligible_delta INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.prospecting_runs%ROWTYPE;
  v_cost_per_eligible_cents BIGINT := 0;
  v_should_stop BOOLEAN := false;
  v_stop_reason TEXT := NULL;
BEGIN
  UPDATE public.prospecting_runs
  SET
    discovered_count = discovered_count + GREATEST(COALESCE(p_discovered_delta, 0), 0),
    eligible_count = eligible_count + GREATEST(COALESCE(p_eligible_delta, 0), 0)
  WHERE id = p_run_id AND status IN ('QUEUED', 'RUNNING')
  RETURNING * INTO v_run;
  IF v_run.id IS NULL THEN
    SELECT * INTO v_run FROM public.prospecting_runs WHERE id = p_run_id;
    IF v_run.id IS NULL THEN
      RAISE EXCEPTION 'prospecting run not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'should_stop', v_run.status = 'STOPPED_BUDGET',
      'stop_reason', v_run.stop_reason
    );
  END IF;

  IF v_run.eligible_count > 0 THEN
    v_cost_per_eligible_cents := CEIL(
      v_run.estimated_cost_micros / 10000.0 / v_run.eligible_count
    )::BIGINT;
  END IF;
  IF v_run.provider_calls >= v_run.max_provider_calls THEN
    v_should_stop := true;
    v_stop_reason := 'MAX_PROVIDER_CALLS';
  ELSIF v_run.estimated_cost_micros >= v_run.daily_budget_cents * 10000 THEN
    v_should_stop := true;
    v_stop_reason := 'RUN_BUDGET';
  ELSIF v_run.discovered_count >= LEAST(5, v_run.requested_limit)
    AND v_run.eligible_count = 0
    AND v_run.estimated_cost_micros > v_run.max_cost_per_eligible_lead_cents * 10000 THEN
    v_should_stop := true;
    v_stop_reason := 'NO_ELIGIBLE_LEADS';
  ELSIF v_run.discovered_count >= LEAST(5, v_run.requested_limit)
    AND v_run.eligible_count > 0
    AND v_cost_per_eligible_cents > v_run.max_cost_per_eligible_lead_cents THEN
    v_should_stop := true;
    v_stop_reason := 'COST_PER_ELIGIBLE_LEAD';
  END IF;

  IF v_should_stop THEN
    UPDATE public.prospecting_runs
    SET status = 'STOPPED_BUDGET', stop_reason = v_stop_reason,
        completed_at = statement_timestamp()
    WHERE id = p_run_id AND status IN ('QUEUED', 'RUNNING');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'should_stop', v_should_stop,
    'stop_reason', v_stop_reason,
    'discovered_count', v_run.discovered_count,
    'eligible_count', v_run.eligible_count,
    'cost_per_eligible_lead_cents', v_cost_per_eligible_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_prospecting_run_progress(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_prospecting_run_progress(UUID, INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_prospecting_run(
  p_run_id UUID,
  p_status TEXT,
  p_discovered_count INTEGER,
  p_inserted_count INTEGER,
  p_duplicate_count INTEGER,
  p_eligible_count INTEGER,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS public.prospecting_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.prospecting_runs%ROWTYPE;
BEGIN
  IF p_status NOT IN ('SUCCEEDED', 'FAILED', 'STOPPED_BUDGET', 'SKIPPED') THEN
    RAISE EXCEPTION 'invalid final prospecting status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.prospecting_runs
  SET
    status = CASE WHEN status = 'STOPPED_BUDGET' THEN status ELSE p_status END,
    discovered_count = GREATEST(COALESCE(p_discovered_count, 0), 0),
    inserted_count = GREATEST(COALESCE(p_inserted_count, 0), 0),
    duplicate_count = GREATEST(COALESCE(p_duplicate_count, 0), 0),
    eligible_count = GREATEST(COALESCE(p_eligible_count, 0), 0),
    error_code = p_error_code,
    error_message = LEFT(p_error_message, 500),
    completed_at = statement_timestamp()
  WHERE id = p_run_id
  RETURNING * INTO v_run;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'prospecting run not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_run;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_prospecting_run(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_prospecting_run(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_qualification_turn(
  p_tenant_id UUID,
  p_campaign_id UUID,
  p_script_id UUID,
  p_lead_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_facts JSONB,
  p_answers JSONB,
  p_missing_fields TEXT[],
  p_score INTEGER,
  p_status TEXT,
  p_current_question_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.qualification_sessions%ROWTYPE;
  v_answer JSONB;
BEGIN
  IF p_status NOT IN ('IN_PROGRESS', 'QUALIFIED', 'DISQUALIFIED', 'ESCALATED') THEN
    RAISE EXCEPTION 'invalid qualification status' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.leads l ON l.id = c.lead_id AND l.tenant_id = c.tenant_id
    WHERE c.id = p_conversation_id
      AND c.tenant_id = p_tenant_id
      AND l.id = p_lead_id
  ) THEN
    RAISE EXCEPTION 'qualification scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = p_campaign_id AND c.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'qualification campaign scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_script_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.scripts s
    WHERE s.id = p_script_id AND s.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'qualification script scope mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_source_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_source_message_id
      AND m.tenant_id = p_tenant_id
      AND m.conversation_id = p_conversation_id
      AND m.direction::TEXT = 'INBOUND'
  ) THEN
    RAISE EXCEPTION 'qualification message scope mismatch' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.qualification_sessions (
    tenant_id, campaign_id, script_id, lead_id, conversation_id,
    status, score, facts, missing_fields, current_question_key,
    question_count, last_source_message_id, qualified_at, completed_at
  ) VALUES (
    p_tenant_id, p_campaign_id, p_script_id, p_lead_id, p_conversation_id,
    p_status, LEAST(GREATEST(COALESCE(p_score, 0), 0), 100),
    COALESCE(p_facts, '{}'::JSONB), COALESCE(p_missing_fields, ARRAY[]::TEXT[]),
    p_current_question_key,
    CASE WHEN p_current_question_key IS NULL THEN 0 ELSE 1 END,
    p_source_message_id,
    CASE WHEN p_status = 'QUALIFIED' THEN statement_timestamp() ELSE NULL END,
    CASE WHEN p_status IN ('QUALIFIED', 'DISQUALIFIED', 'ESCALATED') THEN statement_timestamp() ELSE NULL END
  )
  ON CONFLICT (tenant_id, conversation_id) DO UPDATE
  SET
    campaign_id = COALESCE(EXCLUDED.campaign_id, public.qualification_sessions.campaign_id),
    script_id = COALESCE(EXCLUDED.script_id, public.qualification_sessions.script_id),
    status = EXCLUDED.status,
    score = EXCLUDED.score,
    facts = public.qualification_sessions.facts || EXCLUDED.facts,
    missing_fields = EXCLUDED.missing_fields,
    current_question_key = EXCLUDED.current_question_key,
    question_count = public.qualification_sessions.question_count + CASE
      WHEN EXCLUDED.current_question_key IS NULL THEN 0
      WHEN public.qualification_sessions.last_source_message_id IS NOT DISTINCT FROM EXCLUDED.last_source_message_id THEN 0
      ELSE 1
    END,
    last_source_message_id = EXCLUDED.last_source_message_id,
    qualified_at = CASE
      WHEN EXCLUDED.status = 'QUALIFIED' THEN COALESCE(public.qualification_sessions.qualified_at, statement_timestamp())
      ELSE public.qualification_sessions.qualified_at
    END,
    completed_at = CASE
      WHEN EXCLUDED.status IN ('QUALIFIED', 'DISQUALIFIED', 'ESCALATED') THEN statement_timestamp()
      ELSE NULL
    END
  RETURNING * INTO v_session;

  FOR v_answer IN SELECT value FROM jsonb_array_elements(COALESCE(p_answers, '[]'::JSONB)) LOOP
    IF NULLIF(BTRIM(v_answer->>'criterion_key'), '') IS NULL THEN
      CONTINUE;
    END IF;
    INSERT INTO public.qualification_answers (
      tenant_id, session_id, criterion_key, value, confidence,
      source_message_id, evidence_hash
    ) VALUES (
      p_tenant_id,
      v_session.id,
      v_answer->>'criterion_key',
      COALESCE(v_answer->'value', 'null'::JSONB),
      LEAST(GREATEST(COALESCE((v_answer->>'confidence')::NUMERIC, 0), 0), 1),
      p_source_message_id,
      encode(digest(
        concat_ws('|', v_session.id::TEXT, v_answer->>'criterion_key',
          COALESCE((v_answer->'value')::TEXT, 'null'), COALESCE(p_source_message_id::TEXT, '')),
        'sha256'
      ), 'hex')
    )
    ON CONFLICT (session_id, criterion_key, source_message_id) DO UPDATE
    SET
      value = EXCLUDED.value,
      confidence = GREATEST(public.qualification_answers.confidence, EXCLUDED.confidence),
      evidence_hash = EXCLUDED.evidence_hash;
  END LOOP;

  IF p_status = 'QUALIFIED' THEN
    UPDATE public.leads
    SET
      status = CASE
        WHEN status IN ('CAPTURED', 'ENRICHED', 'CONTACTED', 'NO_RESPONSE', 'CONVERSING') THEN 'QUALIFIED'
        ELSE status
      END,
      qualified_at = COALESCE(qualified_at, statement_timestamp()),
      updated_at = statement_timestamp()
    WHERE id = p_lead_id AND tenant_id = p_tenant_id;
  END IF;

  RETURN to_jsonb(v_session);
END;
$$;

REVOKE ALL ON FUNCTION public.record_qualification_turn(UUID, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT[], INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_qualification_turn(UUID, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT[], INTEGER, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.import_provider_cost_rows(
  p_admin_user_id UUID,
  p_checksum TEXT,
  p_source TEXT,
  p_file_name TEXT,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_import public.provider_cost_imports%ROWTYPE;
  v_row JSONB;
  v_inserted INTEGER := 0;
  v_duplicates INTEGER := 0;
  v_total BIGINT := 0;
  v_row_count INTEGER;
  v_tenant_id UUID;
  v_campaign_id UUID;
  v_lead_id UUID;
  v_run_id UUID;
  v_usage_event_id UUID;
  v_usage_event public.provider_usage_events%ROWTYPE;
  v_usage_event_matches INTEGER := 0;
  v_currency TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_admin_user_id
      AND u.role::TEXT = 'GUILDS_ADMIN'
      AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'billing import forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('GOOGLE_BILLING_EXPORT', 'CSV_IMPORT', 'API_IMPORT', 'MANUAL') THEN
    RAISE EXCEPTION 'invalid billing source' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_checksum, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid billing checksum' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('provider-cost-import:' || p_checksum, 0)
  );
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'billing rows must be an array' USING ERRCODE = '22023';
  END IF;
  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count < 1 OR v_row_count > 500 THEN
    RAISE EXCEPTION 'billing rows must contain between 1 and 500 items' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT UPPER(COALESCE(NULLIF(value->>'currency', ''), 'BRL'))),
         min(UPPER(COALESCE(NULLIF(value->>'currency', ''), 'BRL')))
  INTO v_usage_event_matches, v_currency
  FROM jsonb_array_elements(p_rows);
  IF v_usage_event_matches <> 1 OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'billing import must contain one valid currency' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_import
  FROM public.provider_cost_imports
  WHERE checksum = p_checksum;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'replayed', true, 'import_id', v_import.id,
      'inserted_count', v_import.inserted_count,
      'duplicate_count', v_import.duplicate_count,
      'total_cost_cents', v_import.total_cost_cents,
      'currency', v_import.currency
    );
  END IF;

  INSERT INTO public.provider_cost_imports (
    checksum, source, file_name, row_count, currency, created_by_id
  ) VALUES (
    p_checksum, p_source, NULLIF(BTRIM(COALESCE(p_file_name, '')), ''),
    v_row_count, v_currency, p_admin_user_id
  ) RETURNING * INTO v_import;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_tenant_id := NULLIF(v_row->>'tenant_id', '')::UUID;
    v_campaign_id := NULLIF(v_row->>'campaign_id', '')::UUID;
    v_lead_id := NULLIF(v_row->>'lead_id', '')::UUID;
    v_run_id := NULLIF(v_row->>'prospecting_run_id', '')::UUID;
    v_usage_event_id := NULLIF(v_row->>'provider_usage_event_id', '')::UUID;
    v_usage_event := NULL;

    IF COALESCE((v_row->>'estimated')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'estimated rows are not accepted as real billing' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(NULLIF(v_row->>'allocation_method', ''),
      CASE WHEN v_tenant_id IS NULL THEN 'UNALLOCATED' ELSE 'DIRECT' END
    ) NOT IN ('DIRECT', 'REQUEST_ID', 'PROPORTIONAL', 'UNALLOCATED') THEN
      RAISE EXCEPTION 'invalid billing allocation method' USING ERRCODE = '22023';
    END IF;

    IF v_usage_event_id IS NOT NULL THEN
      SELECT * INTO v_usage_event
      FROM public.provider_usage_events e
      WHERE e.id = v_usage_event_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown provider usage event in billing row' USING ERRCODE = '22023';
      END IF;
    ELSIF NULLIF(v_row->>'external_request_id', '') IS NOT NULL THEN
      SELECT count(*) INTO v_usage_event_matches
      FROM public.provider_usage_events e
      WHERE e.external_request_id = v_row->>'external_request_id'
        AND e.provider = UPPER(v_row->>'provider')
        AND (v_tenant_id IS NULL OR e.tenant_id = v_tenant_id);
      IF v_usage_event_matches > 1 THEN
        RAISE EXCEPTION 'ambiguous provider request id in billing row' USING ERRCODE = '22023';
      ELSIF v_usage_event_matches = 1 THEN
        SELECT * INTO v_usage_event
        FROM public.provider_usage_events e
        WHERE e.external_request_id = v_row->>'external_request_id'
          AND e.provider = UPPER(v_row->>'provider')
          AND (v_tenant_id IS NULL OR e.tenant_id = v_tenant_id)
        LIMIT 1;
        v_usage_event_id := v_usage_event.id;
      END IF;
    END IF;

    IF v_usage_event.id IS NOT NULL THEN
      IF UPPER(COALESCE(v_row->>'provider', '')) IS DISTINCT FROM v_usage_event.provider THEN
        RAISE EXCEPTION 'provider usage provider mismatch in billing row' USING ERRCODE = '22023';
      END IF;
      IF (v_tenant_id IS NOT NULL AND v_tenant_id IS DISTINCT FROM v_usage_event.tenant_id)
        OR (v_campaign_id IS NOT NULL AND v_campaign_id IS DISTINCT FROM v_usage_event.campaign_id)
        OR (v_lead_id IS NOT NULL AND v_lead_id IS DISTINCT FROM v_usage_event.lead_id)
        OR (v_run_id IS NOT NULL AND v_run_id IS DISTINCT FROM v_usage_event.prospecting_run_id) THEN
        RAISE EXCEPTION 'provider usage attribution mismatch in billing row' USING ERRCODE = '22023';
      END IF;
      IF v_usage_event.currency <> v_currency THEN
        RAISE EXCEPTION 'provider usage currency mismatch in billing row' USING ERRCODE = '22023';
      END IF;
      v_tenant_id := COALESCE(v_tenant_id, v_usage_event.tenant_id);
      v_campaign_id := COALESCE(v_campaign_id, v_usage_event.campaign_id);
      v_lead_id := COALESCE(v_lead_id, v_usage_event.lead_id);
      v_run_id := COALESCE(v_run_id, v_usage_event.prospecting_run_id);
    ELSIF NULLIF(v_row->>'external_request_id', '') IS NOT NULL
      OR COALESCE(v_row->>'allocation_method', '') = 'REQUEST_ID' THEN
      RAISE EXCEPTION 'provider request id was not reconciled' USING ERRCODE = '22023';
    END IF;

    IF v_tenant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tenants t WHERE t.id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'unknown tenant in billing row' USING ERRCODE = '22023';
    END IF;
    IF v_campaign_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = v_campaign_id AND c.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'campaign attribution mismatch in billing row' USING ERRCODE = '22023';
    END IF;
    IF v_lead_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = v_lead_id
        AND l.tenant_id = v_tenant_id
        AND (v_campaign_id IS NULL OR l.campaign_id = v_campaign_id)
    ) THEN
      RAISE EXCEPTION 'lead attribution mismatch in billing row' USING ERRCODE = '22023';
    END IF;
    IF v_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prospecting_runs r
      WHERE r.id = v_run_id
        AND r.tenant_id = v_tenant_id
        AND (v_campaign_id IS NULL OR r.campaign_id = v_campaign_id)
    ) THEN
      RAISE EXCEPTION 'run attribution mismatch in billing row' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((v_row->>'cost_cents')::BIGINT, -1) < 0
      OR NULLIF(v_row->>'external_row_id', '') IS NULL THEN
      RAISE EXCEPTION 'invalid billing cost or external row id' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.provider_cost_ledger (
      tenant_id, campaign_id, lead_id, prospecting_run_id, provider_usage_event_id,
      provider, service, sku_id, sku_description, period_month,
      usage_start_at, usage_end_at, cost_cents, currency, quantity, unit,
      source, attribution_status, external_project_id,
      external_billing_account_id, external_invoice_id, external_row_id,
      evidence, notes, created_by_id, import_id, allocation_method
    ) VALUES (
      v_tenant_id, v_campaign_id, v_lead_id, v_run_id, v_usage_event_id,
      UPPER(v_row->>'provider'), v_row->>'service',
      NULLIF(v_row->>'sku_id', ''), NULLIF(v_row->>'sku_description', ''),
      (v_row->>'period_month')::DATE,
      NULLIF(v_row->>'usage_start_at', '')::TIMESTAMPTZ,
      NULLIF(v_row->>'usage_end_at', '')::TIMESTAMPTZ,
      (v_row->>'cost_cents')::BIGINT,
      UPPER(COALESCE(NULLIF(v_row->>'currency', ''), 'BRL')),
      NULLIF(v_row->>'quantity', '')::NUMERIC,
      NULLIF(v_row->>'unit', ''), p_source,
      CASE
        WHEN v_tenant_id IS NULL THEN 'UNALLOCATED'
        WHEN COALESCE((v_row->>'estimated')::BOOLEAN, false) THEN 'ESTIMATED'
        ELSE 'TENANT_ATTRIBUTED'
      END,
      NULLIF(v_row->>'external_project_id', ''),
      NULLIF(v_row->>'external_billing_account_id', ''),
      NULLIF(v_row->>'external_invoice_id', ''),
      v_row->>'external_row_id',
      COALESCE(v_row->'evidence', '{}'::JSONB) || jsonb_build_object(
        'import_checksum', p_checksum,
        'external_request_id', NULLIF(v_row->>'external_request_id', '')
      ),
      NULLIF(v_row->>'notes', ''), p_admin_user_id::TEXT, v_import.id,
      CASE WHEN v_usage_event_id IS NOT NULL THEN 'REQUEST_ID' ELSE COALESCE(NULLIF(v_row->>'allocation_method', ''),
        CASE WHEN v_tenant_id IS NULL THEN 'UNALLOCATED' ELSE 'DIRECT' END)
      END
    )
    ON CONFLICT (source, external_row_id) WHERE external_row_id IS NOT NULL DO NOTHING;

    IF FOUND THEN
      v_inserted := v_inserted + 1;
      v_total := v_total + (v_row->>'cost_cents')::BIGINT;
      IF v_usage_event_id IS NOT NULL THEN
        UPDATE public.provider_usage_events
        SET billed_cost_cents = COALESCE(billed_cost_cents, 0) + (v_row->>'cost_cents')::BIGINT,
            currency = v_currency
        WHERE id = v_usage_event_id;
      END IF;
      IF v_run_id IS NOT NULL AND v_currency = 'BRL' THEN
        UPDATE public.prospecting_runs run
        SET billed_cost_cents = (
          SELECT COALESCE(sum(ledger.cost_cents), 0)
          FROM public.provider_cost_ledger ledger
          WHERE ledger.prospecting_run_id = v_run_id
            AND ledger.currency = 'BRL'
        )
        WHERE run.id = v_run_id;
      END IF;
    ELSE
      v_duplicates := v_duplicates + 1;
    END IF;
  END LOOP;

  UPDATE public.provider_cost_imports
  SET inserted_count = v_inserted,
      duplicate_count = v_duplicates,
      total_cost_cents = v_total
  WHERE id = v_import.id
  RETURNING * INTO v_import;

  RETURN jsonb_build_object(
    'ok', true, 'replayed', false, 'import_id', v_import.id,
    'inserted_count', v_inserted, 'duplicate_count', v_duplicates,
    'total_cost_cents', v_total, 'currency', v_currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_provider_cost_rows(UUID, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_provider_cost_rows(UUID, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

COMMENT ON TABLE public.prospecting_runs IS
  'Auditable discovery executions with idempotency, budgets and source attribution.';
COMMENT ON TABLE public.provider_usage_events IS
  'Operational provider calls. Costs here are estimates until reconciled with provider_cost_ledger.';
COMMENT ON TABLE public.provider_cost_ledger IS
  'Externally verifiable provider billing rows. Operational estimates belong in provider_usage_events.';
COMMENT ON TABLE public.qualification_sessions IS
  'Current deterministic qualification state for one conversation.';
COMMENT ON TABLE public.qualification_answers IS
  'Append-only structured qualification facts with source-message evidence hashes.';
COMMENT ON COLUMN public.prospecting_runs.billed_cost_cents IS
  'Reconciled BRL billing total for this run; non-BRL rows remain attributable in provider_cost_ledger.';

-- G09 validates the generated candidate, so it must run after generation.
UPDATE public.guardian_definitions
SET execution_stage = 'POST_GENERATION',
    description = 'Enforces one objective question per turn, no health data and no premature agenda.',
    updated_at = statement_timestamp()
WHERE guardian_key = 'G09_QUALIFICATION';

COMMIT;
