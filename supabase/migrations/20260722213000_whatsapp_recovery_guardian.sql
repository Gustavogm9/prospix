-- Guardian G25 - WhatsApp recovery realignment.
-- Purpose: introduce a controlled RECOVERY state between COLD and NORMAL after reconnection.
-- The migration is idempotent and creates a new ACTIVE config version only for tenants
-- whose active Guardian config does not already include G25.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS pg_temp._guardian_recovery_targets;

INSERT INTO public.guardian_definitions (
  guardian_key,
  name,
  description,
  layer,
  execution_stage,
  function_scope,
  default_enabled,
  default_mode,
  fail_policy,
  is_system_critical,
  sort_order
) VALUES (
  'G25_WHATSAPP_RECOVERY_REALIGNMENT',
  'WhatsApp recovery realignment',
  'Moves a WhatsApp number from observation to a controlled recovery state after reconnection, realigns the queue, and only returns to normal after objective evidence.',
  'SEND',
  'CONNECTION_RECOVERY',
  'send-messages',
  true,
  'BLOCK',
  'FAIL_CLOSED',
  true,
  250
)
ON CONFLICT (guardian_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  layer = EXCLUDED.layer,
  execution_stage = EXCLUDED.execution_stage,
  function_scope = EXCLUDED.function_scope,
  default_enabled = EXCLUDED.default_enabled,
  default_mode = EXCLUDED.default_mode,
  fail_policy = EXCLUDED.fail_policy,
  is_system_critical = EXCLUDED.is_system_critical,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.guardian_variable_definitions (
  guardian_key,
  variable_key,
  label,
  description,
  value_type,
  default_value,
  min_value,
  max_value,
  allowed_values,
  validation_regex,
  unit,
  is_required,
  is_sensitive,
  requires_confirmation,
  requires_owner
) VALUES
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_min_duration_minutes',
    'Tempo minimo em retomada',
    'Tempo minimo em minutos que o numero deve permanecer em retomada segura antes de poder voltar ao estado operacional normal.',
    'integer',
    '120'::jsonb,
    0,
    1440,
    NULL,
    NULL,
    'minutos',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_min_successful_sends',
    'Envios bem-sucedidos para normalizar',
    'Quantidade minima de mensagens da IA enviadas com sucesso desde o inicio da retomada para permitir volta ao estado operacional normal.',
    'integer',
    '8'::jsonb,
    0,
    200,
    NULL,
    NULL,
    'envios',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_min_global_delay_seconds',
    'Intervalo minimo global',
    'Menor intervalo global permitido entre envios durante a retomada segura.',
    'duration_seconds',
    '18'::jsonb,
    0,
    3600,
    NULL,
    NULL,
    'segundos',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_base_delay_min_seconds',
    'Intervalo base minimo',
    'Menor intervalo aleatorio usado para espaçar mensagens durante a retomada segura.',
    'duration_seconds',
    '30'::jsonb,
    0,
    3600,
    NULL,
    NULL,
    'segundos',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_base_delay_max_seconds',
    'Intervalo base maximo',
    'Maior intervalo aleatorio usado para espaçar mensagens durante a retomada segura.',
    'duration_seconds',
    '90'::jsonb,
    0,
    7200,
    NULL,
    NULL,
    'segundos',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_max_messages_per_minute',
    'Limite por minuto',
    'Maximo de mensagens da IA por minuto enquanto o numero esta em retomada segura.',
    'integer',
    '2'::jsonb,
    0,
    60,
    NULL,
    NULL,
    'mensagens/minuto',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_max_messages_per_hour',
    'Limite por hora',
    'Maximo de mensagens da IA por hora enquanto o numero esta em retomada segura.',
    'integer',
    '60'::jsonb,
    0,
    1000,
    NULL,
    NULL,
    'mensagens/hora',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_max_new_chats_per_hour',
    'Novas conversas por hora',
    'Maximo de novas conversas iniciadas pela IA por hora durante a retomada segura.',
    'integer',
    '4'::jsonb,
    0,
    100,
    NULL,
    NULL,
    'conversas/hora',
    true,
    false,
    true,
    true
  ),
  (
    'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'recovery_max_new_chats_per_day',
    'Novas conversas por dia',
    'Maximo de novas conversas iniciadas pela IA por dia durante a retomada segura.',
    'integer',
    '30'::jsonb,
    0,
    1000,
    NULL,
    NULL,
    'conversas/dia',
    true,
    false,
    true,
    true
  )
ON CONFLICT (guardian_key, variable_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type,
  default_value = EXCLUDED.default_value,
  min_value = EXCLUDED.min_value,
  max_value = EXCLUDED.max_value,
  allowed_values = EXCLUDED.allowed_values,
  validation_regex = EXCLUDED.validation_regex,
  unit = EXCLUDED.unit,
  is_required = EXCLUDED.is_required,
  is_sensitive = EXCLUDED.is_sensitive,
  requires_confirmation = EXCLUDED.requires_confirmation,
  requires_owner = EXCLUDED.requires_owner,
  updated_at = now();

CREATE TEMP TABLE _guardian_recovery_targets AS
SELECT
  active_versions.id AS old_config_version_id,
  active_versions.tenant_id,
  (
    SELECT COALESCE(MAX(version_number), 0) + 1
    FROM public.guardian_config_versions existing_versions
    WHERE existing_versions.tenant_id = active_versions.tenant_id
  ) AS new_version_number,
  gen_random_uuid() AS new_config_version_id
FROM public.guardian_config_versions active_versions
WHERE active_versions.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM public.tenant_guardian_settings settings
    WHERE settings.config_version_id = active_versions.id
      AND settings.guardian_key = 'G25_WHATSAPP_RECOVERY_REALIGNMENT'
  );

UPDATE public.guardian_config_versions versions
SET status = 'ARCHIVED',
    notes = COALESCE(versions.notes || E'\n', '') || 'Archived by Guardian G25 WhatsApp recovery migration.'
FROM _guardian_recovery_targets targets
WHERE versions.id = targets.old_config_version_id;

INSERT INTO public.guardian_config_versions (
  id,
  tenant_id,
  version_number,
  status,
  config_hash,
  created_by,
  activated_by,
  created_at,
  activated_at,
  notes
)
SELECT
  targets.new_config_version_id,
  targets.tenant_id,
  targets.new_version_number,
  'ACTIVE',
  'md5:' || md5(concat_ws(
    ':',
    'guardian-g25-whatsapp-recovery',
    targets.tenant_id::text,
    targets.old_config_version_id::text,
    targets.new_version_number::text,
    'G25_WHATSAPP_RECOVERY_REALIGNMENT'
  )),
  NULL,
  NULL,
  now(),
  now(),
  'Guardian G25: WhatsApp recovery realignment activated.'
FROM _guardian_recovery_targets targets;

INSERT INTO public.tenant_guardian_settings (
  tenant_id,
  config_version_id,
  guardian_key,
  enabled,
  mode,
  fail_policy,
  sort_order,
  created_at,
  updated_at
)
SELECT
  targets.tenant_id,
  targets.new_config_version_id,
  old_settings.guardian_key,
  old_settings.enabled,
  old_settings.mode,
  old_settings.fail_policy,
  old_settings.sort_order,
  now(),
  now()
FROM _guardian_recovery_targets targets
JOIN public.tenant_guardian_settings old_settings
  ON old_settings.config_version_id = targets.old_config_version_id;

INSERT INTO public.tenant_guardian_settings (
  tenant_id,
  config_version_id,
  guardian_key,
  enabled,
  mode,
  fail_policy,
  sort_order,
  created_at,
  updated_at
)
SELECT
  targets.tenant_id,
  targets.new_config_version_id,
  'G25_WHATSAPP_RECOVERY_REALIGNMENT',
  true,
  'BLOCK',
  'FAIL_CLOSED',
  250,
  now(),
  now()
FROM _guardian_recovery_targets targets
ON CONFLICT (tenant_id, config_version_id, guardian_key) DO NOTHING;

INSERT INTO public.tenant_guardian_variable_values (
  tenant_id,
  config_version_id,
  guardian_key,
  variable_key,
  value,
  created_at,
  updated_at
)
SELECT
  targets.tenant_id,
  targets.new_config_version_id,
  old_values.guardian_key,
  old_values.variable_key,
  old_values.value,
  now(),
  now()
FROM _guardian_recovery_targets targets
JOIN public.tenant_guardian_variable_values old_values
  ON old_values.config_version_id = targets.old_config_version_id;

INSERT INTO public.tenant_guardian_variable_values (
  tenant_id,
  config_version_id,
  guardian_key,
  variable_key,
  value,
  created_at,
  updated_at
)
SELECT
  targets.tenant_id,
  targets.new_config_version_id,
  variable_defs.guardian_key,
  variable_defs.variable_key,
  variable_defs.default_value,
  now(),
  now()
FROM _guardian_recovery_targets targets
JOIN public.guardian_variable_definitions variable_defs
  ON variable_defs.guardian_key = 'G25_WHATSAPP_RECOVERY_REALIGNMENT'
ON CONFLICT (tenant_id, config_version_id, guardian_key, variable_key) DO NOTHING;

INSERT INTO public.guardian_admin_audit_log (
  tenant_id,
  actor_user_id,
  action,
  guardian_key,
  variable_key,
  old_value,
  new_value,
  config_version_id,
  reason,
  created_at
)
SELECT
  targets.tenant_id,
  NULL,
  'ACTIVATE_VERSION',
  'G25_WHATSAPP_RECOVERY_REALIGNMENT',
  NULL,
  jsonb_build_object('previous_config_version_id', targets.old_config_version_id),
  jsonb_build_object(
    'new_config_version_id', targets.new_config_version_id,
    'guardian', 'G25_WHATSAPP_RECOVERY_REALIGNMENT',
    'status_flow', jsonb_build_array('COLD', 'RECOVERY', 'NORMAL')
  ),
  targets.new_config_version_id,
  'Guardian G25 WhatsApp recovery realignment activated by migration.',
  now()
FROM _guardian_recovery_targets targets;

-- Keep DRAFT versions administrable without forcing activation.
INSERT INTO public.tenant_guardian_settings (
  tenant_id,
  config_version_id,
  guardian_key,
  enabled,
  mode,
  fail_policy,
  sort_order,
  created_at,
  updated_at
)
SELECT
  versions.tenant_id,
  versions.id,
  'G25_WHATSAPP_RECOVERY_REALIGNMENT',
  true,
  'BLOCK',
  'FAIL_CLOSED',
  250,
  now(),
  now()
FROM public.guardian_config_versions versions
WHERE versions.status = 'DRAFT'
ON CONFLICT (tenant_id, config_version_id, guardian_key) DO NOTHING;

INSERT INTO public.tenant_guardian_variable_values (
  tenant_id,
  config_version_id,
  guardian_key,
  variable_key,
  value,
  created_at,
  updated_at
)
SELECT
  versions.tenant_id,
  versions.id,
  variable_defs.guardian_key,
  variable_defs.variable_key,
  variable_defs.default_value,
  now(),
  now()
FROM public.guardian_config_versions versions
JOIN public.guardian_variable_definitions variable_defs
  ON variable_defs.guardian_key = 'G25_WHATSAPP_RECOVERY_REALIGNMENT'
WHERE versions.status IN ('ACTIVE', 'DRAFT')
ON CONFLICT (tenant_id, config_version_id, guardian_key, variable_key) DO NOTHING;

CREATE OR REPLACE VIEW public.ai_worker_operational_snapshot AS
WITH brt_window AS (
  SELECT
    (date_trunc('day', timezone('America/Sao_Paulo', now())) AT TIME ZONE 'America/Sao_Paulo') AS day_start_at,
    now() - interval '60 minutes' AS last_60m_at,
    now() - interval '24 hours' AS last_24h_at
),
tenant_scope AS (
  SELECT
    tenants.id AS tenant_id,
    tenants.name AS tenant_name,
    tenants.status::TEXT AS tenant_status
  FROM public.tenants
  WHERE tenants.deleted_at IS NULL
),
pending_agg AS (
  SELECT
    pending.tenant_id,
    COUNT(*) FILTER (
      WHERE pending.sent_at IS NULL
        AND pending.failed_at IS NULL
    )::INTEGER AS active_pending,
    COUNT(*) FILTER (
      WHERE pending.sent_at IS NULL
        AND pending.failed_at IS NULL
        AND pending.scheduled_for <= now()
    )::INTEGER AS due_pending,
    COUNT(*) FILTER (
      WHERE pending.sent_at IS NULL
        AND pending.failed_at IS NULL
        AND pending.validation_status = 'APPROVED'
    )::INTEGER AS approved_pending,
    COUNT(*) FILTER (
      WHERE pending.sent_at IS NULL
        AND pending.failed_at IS NULL
        AND pending.validation_status = 'DELAYED'
    )::INTEGER AS delayed_pending,
    COUNT(*) FILTER (
      WHERE (
          pending.failed_at >= brt_window.last_24h_at
          OR (
            pending.created_at >= brt_window.last_24h_at
            AND pending.validation_status IN ('BLOCKED', 'EXPIRED')
          )
        )
    )::INTEGER AS blocked_or_failed_last24h,
    MIN(pending.scheduled_for) FILTER (
      WHERE pending.sent_at IS NULL
        AND pending.failed_at IS NULL
    ) AS next_scheduled_for,
    MIN(pending.scheduled_for) FILTER (
      WHERE pending.sent_at IS NULL
        AND pending.failed_at IS NULL
        AND pending.scheduled_for <= now()
    ) AS oldest_due_at
  FROM public.pending_outbound pending
  CROSS JOIN brt_window
  GROUP BY pending.tenant_id
),
message_agg AS (
  SELECT
    messages.tenant_id,
    COUNT(*) FILTER (
      WHERE messages.direction::TEXT = 'OUTBOUND'
        AND messages.sender::TEXT = 'AI'
        AND messages.created_at >= brt_window.day_start_at
    )::INTEGER AS sent_today,
    COUNT(*) FILTER (
      WHERE messages.direction::TEXT = 'OUTBOUND'
        AND messages.sender::TEXT = 'AI'
        AND messages.created_at >= brt_window.last_60m_at
    )::INTEGER AS sent_last60m,
    MAX(messages.created_at) FILTER (
      WHERE messages.direction::TEXT = 'OUTBOUND'
        AND messages.sender::TEXT = 'AI'
    ) AS latest_ai_message_at,
    MAX(messages.created_at) FILTER (
      WHERE messages.direction::TEXT = 'INBOUND'
    ) AS latest_inbound_at
  FROM public.messages
  CROSS JOIN brt_window
  GROUP BY messages.tenant_id
),
latest_queue AS (
  SELECT DISTINCT ON (pending.tenant_id)
    pending.tenant_id,
    pending.id AS latest_queue_id,
    pending.message_type AS latest_queue_message_type,
    pending.created_at AS latest_queue_created_at,
    pending.scheduled_for AS latest_queue_scheduled_for,
    pending.sent_at AS latest_queue_sent_at,
    pending.failed_at AS latest_queue_failed_at,
    pending.failed_reason AS latest_queue_failed_reason,
    pending.validation_status AS latest_queue_validation_status,
    pending.validation_reason_code AS latest_queue_validation_reason_code,
    pending.final_guardian_decision AS latest_queue_final_guardian_decision,
    CASE
      WHEN pending.failed_at IS NOT NULL THEN 'FAILED'
      WHEN pending.sent_at IS NOT NULL THEN 'SENT'
      WHEN pending.scheduled_for <= now() THEN 'DUE'
      WHEN pending.validation_status = 'DELAYED' THEN 'DELAYED'
      WHEN pending.validation_status = 'BLOCKED' THEN 'BLOCKED'
      ELSE 'WAITING'
    END AS latest_queue_status
  FROM public.pending_outbound pending
  ORDER BY pending.tenant_id, pending.created_at DESC
),
retry_events AS (
  SELECT
    lead_events.tenant_id,
    MAX(lead_events.created_at) AS latest_retry_queued_at
  FROM public.lead_events
  WHERE lead_events.event_type = 'first_touch_retry_queued'
  GROUP BY lead_events.tenant_id
),
eligibility_agg AS (
  SELECT
    eligibility.tenant_id,
    COUNT(*) FILTER (WHERE eligibility.is_eligible_now)::INTEGER AS first_touch_eligible,
    COUNT(*)::INTEGER AS first_touch_evaluated
  FROM public.first_touch_lead_eligibility eligibility
  GROUP BY eligibility.tenant_id
),
guardian_context AS (
  SELECT
    guardian.tenant_id,
    guardian.status::TEXT AS guardian_status,
    guardian.external_state AS guardian_external_state,
    COALESCE(guardian.state_reason_code, guardian.last_disconnect_reason_code) AS guardian_reason_code,
    CASE
      WHEN guardian.status::TEXT = 'SUSPENDED' THEN 'REQUIRES_ACTION'
      WHEN guardian.status::TEXT = 'PAUSED' THEN 'BLOCKED'
      WHEN guardian.status::TEXT IN ('COLD', 'RECOVERY', 'HIGH_LOAD', 'COOLDOWN') THEN 'THROTTLED'
      ELSE 'ACTIVE'
    END AS guardian_operation_state,
    (
      guardian.status::TEXT IN ('SUSPENDED', 'PAUSED')
      OR (
        guardian.circuit_open_until IS NOT NULL
        AND guardian.circuit_open_until > now()
      )
    ) AS guardian_blocking_send,
    CASE
      WHEN guardian.status::TEXT = 'SUSPENDED' THEN 'WhatsApp desconectado ou sem autorizacao'
      WHEN guardian.status::TEXT = 'PAUSED' THEN 'WhatsApp instavel ou conectando'
      WHEN guardian.status::TEXT = 'COOLDOWN' THEN 'Numero em resfriamento operacional'
      WHEN guardian.status::TEXT = 'HIGH_LOAD' THEN 'Volume alto; novas prospeccoes reduzidas'
      WHEN guardian.status::TEXT = 'RECOVERY' THEN 'Retomada segura; fila realinhada e cadencia controlada'
      WHEN guardian.status::TEXT = 'COLD' THEN 'WhatsApp em observacao; cadencia reduzida'
      ELSE 'Sem bloqueio de conexao'
    END AS guardian_block_summary
  FROM public.whatsapp_guardian_status guardian
)
SELECT
  tenant_scope.tenant_id,
  tenant_scope.tenant_name,
  tenant_scope.tenant_status,
  now() AS generated_at,
  COALESCE(pending_agg.active_pending, 0) AS active_pending,
  COALESCE(pending_agg.due_pending, 0) AS due_pending,
  COALESCE(pending_agg.approved_pending, 0) AS approved_pending,
  COALESCE(pending_agg.delayed_pending, 0) AS delayed_pending,
  COALESCE(pending_agg.blocked_or_failed_last24h, 0) AS blocked_or_failed_last24h,
  pending_agg.next_scheduled_for,
  pending_agg.oldest_due_at,
  CASE
    WHEN pending_agg.oldest_due_at IS NULL THEN NULL
    ELSE FLOOR(EXTRACT(EPOCH FROM (now() - pending_agg.oldest_due_at)))::INTEGER
  END AS oldest_due_age_seconds,
  COALESCE(message_agg.sent_today, 0) AS sent_today,
  COALESCE(message_agg.sent_last60m, 0) AS sent_last60m,
  message_agg.latest_ai_message_at,
  message_agg.latest_inbound_at,
  retry_events.latest_retry_queued_at,
  COALESCE(eligibility_agg.first_touch_eligible, 0) AS first_touch_eligible,
  COALESCE(eligibility_agg.first_touch_evaluated, 0) AS first_touch_evaluated,
  latest_queue.latest_queue_id,
  latest_queue.latest_queue_message_type,
  latest_queue.latest_queue_status,
  latest_queue.latest_queue_created_at,
  latest_queue.latest_queue_scheduled_for,
  latest_queue.latest_queue_sent_at,
  latest_queue.latest_queue_failed_at,
  latest_queue.latest_queue_failed_reason,
  latest_queue.latest_queue_validation_status,
  latest_queue.latest_queue_validation_reason_code,
  latest_queue.latest_queue_final_guardian_decision,
  guardian_context.guardian_status,
  guardian_context.guardian_external_state,
  guardian_context.guardian_reason_code,
  COALESCE(guardian_context.guardian_operation_state, 'ACTIVE') AS guardian_operation_state,
  COALESCE(guardian_context.guardian_blocking_send, false) AS guardian_blocking_send,
  COALESCE(guardian_context.guardian_block_summary, 'Sem registro do Guardian') AS guardian_block_summary
FROM tenant_scope
LEFT JOIN pending_agg ON pending_agg.tenant_id = tenant_scope.tenant_id
LEFT JOIN message_agg ON message_agg.tenant_id = tenant_scope.tenant_id
LEFT JOIN latest_queue ON latest_queue.tenant_id = tenant_scope.tenant_id
LEFT JOIN retry_events ON retry_events.tenant_id = tenant_scope.tenant_id
LEFT JOIN eligibility_agg ON eligibility_agg.tenant_id = tenant_scope.tenant_id
LEFT JOIN guardian_context ON guardian_context.tenant_id = tenant_scope.tenant_id;

COMMENT ON VIEW public.ai_worker_operational_snapshot IS
  'Per-tenant operational snapshot showing AI sending execution and the current Guardian connection context, including RECOVERY state.';

GRANT SELECT ON public.ai_worker_operational_snapshot TO authenticated;
GRANT SELECT ON public.ai_worker_operational_snapshot TO service_role;
