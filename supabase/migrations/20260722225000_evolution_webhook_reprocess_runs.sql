-- Auditable selective reprocessing attempts for Evolution webhook ledger events.
-- The operation is intentionally explicit: every real replay must be approved
-- by an admin and tied to a concrete ledger row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.evolution_webhook_reprocess_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_event_id UUID NOT NULL REFERENCES public.evolution_webhook_processing_events(id) ON DELETE CASCADE,
  requested_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'admin-monitoring',
  dry_run BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT NOT NULL,
  previous_status TEXT NULL,
  previous_attempts INTEGER NULL,
  response_status INTEGER NULL,
  response_body_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT evolution_webhook_reprocess_runs_status_check
    CHECK (status IN ('PENDING', 'DRY_RUN', 'ACCEPTED', 'FAILED', 'SKIPPED')),
  CONSTRAINT evolution_webhook_reprocess_runs_reason_len
    CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500)
);

CREATE INDEX IF NOT EXISTS evolution_webhook_reprocess_runs_event_created_idx
  ON public.evolution_webhook_reprocess_runs (processing_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS evolution_webhook_reprocess_runs_status_created_idx
  ON public.evolution_webhook_reprocess_runs (status, created_at DESC);

ALTER TABLE public.evolution_webhook_reprocess_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.evolution_webhook_reprocess_runs FROM PUBLIC;
REVOKE ALL ON public.evolution_webhook_reprocess_runs FROM anon;
REVOKE ALL ON public.evolution_webhook_reprocess_runs FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.evolution_webhook_reprocess_runs TO service_role;

COMMENT ON TABLE public.evolution_webhook_reprocess_runs IS
  'Service-role audit table for selective Evolution webhook reprocessing attempts. Does not store raw webhook payload.';

COMMIT;
