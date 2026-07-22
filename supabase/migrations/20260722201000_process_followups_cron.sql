-- Dedicated scheduler for commercial follow-ups.
-- Uses the same function host and bearer already configured for send-messages.

BEGIN;

DO $$
DECLARE
  v_send_command TEXT;
  v_matches TEXT[];
  v_bearer TEXT;
  v_send_url TEXT;
  v_followups_url TEXT;
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
    RAISE EXCEPTION 'Cannot create process-followups cron: send-messages cron job not found.';
  END IF;

  v_matches := regexp_match(v_send_command, '"Authorization"\s*:\s*"Bearer ([^"]+)"');
  IF v_matches IS NULL THEN
    RAISE EXCEPTION 'Cannot create process-followups cron: bearer token not found in send-messages cron job.';
  END IF;
  v_bearer := v_matches[1];

  v_matches := regexp_match(v_send_command, 'url\s*:=\s*''([^'']+)''');
  IF v_matches IS NULL THEN
    RAISE EXCEPTION 'Cannot create process-followups cron: send-messages function URL not found.';
  END IF;
  v_send_url := v_matches[1];
  v_followups_url := regexp_replace(
    v_send_url,
    '/functions/v1/[^/''\s]+$',
    '/functions/v1/process-followups'
  );

  v_command := format($cron$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Authorization', %L,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'source', 'pg_cron:process-followups'
      )
    );
  $cron$, v_followups_url, 'Bearer ' || v_bearer);

  SELECT jobid
  INTO v_existing_jobid
  FROM cron.job
  WHERE jobname = 'process-followups'
  LIMIT 1;

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'process-followups',
    '*/30 11-23 * * *',
    v_command
  );
END;
$$;

COMMIT;
