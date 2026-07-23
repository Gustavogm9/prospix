-- Admin disconnect incidents.
-- Purpose: one admin WhatsApp alert per real disconnection incident, not per
-- repeated low-level connection event while the same incident remains open.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_disconnect_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reason_code TEXT NOT NULL,
  incident_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  first_connection_event_id UUID NULL REFERENCES public.whatsapp_connection_events(id) ON DELETE SET NULL,
  last_connection_event_id UUID NULL REFERENCES public.whatsapp_connection_events(id) ON DELETE SET NULL,
  operational_alert_id UUID NULL REFERENCES public.operational_alerts(id) ON DELETE SET NULL,
  first_external_state TEXT NULL,
  last_external_state TEXT NULL,
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  pending_due_count INTEGER NULL,
  alert_sent_at TIMESTAMP WITH TIME ZONE NULL,
  alert_send_attempts INTEGER NOT NULL DEFAULT 0,
  source TEXT NULL,
  last_error TEXT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE NULL,
  resolved_reason_code TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_disconnect_incidents_status_check
    CHECK (status IN ('OPEN', 'RESOLVED')),
  CONSTRAINT admin_disconnect_incidents_occurrence_count_check
    CHECK (occurrence_count >= 1),
  CONSTRAINT admin_disconnect_incidents_alert_attempts_check
    CHECK (alert_send_attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_disconnect_incidents_incident_key_uidx
  ON public.admin_disconnect_incidents (incident_key);

CREATE UNIQUE INDEX IF NOT EXISTS admin_disconnect_incidents_one_open_per_reason_idx
  ON public.admin_disconnect_incidents (tenant_id, reason_code)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS admin_disconnect_incidents_tenant_status_seen_idx
  ON public.admin_disconnect_incidents (tenant_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS admin_disconnect_incidents_status_seen_idx
  ON public.admin_disconnect_incidents (status, last_seen_at DESC);

ALTER TABLE public.admin_disconnect_alert_deliveries
  ADD COLUMN IF NOT EXISTS disconnect_incident_id UUID NULL
  REFERENCES public.admin_disconnect_incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS admin_disconnect_alert_deliveries_incident_id_idx
  ON public.admin_disconnect_alert_deliveries (disconnect_incident_id, recipient_id);

DROP TRIGGER IF EXISTS admin_disconnect_incidents_touch_updated_at
  ON public.admin_disconnect_incidents;
CREATE TRIGGER admin_disconnect_incidents_touch_updated_at
  BEFORE UPDATE ON public.admin_disconnect_incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.admin_monitoring_touch_updated_at();

INSERT INTO public.admin_disconnect_incidents (
  tenant_id,
  reason_code,
  incident_key,
  status,
  first_connection_event_id,
  last_connection_event_id,
  operational_alert_id,
  first_external_state,
  last_external_state,
  first_seen_at,
  last_seen_at,
  occurrence_count,
  pending_due_count,
  source
)
SELECT
  guardian.tenant_id,
  COALESCE(guardian.last_disconnect_reason_code, guardian.state_reason_code, 'WA_EXTERNAL_NOT_OPEN') AS reason_code,
  'disconnect_incident:' || gen_random_uuid()::TEXT AS incident_key,
  'OPEN',
  last_event.id,
  last_event.id,
  NULL,
  guardian.external_state,
  guardian.external_state,
  COALESCE(last_event.created_at, guardian.updated_at, now()),
  COALESCE(last_event.created_at, guardian.updated_at, now()),
  1,
  last_event.pending_due_count,
  'migration:20260723161000_admin_disconnect_incidents'
FROM public.whatsapp_guardian_status guardian
LEFT JOIN LATERAL (
  SELECT events.id, events.created_at, events.pending_due_count
  FROM public.whatsapp_connection_events events
  WHERE events.tenant_id = guardian.tenant_id
    AND events.reason_code = COALESCE(
      guardian.last_disconnect_reason_code,
      guardian.state_reason_code,
      events.reason_code
    )
  ORDER BY events.created_at DESC
  LIMIT 1
) last_event ON true
WHERE (
    guardian.status::TEXT IN ('SUSPENDED', 'PAUSED')
    OR (
      guardian.external_state IS NOT NULL
      AND lower(guardian.external_state) NOT IN ('open', 'connected')
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_disconnect_incidents existing
    WHERE existing.tenant_id = guardian.tenant_id
      AND existing.reason_code = COALESCE(
        guardian.last_disconnect_reason_code,
        guardian.state_reason_code,
        'WA_EXTERNAL_NOT_OPEN'
      )
      AND existing.status = 'OPEN'
  );

UPDATE public.admin_disconnect_incidents incidents
SET
  alert_sent_at = delivered.first_sent_at,
  alert_send_attempts = GREATEST(
    incidents.alert_send_attempts,
    delivered.sent_count
  ),
  updated_at = now()
FROM (
  SELECT
    tenant_id,
    reason_code,
    MIN(sent_at) AS first_sent_at,
    COUNT(*)::INTEGER AS sent_count
  FROM public.admin_disconnect_alert_deliveries
  WHERE status = 'SENT'
    AND sent_at IS NOT NULL
  GROUP BY tenant_id, reason_code
) delivered
WHERE incidents.status = 'OPEN'
  AND incidents.alert_sent_at IS NULL
  AND delivered.tenant_id = incidents.tenant_id
  AND delivered.reason_code = incidents.reason_code;

COMMENT ON TABLE public.admin_disconnect_incidents IS
  'Open/closed lifecycle for real WhatsApp disconnection incidents. Prevents repeated admin WhatsApp alerts for repeated low-level events in the same outage.';

COMMENT ON COLUMN public.admin_disconnect_incidents.incident_key IS
  'Stable per incident lifecycle. Alert deliveries dedupe on this value, not on repeated connection_event IDs.';

COMMENT ON COLUMN public.admin_disconnect_alert_deliveries.disconnect_incident_id IS
  'Canonical disconnection incident that produced this admin alert delivery.';

ALTER TABLE public.admin_disconnect_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_disconnect_incidents_admin_select
  ON public.admin_disconnect_incidents;
CREATE POLICY admin_disconnect_incidents_admin_select
  ON public.admin_disconnect_incidents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'GUILDS_ADMIN'
        AND u.deleted_at IS NULL
    )
  );

REVOKE ALL ON public.admin_disconnect_incidents FROM anon, authenticated;
GRANT SELECT ON public.admin_disconnect_incidents TO authenticated;
GRANT ALL ON public.admin_disconnect_incidents TO service_role;

COMMIT;
