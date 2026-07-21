-- Admin monitoring architecture.
-- Additive only: creates admin report recipients, schedules, delivery logs,
-- and a claim function for due schedules. Existing tenant send flows are not
-- modified by this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_monitoring_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  report_enabled BOOLEAN NOT NULL DEFAULT true,
  disconnect_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NULL,
  created_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_monitoring_recipients_whatsapp_format
    CHECK (whatsapp ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_monitoring_recipients_whatsapp_key
  ON public.admin_monitoring_recipients (whatsapp);

CREATE INDEX IF NOT EXISTS admin_monitoring_recipients_active_idx
  ON public.admin_monitoring_recipients (active, report_enabled, disconnect_alerts_enabled);

CREATE TABLE IF NOT EXISTS public.admin_monitoring_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  recipient_id UUID NOT NULL REFERENCES public.admin_monitoring_recipients(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  window_minutes INTEGER NOT NULL DEFAULT 60,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  tenant_ids UUID[] NULL,
  include_numbers BOOLEAN NOT NULL DEFAULT true,
  include_recent_messages BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now() + interval '60 minutes',
  last_run_at TIMESTAMP WITH TIME ZONE NULL,
  last_success_at TIMESTAMP WITH TIME ZONE NULL,
  last_error TEXT NULL,
  created_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_monitoring_schedules_interval_range
    CHECK (interval_minutes BETWEEN 5 AND 1440),
  CONSTRAINT admin_monitoring_schedules_window_range
    CHECK (window_minutes BETWEEN 5 AND 10080)
);

CREATE INDEX IF NOT EXISTS admin_monitoring_schedules_due_idx
  ON public.admin_monitoring_schedules (active, next_run_at)
  WHERE active IS TRUE;

CREATE INDEX IF NOT EXISTS admin_monitoring_schedules_recipient_idx
  ON public.admin_monitoring_schedules (recipient_id, active);

CREATE TABLE IF NOT EXISTS public.admin_monitoring_report_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NULL REFERENCES public.admin_monitoring_schedules(id) ON DELETE SET NULL,
  recipient_id UUID NOT NULL REFERENCES public.admin_monitoring_recipients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_summary TEXT NULL,
  message_body TEXT NULL,
  whatsapp_message_id TEXT NULL,
  error TEXT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_monitoring_report_runs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT admin_monitoring_report_runs_period_check
    CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS admin_monitoring_report_runs_schedule_created_idx
  ON public.admin_monitoring_report_runs (schedule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_monitoring_report_runs_recipient_created_idx
  ON public.admin_monitoring_report_runs (recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_disconnect_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_event_id UUID NULL REFERENCES public.whatsapp_connection_events(id) ON DELETE SET NULL,
  operational_alert_id UUID NULL REFERENCES public.operational_alerts(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.admin_monitoring_recipients(id) ON DELETE CASCADE,
  incident_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason_code TEXT NOT NULL,
  external_state TEXT NULL,
  ai_summary TEXT NULL,
  message_body TEXT NULL,
  whatsapp_message_id TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_disconnect_alert_deliveries_status_check
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_disconnect_alert_deliveries_incident_recipient_key
  ON public.admin_disconnect_alert_deliveries (incident_key, recipient_id);

CREATE INDEX IF NOT EXISTS admin_disconnect_alert_deliveries_tenant_created_idx
  ON public.admin_disconnect_alert_deliveries (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_disconnect_alert_deliveries_status_created_idx
  ON public.admin_disconnect_alert_deliveries (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_monitoring_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_monitoring_recipients_touch_updated_at
  ON public.admin_monitoring_recipients;
CREATE TRIGGER admin_monitoring_recipients_touch_updated_at
  BEFORE UPDATE ON public.admin_monitoring_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.admin_monitoring_touch_updated_at();

DROP TRIGGER IF EXISTS admin_monitoring_schedules_touch_updated_at
  ON public.admin_monitoring_schedules;
CREATE TRIGGER admin_monitoring_schedules_touch_updated_at
  BEFORE UPDATE ON public.admin_monitoring_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.admin_monitoring_touch_updated_at();

DROP TRIGGER IF EXISTS admin_disconnect_alert_deliveries_touch_updated_at
  ON public.admin_disconnect_alert_deliveries;
CREATE TRIGGER admin_disconnect_alert_deliveries_touch_updated_at
  BEFORE UPDATE ON public.admin_disconnect_alert_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.admin_monitoring_touch_updated_at();

CREATE OR REPLACE FUNCTION public.claim_due_admin_monitoring_schedules(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.admin_monitoring_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.admin_monitoring_schedules
    WHERE active IS TRUE
      AND next_run_at <= now()
    ORDER BY next_run_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
  )
  UPDATE public.admin_monitoring_schedules s
  SET
    last_run_at = now(),
    next_run_at = now() + make_interval(mins => s.interval_minutes),
    last_error = NULL,
    updated_at = now()
  WHERE s.id IN (SELECT id FROM due)
  RETURNING s.*;
END;
$$;

COMMENT ON TABLE public.admin_monitoring_recipients IS
  'Admin-only WhatsApp recipients for operational reports and disconnect alerts.';

COMMENT ON TABLE public.admin_monitoring_schedules IS
  'Admin-configured periodic monitoring report schedules.';

COMMENT ON TABLE public.admin_monitoring_report_runs IS
  'Auditable generated monitoring report deliveries.';

COMMENT ON TABLE public.admin_disconnect_alert_deliveries IS
  'Auditable real-time WhatsApp disconnect alert deliveries per recipient.';

ALTER TABLE public.admin_monitoring_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_monitoring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_monitoring_report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_disconnect_alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_monitoring_recipients_admin_select
  ON public.admin_monitoring_recipients;
CREATE POLICY admin_monitoring_recipients_admin_select
  ON public.admin_monitoring_recipients
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

DROP POLICY IF EXISTS admin_monitoring_schedules_admin_select
  ON public.admin_monitoring_schedules;
CREATE POLICY admin_monitoring_schedules_admin_select
  ON public.admin_monitoring_schedules
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

DROP POLICY IF EXISTS admin_monitoring_report_runs_admin_select
  ON public.admin_monitoring_report_runs;
CREATE POLICY admin_monitoring_report_runs_admin_select
  ON public.admin_monitoring_report_runs
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

DROP POLICY IF EXISTS admin_disconnect_alert_deliveries_admin_select
  ON public.admin_disconnect_alert_deliveries;
CREATE POLICY admin_disconnect_alert_deliveries_admin_select
  ON public.admin_disconnect_alert_deliveries
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

REVOKE ALL ON public.admin_monitoring_recipients FROM anon, authenticated;
REVOKE ALL ON public.admin_monitoring_schedules FROM anon, authenticated;
REVOKE ALL ON public.admin_monitoring_report_runs FROM anon, authenticated;
REVOKE ALL ON public.admin_disconnect_alert_deliveries FROM anon, authenticated;

GRANT SELECT ON public.admin_monitoring_recipients TO authenticated;
GRANT SELECT ON public.admin_monitoring_schedules TO authenticated;
GRANT SELECT ON public.admin_monitoring_report_runs TO authenticated;
GRANT SELECT ON public.admin_disconnect_alert_deliveries TO authenticated;

GRANT ALL ON public.admin_monitoring_recipients TO service_role;
GRANT ALL ON public.admin_monitoring_schedules TO service_role;
GRANT ALL ON public.admin_monitoring_report_runs TO service_role;
GRANT ALL ON public.admin_disconnect_alert_deliveries TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_admin_monitoring_schedules(INTEGER) TO service_role;

COMMIT;
