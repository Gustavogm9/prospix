-- Reconciles the auditable WhatsApp Guardian state timeline with the canonical
-- current-state table and prevents more than one open transition per tenant.

BEGIN;

LOCK TABLE public.whatsapp_guardian_state_transitions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.whatsapp_guardian_status IN SHARE ROW EXCLUSIVE MODE;

WITH status_snapshot AS (
  SELECT
    tenant_id,
    COALESCE(status::TEXT, 'NORMAL') AS status,
    external_state,
    COALESCE(state_reason_code, last_disconnect_reason_code, 'BASELINE_CURRENT_STATE') AS reason_code,
    COALESCE(state_source, 'reconciliation') AS source,
    COALESCE(state_entered_at, updated_at, created_at, now()) AS entered_at,
    updated_at,
    external_checked_at,
    quarantined_until,
    circuit_open_until
  FROM public.whatsapp_guardian_status
),
open_ranked AS (
  SELECT
    transitions.id,
    transitions.tenant_id,
    transitions.entered_at,
    snapshot.status AS current_status,
    snapshot.entered_at AS current_entered_at,
    (
      transitions.status = snapshot.status
      AND transitions.entered_at = snapshot.entered_at
    ) AS is_aligned,
    ROW_NUMBER() OVER (
      PARTITION BY
        transitions.tenant_id,
        (
          transitions.status = snapshot.status
          AND transitions.entered_at = snapshot.entered_at
        )
      ORDER BY transitions.entered_at DESC, transitions.created_at DESC, transitions.id
    ) AS aligned_rank
  FROM public.whatsapp_guardian_state_transitions transitions
  JOIN status_snapshot snapshot ON snapshot.tenant_id = transitions.tenant_id
  WHERE transitions.exited_at IS NULL
),
closed AS (
  UPDATE public.whatsapp_guardian_state_transitions transitions
  SET
    exited_at = CASE
      WHEN open_ranked.current_entered_at >= transitions.entered_at THEN open_ranked.current_entered_at
      ELSE now()
    END,
    duration_seconds = GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (
        CASE
          WHEN open_ranked.current_entered_at >= transitions.entered_at THEN open_ranked.current_entered_at
          ELSE now()
        END - transitions.entered_at
      )))::INTEGER
    ),
    metadata = COALESCE(transitions.metadata, '{}'::jsonb) || jsonb_build_object(
      'reconciled_by', '20260722215000_whatsapp_guardian_transition_reconciliation',
      'reconciled_at', now(),
      'canonical_status', open_ranked.current_status,
      'canonical_entered_at', open_ranked.current_entered_at
    )
  FROM open_ranked
  WHERE transitions.id = open_ranked.id
    AND NOT (open_ranked.is_aligned AND open_ranked.aligned_rank = 1)
  RETURNING transitions.tenant_id
),
status_snapshot_after_close AS (
  SELECT
    tenant_id,
    status,
    external_state,
    reason_code,
    source,
    entered_at,
    updated_at,
    external_checked_at,
    quarantined_until,
    circuit_open_until
  FROM status_snapshot
)
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
  snapshot.tenant_id,
  NULL,
  snapshot.status,
  snapshot.external_state,
  snapshot.reason_code,
  snapshot.source,
  CASE
    WHEN snapshot.status = 'SUSPENDED' THEN 'CRITICAL'
    WHEN snapshot.status IN ('PAUSED', 'COOLDOWN') THEN 'ATTENTION'
    WHEN snapshot.status IN ('COLD', 'RECOVERY', 'HIGH_LOAD') THEN 'OBSERVATION'
    ELSE 'INFO'
  END,
  CASE
    WHEN snapshot.status = 'SUSPENDED' THEN 'REQUIRES_ACTION'
    WHEN snapshot.status = 'PAUSED' THEN 'BLOCKED'
    WHEN snapshot.status IN ('COLD', 'RECOVERY', 'HIGH_LOAD', 'COOLDOWN') THEN 'THROTTLED'
    ELSE 'ACTIVE'
  END,
  CASE
    WHEN snapshot.status = 'SUSPENDED' THEN 'Numero sem autorizacao ou removido; envio bloqueado ate reconexao.'
    WHEN snapshot.status = 'PAUSED' THEN 'Conexao instavel ou fechada; envio pausado ate normalizacao.'
    WHEN snapshot.status = 'COLD' THEN 'Numero conectado em observacao; envio permitido com ritmo reduzido.'
    WHEN snapshot.status = 'RECOVERY' THEN 'Retomada segura apos reconexao; fila realinhada e cadencia controlada.'
    WHEN snapshot.status = 'HIGH_LOAD' THEN 'Volume alto; respostas priorizadas e novas prospeccoes reduzidas.'
    WHEN snapshot.status = 'COOLDOWN' THEN 'Numero em resfriamento; envio com intervalo maior e sem novas prospeccoes.'
    ELSE 'Numero operacional dentro das regras configuradas.'
  END,
  CASE WHEN snapshot.status IN ('PAUSED', 'SUSPENDED') THEN false ELSE true END,
  CASE WHEN snapshot.status IN ('PAUSED', 'SUSPENDED', 'HIGH_LOAD', 'COOLDOWN') THEN false ELSE true END,
  snapshot.entered_at,
  jsonb_build_object(
    'source', 'transition_reconciliation',
    'migration', '20260722215000_whatsapp_guardian_transition_reconciliation',
    'status_updated_at', snapshot.updated_at,
    'external_checked_at', snapshot.external_checked_at,
    'quarantined_until', snapshot.quarantined_until,
    'circuit_open_until', snapshot.circuit_open_until
  )
FROM status_snapshot_after_close snapshot
WHERE NOT EXISTS (
  SELECT 1
  FROM public.whatsapp_guardian_state_transitions transitions
  WHERE transitions.tenant_id = snapshot.tenant_id
    AND transitions.exited_at IS NULL
    AND transitions.status = snapshot.status
    AND transitions.entered_at = snapshot.entered_at
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_guardian_state_transitions_one_open_per_tenant_idx
  ON public.whatsapp_guardian_state_transitions (tenant_id)
  WHERE exited_at IS NULL;

COMMENT ON INDEX public.whatsapp_guardian_state_transitions_one_open_per_tenant_idx IS
  'Guarantees at most one currently open WhatsApp Guardian state transition per tenant.';

COMMIT;
