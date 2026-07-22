-- Admin monitoring sender channel.
-- Additive only: creates an admin-owned WhatsApp sender connected by QR Code
-- and links report/alert deliveries to the sender channel used.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_monitoring_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL DEFAULT 'Canal administrativo',
  evolution_base_url TEXT NOT NULL,
  evolution_instance_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  connection_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  external_state TEXT NULL,
  last_qr_requested_at TIMESTAMP WITH TIME ZONE NULL,
  connected_at TIMESTAMP WITH TIME ZONE NULL,
  disconnected_at TIMESTAMP WITH TIME ZONE NULL,
  last_checked_at TIMESTAMP WITH TIME ZONE NULL,
  last_error TEXT NULL,
  created_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_monitoring_channels_base_url_check
    CHECK (evolution_base_url ~ '^https?://'),
  CONSTRAINT admin_monitoring_channels_instance_name_check
    CHECK (length(trim(evolution_instance_name)) BETWEEN 3 AND 80),
  CONSTRAINT admin_monitoring_channels_status_check
    CHECK (connection_status IN ('UNKNOWN', 'PENDING_QR', 'CONNECTED', 'DISCONNECTED', 'ERROR'))
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_monitoring_channels_one_active_idx
  ON public.admin_monitoring_channels ((active))
  WHERE active IS TRUE;

CREATE INDEX IF NOT EXISTS admin_monitoring_channels_status_idx
  ON public.admin_monitoring_channels (active, connection_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_monitoring_channel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.admin_monitoring_channels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  connection_status TEXT NULL,
  external_state TEXT NULL,
  error TEXT NULL,
  raw_response_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_monitoring_channel_events_status_check
    CHECK (
      connection_status IS NULL
      OR connection_status IN ('UNKNOWN', 'PENDING_QR', 'CONNECTED', 'DISCONNECTED', 'ERROR')
    )
);

CREATE INDEX IF NOT EXISTS admin_monitoring_channel_events_channel_created_idx
  ON public.admin_monitoring_channel_events (channel_id, created_at DESC);

ALTER TABLE public.admin_monitoring_report_runs
  ADD COLUMN IF NOT EXISTS channel_id UUID NULL;

ALTER TABLE public.admin_disconnect_alert_deliveries
  ADD COLUMN IF NOT EXISTS channel_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_monitoring_report_runs_channel_id_fkey'
      AND conrelid = 'public.admin_monitoring_report_runs'::regclass
  ) THEN
    ALTER TABLE public.admin_monitoring_report_runs
      ADD CONSTRAINT admin_monitoring_report_runs_channel_id_fkey
      FOREIGN KEY (channel_id)
      REFERENCES public.admin_monitoring_channels(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_disconnect_alert_deliveries_channel_id_fkey'
      AND conrelid = 'public.admin_disconnect_alert_deliveries'::regclass
  ) THEN
    ALTER TABLE public.admin_disconnect_alert_deliveries
      ADD CONSTRAINT admin_disconnect_alert_deliveries_channel_id_fkey
      FOREIGN KEY (channel_id)
      REFERENCES public.admin_monitoring_channels(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS admin_monitoring_report_runs_channel_created_idx
  ON public.admin_monitoring_report_runs (channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_disconnect_alert_deliveries_channel_created_idx
  ON public.admin_disconnect_alert_deliveries (channel_id, created_at DESC);

DROP TRIGGER IF EXISTS admin_monitoring_channels_touch_updated_at
  ON public.admin_monitoring_channels;
CREATE TRIGGER admin_monitoring_channels_touch_updated_at
  BEFORE UPDATE ON public.admin_monitoring_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.admin_monitoring_touch_updated_at();

COMMENT ON TABLE public.admin_monitoring_channels IS
  'Admin-owned WhatsApp sender channels used for monitoring reports and disconnect alerts.';

COMMENT ON TABLE public.admin_monitoring_channel_events IS
  'Audit trail for admin monitoring sender channel lifecycle and status checks.';

COMMENT ON COLUMN public.admin_monitoring_report_runs.channel_id IS
  'Admin monitoring sender channel used for this report delivery.';

COMMENT ON COLUMN public.admin_disconnect_alert_deliveries.channel_id IS
  'Admin monitoring sender channel used for this disconnect alert delivery.';

ALTER TABLE public.admin_monitoring_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_monitoring_channel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_monitoring_channels_admin_select
  ON public.admin_monitoring_channels;
CREATE POLICY admin_monitoring_channels_admin_select
  ON public.admin_monitoring_channels
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

DROP POLICY IF EXISTS admin_monitoring_channel_events_admin_select
  ON public.admin_monitoring_channel_events;
CREATE POLICY admin_monitoring_channel_events_admin_select
  ON public.admin_monitoring_channel_events
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

REVOKE ALL ON public.admin_monitoring_channels FROM anon, authenticated;
REVOKE ALL ON public.admin_monitoring_channel_events FROM anon, authenticated;

GRANT SELECT ON public.admin_monitoring_channels TO authenticated;
GRANT SELECT ON public.admin_monitoring_channel_events TO authenticated;

GRANT ALL ON public.admin_monitoring_channels TO service_role;
GRANT ALL ON public.admin_monitoring_channel_events TO service_role;

COMMIT;
