-- Canonical per-tenant snapshot for AI sending execution.
-- Additive only: no changes to sending rules, Guardian decisions, or credentials.

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
  latest_queue.latest_queue_final_guardian_decision
FROM tenant_scope
LEFT JOIN pending_agg ON pending_agg.tenant_id = tenant_scope.tenant_id
LEFT JOIN message_agg ON message_agg.tenant_id = tenant_scope.tenant_id
LEFT JOIN latest_queue ON latest_queue.tenant_id = tenant_scope.tenant_id
LEFT JOIN retry_events ON retry_events.tenant_id = tenant_scope.tenant_id
LEFT JOIN eligibility_agg ON eligibility_agg.tenant_id = tenant_scope.tenant_id;

COMMENT ON VIEW public.ai_worker_operational_snapshot IS
  'Per-tenant operational snapshot showing whether AI sending is idle, queued, overdue, sent, failed, or blocked. Used for operator-facing monitoring.';

GRANT SELECT ON public.ai_worker_operational_snapshot TO authenticated;
GRANT SELECT ON public.ai_worker_operational_snapshot TO service_role;
