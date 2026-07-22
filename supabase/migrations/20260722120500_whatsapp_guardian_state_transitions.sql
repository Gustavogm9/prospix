-- WhatsApp Guardian state transitions and current-state duration.
-- Additive only: preserves existing status/events behavior and adds an
-- auditable state timeline for user/admin monitoring.

BEGIN;

ALTER TABLE public.whatsapp_guardian_status
  ADD COLUMN IF NOT EXISTS state_entered_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS state_reason_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS state_source TEXT NULL;

UPDATE public.whatsapp_guardian_status
SET
  state_entered_at = COALESCE(state_entered_at, updated_at, created_at, now()),
  state_reason_code = COALESCE(state_reason_code, last_disconnect_reason_code),
  state_source = COALESCE(state_source, 'baseline')
WHERE state_entered_at IS NULL
   OR state_source IS NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_guardian_state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_event_id UUID NULL REFERENCES public.whatsapp_connection_events(id) ON DELETE SET NULL,
  previous_status TEXT NULL,
  status TEXT NOT NULL,
  external_state TEXT NULL,
  reason_code TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  impact_level TEXT NOT NULL DEFAULT 'INFO',
  operation_state TEXT NOT NULL DEFAULT 'ACTIVE',
  operator_summary TEXT NOT NULL,
  allow_send BOOLEAN NULL,
  allow_new_active BOOLEAN NULL,
  entered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  exited_at TIMESTAMP WITH TIME ZONE NULL,
  duration_seconds INTEGER NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_guardian_state_transitions_impact_check
    CHECK (impact_level IN ('INFO', 'OBSERVATION', 'ATTENTION', 'CRITICAL')),
  CONSTRAINT whatsapp_guardian_state_transitions_operation_check
    CHECK (operation_state IN ('ACTIVE', 'THROTTLED', 'BLOCKED', 'REQUIRES_ACTION')),
  CONSTRAINT whatsapp_guardian_state_transitions_duration_check
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT whatsapp_guardian_state_transitions_period_check
    CHECK (exited_at IS NULL OR exited_at >= entered_at)
);

CREATE INDEX IF NOT EXISTS whatsapp_guardian_state_transitions_tenant_entered_idx
  ON public.whatsapp_guardian_state_transitions (tenant_id, entered_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_guardian_state_transitions_open_idx
  ON public.whatsapp_guardian_state_transitions (tenant_id, status, entered_at DESC)
  WHERE exited_at IS NULL;

CREATE INDEX IF NOT EXISTS whatsapp_guardian_state_transitions_reason_idx
  ON public.whatsapp_guardian_state_transitions (reason_code, entered_at DESC);

INSERT INTO public.whatsapp_guardian_state_transitions (
  tenant_id,
  previous_status,
  status,
  external_state,
  reason_code,
  source,
  impact_level,
  operation_state,
  operator_summary,
  allow_send,
  allow_new_active,
  entered_at,
  metadata
)
SELECT
  s.tenant_id,
  NULL,
  COALESCE(s.status, 'NORMAL'),
  s.external_state,
  COALESCE(s.state_reason_code, s.last_disconnect_reason_code, 'BASELINE_CURRENT_STATE'),
  COALESCE(s.state_source, 'baseline'),
  CASE
    WHEN s.status = 'SUSPENDED' THEN 'CRITICAL'
    WHEN s.status = 'PAUSED' THEN 'ATTENTION'
    WHEN s.status = 'COOLDOWN' THEN 'ATTENTION'
    WHEN s.status IN ('COLD', 'HIGH_LOAD') THEN 'OBSERVATION'
    ELSE 'INFO'
  END,
  CASE
    WHEN s.status = 'SUSPENDED' THEN 'REQUIRES_ACTION'
    WHEN s.status = 'PAUSED' THEN 'BLOCKED'
    WHEN s.status IN ('COLD', 'HIGH_LOAD', 'COOLDOWN') THEN 'THROTTLED'
    ELSE 'ACTIVE'
  END,
  CASE
    WHEN s.status = 'SUSPENDED' THEN 'Numero sem autorizacao ou removido; envio bloqueado ate reconexao.'
    WHEN s.status = 'PAUSED' THEN 'Conexao instavel ou fechada; envio pausado ate normalizacao.'
    WHEN s.status = 'COLD' THEN 'Numero conectado em observacao; envio permitido com ritmo reduzido.'
    WHEN s.status = 'HIGH_LOAD' THEN 'Volume alto; respostas priorizadas e novas prospeccoes reduzidas.'
    WHEN s.status = 'COOLDOWN' THEN 'Numero em resfriamento; envio com intervalo maior e sem novas prospeccoes.'
    ELSE 'Numero operacional dentro das regras configuradas.'
  END,
  CASE WHEN s.status IN ('PAUSED', 'SUSPENDED') THEN false ELSE true END,
  CASE WHEN s.status IN ('PAUSED', 'SUSPENDED', 'HIGH_LOAD', 'COOLDOWN') THEN false ELSE true END,
  COALESCE(s.state_entered_at, s.updated_at, s.created_at, now()),
  jsonb_build_object(
    'source', 'migration_backfill',
    'status_updated_at', s.updated_at,
    'external_checked_at', s.external_checked_at,
    'quarantined_until', s.quarantined_until,
    'circuit_open_until', s.circuit_open_until
  )
FROM public.whatsapp_guardian_status s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.whatsapp_guardian_state_transitions t
  WHERE t.tenant_id = s.tenant_id
);

COMMENT ON TABLE public.whatsapp_guardian_state_transitions IS
  'Auditable timeline of WhatsApp Guardian state changes, including operator-friendly impact and duration data.';
COMMENT ON COLUMN public.whatsapp_guardian_status.state_entered_at IS
  'Timestamp when the current Guardian status effectively started; unlike updated_at, health checks should not move this timestamp unless the status changes.';

ALTER TABLE public.whatsapp_guardian_state_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_guardian_state_transitions_select
  ON public.whatsapp_guardian_state_transitions;
CREATE POLICY whatsapp_guardian_state_transitions_select
  ON public.whatsapp_guardian_state_transitions
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS whatsapp_guardian_state_transitions_insert_service
  ON public.whatsapp_guardian_state_transitions;
CREATE POLICY whatsapp_guardian_state_transitions_insert_service
  ON public.whatsapp_guardian_state_transitions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS whatsapp_guardian_state_transitions_update_service
  ON public.whatsapp_guardian_state_transitions;
CREATE POLICY whatsapp_guardian_state_transitions_update_service
  ON public.whatsapp_guardian_state_transitions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.whatsapp_guardian_state_transitions FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_guardian_state_transitions TO authenticated;
GRANT ALL ON public.whatsapp_guardian_state_transitions TO service_role;

COMMIT;
