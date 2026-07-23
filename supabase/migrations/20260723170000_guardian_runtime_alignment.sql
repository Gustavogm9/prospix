-- Runtime alignment for Guardian Engine operational corrections.
-- - Enforce operational_alerts.dedup_key uniqueness when present.
-- - Disable legacy duplicate process-followups cron, keeping the canonical
--   process-followups job installed by 20260722201000.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'operational_alerts'
      AND column_name = 'dedup_key'
  ) THEN
    WITH duplicate_alerts AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY dedup_key
          ORDER BY COALESCE(resolved_at, 'infinity'::timestamptz) DESC, created_at DESC, id DESC
        ) AS duplicate_rank
      FROM public.operational_alerts
      WHERE dedup_key IS NOT NULL
    )
    UPDATE public.operational_alerts alerts
    SET
      resolved_at = COALESCE(alerts.resolved_at, now()),
      updated_at = now()
    FROM duplicate_alerts duplicates
    WHERE alerts.id = duplicates.id
      AND duplicates.duplicate_rank > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS operational_alerts_open_dedup_key_uidx
      ON public.operational_alerts (dedup_key)
      WHERE dedup_key IS NOT NULL
        AND resolved_at IS NULL;
  END IF;
END $$;

DO $$
DECLARE
  v_legacy_jobid INTEGER;
BEGIN
  SELECT jobid
  INTO v_legacy_jobid
  FROM cron.job
  WHERE jobname = 'process-followups-job'
  LIMIT 1;

  IF v_legacy_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_legacy_jobid);
  END IF;
END $$;

COMMENT ON INDEX public.operational_alerts_open_dedup_key_uidx IS
  'Prevents repeated open operational alerts for the same active operational condition while preserving resolved history.';
