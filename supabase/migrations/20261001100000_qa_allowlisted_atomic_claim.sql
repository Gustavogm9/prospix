-- Keep the tenant-wide outbound kill switch active while allowing only an
-- explicit, unexpired QA allowlist row in an ACTIVE homologation campaign.

BEGIN;

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
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := statement_timestamp();
  v_owner TEXT := COALESCE(NULLIF(BTRIM(p_owner), ''), 'unknown-worker');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
  v_claim_ttl_seconds INTEGER := LEAST(GREATEST(COALESCE(p_claim_ttl_seconds, 1800), 30), 3600);
  v_claim_expires_at TIMESTAMP WITH TIME ZONE := v_now + make_interval(secs => v_claim_ttl_seconds);
  v_tenant_paused BOOLEAN := public.is_tenant_ai_outbound_paused(p_tenant_id);
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
      AND (
        NOT v_tenant_paused
        OR EXISTS (
          SELECT 1
          FROM public.conversations conversation
          JOIN public.leads lead
            ON lead.id = conversation.lead_id
           AND lead.tenant_id = conversation.tenant_id
          JOIN public.campaigns campaign
            ON campaign.id = lead.campaign_id
           AND campaign.tenant_id = lead.tenant_id
          JOIN public.campaign_qa_allowlist allowlist
            ON allowlist.campaign_id = campaign.id
           AND allowlist.lead_id = lead.id
          WHERE conversation.id = pending.conversation_id
            AND conversation.tenant_id = pending.tenant_id
            AND campaign.status::TEXT = 'ACTIVE'
            AND campaign.homologation_mode = true
            AND allowlist.expires_at > v_now
        )
      )
    ORDER BY pending.priority ASC, pending.scheduled_for ASC, pending.created_at ASC, pending.id ASC
    LIMIT v_limit
    FOR UPDATE OF pending SKIP LOCKED
  )
  UPDATE public.pending_outbound pending
  SET processing_owner = v_owner,
      processing_started_at = v_now,
      processing_expires_at = v_claim_expires_at
  FROM candidates
  WHERE pending.id = candidates.id
  RETURNING pending.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[])
  TO service_role;

COMMENT ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[]) IS
  'Atomically claims due outbound rows. A paused tenant permits only unexpired allowlisted leads in active homologation campaigns.';

COMMIT;
