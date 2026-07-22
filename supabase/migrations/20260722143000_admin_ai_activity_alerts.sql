-- Admin AI activity alert deliveries.
-- Additive: separates AI operational SLA alerts from WhatsApp disconnect alerts
-- while reusing the same admin monitoring sender channel and recipients.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_ai_activity_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_alert_id UUID NULL REFERENCES public.operational_alerts(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.admin_monitoring_recipients(id) ON DELETE CASCADE,
  channel_id UUID NULL REFERENCES public.admin_monitoring_channels(id) ON DELETE SET NULL,
  incident_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  activity_state TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'ATTENTION',
  ai_summary TEXT NULL,
  message_body TEXT NULL,
  whatsapp_message_id TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_ai_activity_alert_deliveries_status_check
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT admin_ai_activity_alert_deliveries_state_check
    CHECK (activity_state IN ('STALLED', 'BLOCKED')),
  CONSTRAINT admin_ai_activity_alert_deliveries_severity_check
    CHECK (severity IN ('ATTENTION', 'CRITICAL'))
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_ai_activity_alert_deliveries_incident_recipient_key
  ON public.admin_ai_activity_alert_deliveries (incident_key, recipient_id);

CREATE INDEX IF NOT EXISTS admin_ai_activity_alert_deliveries_tenant_created_idx
  ON public.admin_ai_activity_alert_deliveries (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_ai_activity_alert_deliveries_status_created_idx
  ON public.admin_ai_activity_alert_deliveries (status, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_ai_activity_alert_deliveries_channel_created_idx
  ON public.admin_ai_activity_alert_deliveries (channel_id, created_at DESC);

DROP TRIGGER IF EXISTS admin_ai_activity_alert_deliveries_touch_updated_at
  ON public.admin_ai_activity_alert_deliveries;
CREATE TRIGGER admin_ai_activity_alert_deliveries_touch_updated_at
  BEFORE UPDATE ON public.admin_ai_activity_alert_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.admin_monitoring_touch_updated_at();

COMMENT ON TABLE public.admin_ai_activity_alert_deliveries IS
  'Auditable real-time admin deliveries for AI activity SLA alerts such as stalled queues or blocked operation.';

ALTER TABLE public.admin_ai_activity_alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_ai_activity_alert_deliveries_admin_select
  ON public.admin_ai_activity_alert_deliveries;
CREATE POLICY admin_ai_activity_alert_deliveries_admin_select
  ON public.admin_ai_activity_alert_deliveries
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

REVOKE ALL ON public.admin_ai_activity_alert_deliveries FROM anon, authenticated;
GRANT SELECT ON public.admin_ai_activity_alert_deliveries TO authenticated;
GRANT ALL ON public.admin_ai_activity_alert_deliveries TO service_role;

COMMIT;
