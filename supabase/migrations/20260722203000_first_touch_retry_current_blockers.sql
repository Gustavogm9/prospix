-- First-touch recovery current-blocker classification.
-- Recreates the retry wrapper so recoverable historical failures expose the
-- current real blocker instead of masking it as a past send failure.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_recoverable_first_touch_failure(
  p_failed_reason TEXT,
  p_validation_reason_code TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized AS (
    SELECT
      lower(COALESCE(p_failed_reason, '')) AS reason,
      upper(COALESCE(p_validation_reason_code, '')) AS reason_code
  )
  SELECT
    (
      reason_code IN (
        'MISSING_GUARDIAN_VALIDATION',
        'WA_CONNECTION_CLOSED',
        'WA_DEVICE_REMOVED',
        'WA_CONFIG_MISSING',
        'WA_TRANSIENT_SEND_FAILURE'
      )
      OR reason LIKE '%connection closed%'
      OR reason LIKE '%blocked_missing_guardian_validation_baseline%'
      OR reason LIKE '%limites de envio excedidos%'
      OR reason LIKE '%cannot read properties%'
      OR reason LIKE '%evolution api key%'
      OR reason LIKE '%wa_device_removed%'
      OR reason LIKE '%wa_connection_closed%'
      OR reason LIKE '%wa_config_missing%'
    )
    AND reason NOT LIKE '%"exists":false%'
    AND reason NOT LIKE '%bad request%'
    AND reason NOT LIKE '%invalid number%'
    AND reason NOT LIKE '%no whatsapp%'
  FROM normalized;
$$;

DO $$
BEGIN
  IF to_regclass('public.first_touch_lead_eligibility_base_20260722') IS NULL THEN
    IF to_regclass('public.first_touch_lead_eligibility') IS NULL THEN
      RAISE EXCEPTION 'first_touch_lead_eligibility view is required before first-touch retry recovery.';
    END IF;

    ALTER VIEW public.first_touch_lead_eligibility
      RENAME TO first_touch_lead_eligibility_base_20260722;
  ELSE
    DROP VIEW IF EXISTS public.first_touch_lead_eligibility;
  END IF;
END;
$$;

CREATE VIEW public.first_touch_lead_eligibility AS
WITH evaluated AS (
  SELECT
    base.*,
    COALESCE(retry.recoverable_failed_count, 0) AS recoverable_failed_count,
    COALESCE(retry.terminal_failed_count, 0) AS terminal_failed_count,
    retry.last_recoverable_failed_at,
    CASE
      WHEN base.eligibility_reason <> 'FIRST_TOUCH_FAILED' THEN base.eligibility_reason
      WHEN COALESCE(retry.terminal_failed_count, 0) > 0 THEN 'FIRST_TOUCH_FAILED'
      WHEN COALESCE(retry.recoverable_failed_count, 0) >= 3 THEN 'FIRST_TOUCH_RETRY_LIMIT_REACHED'
      WHEN COALESCE(retry.recoverable_failed_count, 0) > 0
        AND retry.last_recoverable_failed_at > now() - INTERVAL '30 minutes'
        THEN 'FIRST_TOUCH_RETRY_COOLDOWN'
      WHEN COALESCE(retry.recoverable_failed_count, 0) > 0
        AND COALESCE(retry.terminal_failed_count, 0) = 0
        AND COALESCE(retry.recoverable_failed_count, 0) < 3
        AND base.has_whatsapp IS NOT TRUE
        THEN 'MISSING_WHATSAPP'
      WHEN COALESCE(retry.recoverable_failed_count, 0) > 0
        AND COALESCE(retry.terminal_failed_count, 0) = 0
        AND COALESCE(retry.recoverable_failed_count, 0) < 3
        AND (
          base.has_mobile_whatsapp_shape IS NOT TRUE
          OR COALESCE(base.whatsapp_valid, TRUE) IS NOT TRUE
          OR COALESCE(base.phone_validation_status::TEXT, '') IN (
            'FIXED_LINE',
            'INVALID',
            'INVALID_NUMBER',
            'LANDLINE',
            'NO_WHATSAPP',
            'NOT_MOBILE',
            'OPTED_OUT',
            'UNREACHABLE'
          )
        )
        THEN 'INVALID_MOBILE'
      WHEN COALESCE(retry.recoverable_failed_count, 0) > 0
        AND COALESCE(retry.terminal_failed_count, 0) = 0
        AND COALESCE(retry.recoverable_failed_count, 0) < 3
        AND base.would_block_by_g02_relevance IS TRUE
        THEN 'GUARDIAN_RELEVANCE_BLOCK'
      WHEN COALESCE(retry.recoverable_failed_count, 0) > 0
        AND base.lead_status = 'ENRICHED'
        AND base.contacted_at IS NULL
        AND base.has_sent_first_touch_queue IS FALSE
        AND base.has_active_first_touch_queue IS FALSE
        AND base.has_prior_guardian_block IS FALSE
        AND base.has_whatsapp IS TRUE
        AND base.has_mobile_whatsapp_shape IS TRUE
        AND COALESCE(base.whatsapp_valid, TRUE) IS TRUE
        AND COALESCE(base.has_optout, FALSE) IS FALSE
        AND COALESCE(base.phone_validation_status::TEXT, '') NOT IN (
          'FIXED_LINE',
          'INVALID',
          'INVALID_NUMBER',
          'LANDLINE',
          'NO_WHATSAPP',
          'NOT_MOBILE',
          'OPTED_OUT',
          'UNREACHABLE'
        )
        AND base.campaign_status = 'ACTIVE'
        AND base.current_brt_hour >= base.campaign_hour_window_start
        AND base.current_brt_hour < base.campaign_hour_window_end
        AND base.tenant_ai_outbound_today < base.campaign_daily_limit
        AND base.script_id IS NOT NULL
        AND base.script_status = 'ACTIVE'
        AND base.script_category = 'APPROACH'
        AND (
          base.script_target_profession IS NULL
          OR base.campaign_profession IS NULL
          OR base.script_target_profession = base.campaign_profession
        )
        AND base.active_variation_count > 0
        AND base.would_block_by_g02_relevance IS NOT TRUE
        AND base.commercial_name_for_individual_script IS NOT TRUE
        THEN 'ELIGIBLE'
      ELSE base.eligibility_reason
    END AS recovered_eligibility_reason
  FROM public.first_touch_lead_eligibility_base_20260722 base
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (
        WHERE public.is_recoverable_first_touch_failure(
          pending.failed_reason,
          pending.validation_reason_code
        )
      )::INTEGER AS recoverable_failed_count,
      COUNT(*) FILTER (
        WHERE NOT public.is_recoverable_first_touch_failure(
          pending.failed_reason,
          pending.validation_reason_code
        )
      )::INTEGER AS terminal_failed_count,
      MAX(pending.failed_at) FILTER (
        WHERE public.is_recoverable_first_touch_failure(
          pending.failed_reason,
          pending.validation_reason_code
        )
      ) AS last_recoverable_failed_at
    FROM public.conversations conversations
    JOIN public.pending_outbound pending
      ON pending.conversation_id = conversations.id
    WHERE conversations.tenant_id = base.tenant_id
      AND conversations.lead_id = base.lead_id
      AND pending.message_type = 'OUTBOUND_START'
      AND pending.sent_at IS NULL
      AND pending.failed_at IS NOT NULL
  ) retry ON TRUE
)
SELECT
  tenant_id,
  lead_id,
  campaign_id,
  campaign_name,
  campaign_status,
  campaign_profession,
  script_id,
  script_name,
  script_status,
  script_category,
  script_target_profession,
  script_selection_source,
  lead_status,
  lead_source,
  created_at,
  updated_at,
  deleted_at,
  contacted_at,
  queued_first_touch_at,
  has_whatsapp,
  whatsapp_digits,
  has_mobile_whatsapp_shape,
  whatsapp_valid,
  phone_validation_status,
  phone_validation_confidence,
  relevance_status,
  relevance_score,
  fit_score,
  normalized_relevance_score,
  normalized_fit_score,
  entity_type,
  identity_confidence,
  active_variation_count,
  tenant_ai_outbound_today,
  campaign_daily_limit,
  current_brt_hour,
  campaign_hour_window_start,
  campaign_hour_window_end,
  has_optout,
  has_active_first_touch_queue,
  has_failed_first_touch_queue,
  has_sent_first_touch_queue,
  has_prior_guardian_block,
  would_block_by_g02_relevance,
  commercial_name_for_individual_script,
  recovered_eligibility_reason AS eligibility_reason,
  recovered_eligibility_reason = 'ELIGIBLE' AS is_eligible_now
FROM evaluated;

COMMENT ON VIEW public.first_touch_lead_eligibility IS
  'Canonical first-touch eligibility with safe retry recovery for recoverable historical send failures.';

COMMENT ON VIEW public.first_touch_lead_eligibility_base_20260722 IS
  'Base first-touch eligibility view preserved before retry recovery wrapper.';

COMMENT ON FUNCTION public.is_recoverable_first_touch_failure(TEXT, TEXT) IS
  'Classifies historical first-touch failures that can safely be retried after full current eligibility checks.';

GRANT SELECT ON public.first_touch_lead_eligibility TO authenticated;

COMMIT;
