-- Atomic claim support for AI outbound queue processing.
-- Prevents two workers from processing the same pending_outbound row while
-- allowing abandoned claims to expire automatically.

BEGIN;

ALTER TABLE public.pending_outbound
  ADD COLUMN IF NOT EXISTS processing_owner TEXT NULL,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS processing_expires_at TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS pending_outbound_processing_expires_idx
  ON public.pending_outbound (tenant_id, processing_expires_at)
  WHERE sent_at IS NULL
    AND failed_at IS NULL
    AND processing_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_outbound_atomic_claim_due_idx
  ON public.pending_outbound (tenant_id, scheduled_for, priority, created_at, id)
  WHERE sent_at IS NULL
    AND failed_at IS NULL
    AND attempts < 3;

CREATE OR REPLACE FUNCTION public.claim_due_pending_outbound(
  p_tenant_id UUID,
  p_owner TEXT,
  p_limit INTEGER DEFAULT 1,
  p_claim_ttl_seconds INTEGER DEFAULT 1800,
  p_excluded_conversation_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS SETOF public.pending_outbound
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := statement_timestamp();
  v_owner TEXT := COALESCE(NULLIF(BTRIM(p_owner), ''), 'unknown-worker');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
  v_claim_ttl_seconds INTEGER := LEAST(GREATEST(COALESCE(p_claim_ttl_seconds, 1800), 30), 3600);
  v_claim_expires_at TIMESTAMP WITH TIME ZONE := v_now + make_interval(secs => v_claim_ttl_seconds);
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT pending.id
    FROM public.pending_outbound pending
    WHERE pending.tenant_id = p_tenant_id
      AND pending.sent_at IS NULL
      AND pending.failed_at IS NULL
      AND pending.scheduled_for <= v_now
      AND pending.attempts < 3
      AND (
        pending.processing_expires_at IS NULL
        OR pending.processing_expires_at <= v_now
        OR pending.processing_owner = v_owner
      )
      AND (
        COALESCE(array_length(p_excluded_conversation_ids, 1), 0) = 0
        OR NOT pending.conversation_id = ANY(p_excluded_conversation_ids)
      )
    ORDER BY pending.priority ASC, pending.scheduled_for ASC, pending.created_at ASC, pending.id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.pending_outbound pending
  SET
    processing_owner = v_owner,
    processing_started_at = v_now,
    processing_expires_at = v_claim_expires_at
  FROM candidates
  WHERE pending.id = candidates.id
  RETURNING pending.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[]) TO service_role;

COMMENT ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[]) IS
  'Atomically claims due pending_outbound rows for a worker using FOR UPDATE SKIP LOCKED and expiring processing leases.';

COMMENT ON COLUMN public.pending_outbound.processing_owner IS
  'Opaque worker owner that currently holds the processing claim for this outbound queue row.';
COMMENT ON COLUMN public.pending_outbound.processing_started_at IS
  'Timestamp when the current processing claim was acquired.';
COMMENT ON COLUMN public.pending_outbound.processing_expires_at IS
  'Timestamp when the current processing claim expires and the row becomes claimable again.';

COMMIT;
