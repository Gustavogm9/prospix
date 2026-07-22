-- Dedicated admin monitoring scheduler.
-- Additive: gives admin monitoring its own 24/7 pg_cron trigger and records
-- dispatcher executions even when no schedule is due.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_monitoring_dispatcher_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL DEFAULT 'due',
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  claimed_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_monitoring_dispatcher_runs_status_check
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'COMPLETED_WITH_FAILURES', 'FAILED')),
  CONSTRAINT admin_monitoring_dispatcher_runs_counts_check
    CHECK (
      claimed_count >= 0
      AND sent_count >= 0
      AND failed_count >= 0
      AND skipped_count >= 0
    )
);

CREATE INDEX IF NOT EXISTS admin_monitoring_dispatcher_runs_created_idx
  ON public.admin_monitoring_dispatcher_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_monitoring_dispatcher_runs_status_created_idx
  ON public.admin_monitoring_dispatcher_runs (status, created_at DESC);

COMMENT ON TABLE public.admin_monitoring_dispatcher_runs IS
  'Auditable runs of the admin monitoring dispatcher, including zero-claim scheduler checks.';

ALTER TABLE public.admin_monitoring_dispatcher_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_monitoring_dispatcher_runs_admin_select
  ON public.admin_monitoring_dispatcher_runs;
CREATE POLICY admin_monitoring_dispatcher_runs_admin_select
  ON public.admin_monitoring_dispatcher_runs
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

REVOKE ALL ON public.admin_monitoring_dispatcher_runs FROM anon, authenticated;
GRANT SELECT ON public.admin_monitoring_dispatcher_runs TO authenticated;
GRANT ALL ON public.admin_monitoring_dispatcher_runs TO service_role;

DO $$
DECLARE
  v_send_command TEXT;
  v_matches TEXT[];
  v_bearer TEXT;
  v_send_url TEXT;
  v_dispatcher_url TEXT;
  v_command TEXT;
  v_existing_jobid BIGINT;
BEGIN
  SELECT command
  INTO v_send_command
  FROM cron.job
  WHERE jobname = 'send-messages'
  ORDER BY jobid DESC
  LIMIT 1;

  IF v_send_command IS NULL THEN
    RAISE EXCEPTION 'Cannot create admin-monitoring-due: send-messages cron job not found.';
  END IF;

  v_matches := regexp_match(v_send_command, '"Authorization"\s*:\s*"Bearer ([^"]+)"');
  IF v_matches IS NULL THEN
    RAISE EXCEPTION 'Cannot create admin-monitoring-due: bearer token not found in send-messages cron job.';
  END IF;
  v_bearer := v_matches[1];

  v_matches := regexp_match(v_send_command, 'url\s*:=\s*''([^'']+)''');
  IF v_matches IS NULL THEN
    RAISE EXCEPTION 'Cannot create admin-monitoring-due: send-messages function URL not found.';
  END IF;
  v_send_url := v_matches[1];
  v_dispatcher_url := regexp_replace(
    v_send_url,
    '/functions/v1/[^/''\s]+$',
    '/functions/v1/admin-monitoring-dispatcher'
  );

  v_command := format($cron$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Authorization', %L,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'mode', 'due',
        'limit', 10,
        'source', 'pg_cron:admin-monitoring-due'
      )
    );
  $cron$, v_dispatcher_url, 'Bearer ' || v_bearer);

  SELECT jobid
  INTO v_existing_jobid
  FROM cron.job
  WHERE jobname = 'admin-monitoring-due'
  LIMIT 1;

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'admin-monitoring-due',
    '*/5 * * * *',
    v_command
  );
END;
$$;

COMMIT;
