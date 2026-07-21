-- Baseline follow-up: RLS/grants hardening for exposed tables and
-- quarantine of legacy queue items missing Guardian V3 validation evidence.
--
-- Explicit exclusions per owner instruction:
-- - Do not rotate secrets.
-- - Do not change pg_cron schedules or cron authentication headers.
-- - Do not modify the process-followups x-local-dev compatibility path.

BEGIN;

-- Shared tenant predicate used by policies below.
-- Kept inline because CREATE POLICY cannot call a temp helper function.

-- plan_limits is global product configuration. It should be readable by
-- authenticated users, but not writable through anon/authenticated API roles.
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_limits_read ON public.plan_limits;
CREATE POLICY plan_limits_read
  ON public.plan_limits
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON public.plan_limits FROM anon, authenticated;
GRANT SELECT ON public.plan_limits TO authenticated;
GRANT ALL ON public.plan_limits TO service_role;

-- tenant_addons is tenant-scoped and used by the client-side Supabase queries.
-- RLS must allow the authenticated tenant to read, purchase, and cancel add-ons.
ALTER TABLE public.tenant_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_addons_read ON public.tenant_addons;
DROP POLICY IF EXISTS tenant_addons_insert ON public.tenant_addons;
DROP POLICY IF EXISTS tenant_addons_update ON public.tenant_addons;

CREATE POLICY tenant_addons_read
  ON public.tenant_addons
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT users.tenant_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

CREATE POLICY tenant_addons_insert
  ON public.tenant_addons
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT users.tenant_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

CREATE POLICY tenant_addons_update
  ON public.tenant_addons
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT users.tenant_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT users.tenant_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

REVOKE ALL ON public.tenant_addons FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_addons TO authenticated;
GRANT ALL ON public.tenant_addons TO service_role;

-- CNPJ caches are operational cache tables populated by service-role Edge
-- Functions. They do not contain tenant ownership columns and must not be
-- mutable through public API roles.
ALTER TABLE public.cnpj_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cnpj_name_search_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cnpj_cache FROM anon, authenticated;
REVOKE ALL ON public.cnpj_name_search_cache FROM anon, authenticated;
GRANT ALL ON public.cnpj_cache TO service_role;
GRANT ALL ON public.cnpj_name_search_cache TO service_role;

-- WhatsApp Guardian status/telemetry are tenant-scoped operational tables.
-- Frontend/API flows use service role today, but authenticated SELECT keeps
-- future read-only dashboards tenant-safe without exposing write paths.
ALTER TABLE public.whatsapp_guardian_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_guardian_status_read ON public.whatsapp_guardian_status;
CREATE POLICY whatsapp_guardian_status_read
  ON public.whatsapp_guardian_status
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT users.tenant_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

REVOKE ALL ON public.whatsapp_guardian_status FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_guardian_status TO authenticated;
GRANT ALL ON public.whatsapp_guardian_status TO service_role;

ALTER TABLE public.whatsapp_guardian_telemetry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_guardian_telemetry_read ON public.whatsapp_guardian_telemetry;
CREATE POLICY whatsapp_guardian_telemetry_read
  ON public.whatsapp_guardian_telemetry
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT users.tenant_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

REVOKE ALL ON public.whatsapp_guardian_telemetry FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_guardian_telemetry TO authenticated;
GRANT ALL ON public.whatsapp_guardian_telemetry TO service_role;

-- Legacy queue quarantine: anything already pending and missing Guardian V3
-- evidence must not be sent after the baseline. New code paths are expected
-- to populate validation_status/final_guardian_decision before delivery.
UPDATE public.pending_outbound
SET
  failed_at = COALESCE(failed_at, statement_timestamp()),
  failed_reason = COALESCE(
    failed_reason,
    'blocked_missing_guardian_validation_baseline_20260721203000'
  ),
  validation_status = COALESCE(validation_status, 'BLOCKED'),
  validation_reason_code = COALESCE(
    validation_reason_code,
    'MISSING_GUARDIAN_VALIDATION'
  ),
  final_guardian_checked_at = COALESCE(
    final_guardian_checked_at,
    statement_timestamp()
  ),
  final_guardian_decision = COALESCE(final_guardian_decision, 'BLOCK')
WHERE
  sent_at IS NULL
  AND failed_at IS NULL
  AND (
    validation_status IS NULL
    OR guardian_config_version_id IS NULL
    OR final_guardian_decision IS NULL
  )
  AND created_at < statement_timestamp();

COMMIT;
