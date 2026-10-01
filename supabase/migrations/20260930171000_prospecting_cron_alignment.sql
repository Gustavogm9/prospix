-- Align the automated funnel with the approved BRT window and add discovery.
-- Order is enforced by state: discovery creates CAPTURED leads, enrichment makes
-- them eligible, and sending only claims eligible rows from active campaigns.

BEGIN;

DO $$
DECLARE
  v_send_command TEXT;
  v_enrich_command TEXT;
  v_followup_command TEXT;
  v_matches TEXT[];
  v_bearer TEXT;
  v_send_url TEXT;
  v_discover_url TEXT;
  v_discover_command TEXT;
  v_job RECORD;
BEGIN
  SELECT command INTO v_send_command
  FROM cron.job
  WHERE jobname = 'send-messages'
  ORDER BY jobid DESC
  LIMIT 1;

  SELECT command INTO v_enrich_command
  FROM cron.job
  WHERE jobname = 'enrich-leads'
  ORDER BY jobid DESC
  LIMIT 1;

  SELECT command INTO v_followup_command
  FROM cron.job
  WHERE jobname = 'process-followups'
  ORDER BY jobid DESC
  LIMIT 1;

  IF v_send_command IS NULL OR v_enrich_command IS NULL OR v_followup_command IS NULL THEN
    RAISE EXCEPTION 'Cannot align prospecting cron: send, enrich or follow-up job is missing.';
  END IF;

  v_matches := regexp_match(v_send_command, '"Authorization"\s*:\s*"Bearer ([^"]+)"');
  IF v_matches IS NULL THEN
    RAISE EXCEPTION 'Cannot align prospecting cron: bearer token not found.';
  END IF;
  v_bearer := v_matches[1];

  v_matches := regexp_match(v_send_command, 'url\s*:=\s*''([^'']+)''');
  IF v_matches IS NULL THEN
    RAISE EXCEPTION 'Cannot align prospecting cron: function URL not found.';
  END IF;
  v_send_url := v_matches[1];
  v_discover_url := regexp_replace(
    v_send_url,
    '/functions/v1/[^/''\s]+$',
    '/functions/v1/discover-leads'
  );
  v_discover_command := format($cron$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Authorization', %L,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'auto_mode', true,
        'source', 'pg_cron:discover-leads'
      )
    );
  $cron$, v_discover_url, 'Bearer ' || v_bearer);

  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'send-messages', 'send-messages-saturday',
      'enrich-leads', 'enrich-leads-saturday',
      'process-followups', 'process-followups-saturday',
      'discover-leads-weekdays'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  -- 09:00-17:59 BRT, Monday-Friday. Sending is offset by two minutes
  -- so an enrichment tick at :00/:15/:30/:45 commits before the next send.
  PERFORM cron.schedule('send-messages', '2-57/5 12-20 * * 1-5', v_send_command);
  PERFORM cron.schedule('enrich-leads', '*/15 12-20 * * 1-5', v_enrich_command);
  PERFORM cron.schedule('process-followups', '25,55 12-20 * * 1-5', v_followup_command);

  -- 09:00-11:59 BRT, Saturday.
  PERFORM cron.schedule('send-messages-saturday', '2-57/5 12-14 * * 6', v_send_command);
  PERFORM cron.schedule('enrich-leads-saturday', '*/15 12-14 * * 6', v_enrich_command);
  PERFORM cron.schedule('process-followups-saturday', '25,55 12-14 * * 6', v_followup_command);

  -- Discovery starts once a day. Enrichment begins ten minutes later.
  PERFORM cron.schedule('discover-leads-weekdays', '5 12 * * 1-5', v_discover_command);
END;
$$;

COMMIT;
