-- A conversation can leave the sales pipeline without losing its messages or audit trail.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS conversations_visible_tenant_recent_idx
  ON public.conversations (tenant_id, last_message_at DESC)
  WHERE removed_at IS NULL;

-- Tenant clients can update conversations through RLS, but changing the
-- removal marker must go through the audited function below.
CREATE OR REPLACE FUNCTION public.protect_conversation_removal_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND (NEW.removed_at IS DISTINCT FROM OLD.removed_at
       OR NEW.removed_by IS DISTINCT FROM OLD.removed_by) THEN
    RAISE EXCEPTION 'Use a ação de remoção da conversa.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_conversation_removal_marker ON public.conversations;
CREATE TRIGGER protect_conversation_removal_marker
  BEFORE UPDATE OF removed_at, removed_by ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.protect_conversation_removal_marker();

CREATE OR REPLACE FUNCTION public.dismiss_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_tenant_id uuid;
  v_lead_id uuid;
  v_removed_at timestamptz;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida.' USING ERRCODE = '42501';
  END IF;

  SELECT u.tenant_id INTO v_tenant_id
  FROM public.users AS u
  JOIN public.tenants AS t ON t.id = u.tenant_id
  WHERE u.id = v_actor_id
    AND u.deleted_at IS NULL
    AND u.role::text IN ('OWNER', 'ASSISTANT')
    AND t.status::text = 'ACTIVE'
    AND t.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Sem permissão para remover conversas.' USING ERRCODE = '42501';
  END IF;

  SELECT c.lead_id, c.removed_at INTO v_lead_id, v_removed_at
  FROM public.conversations AS c
  WHERE c.id = p_conversation_id AND c.tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent retry: preserve the first actor and audit event.
  IF v_removed_at IS NOT NULL THEN
    RETURN true;
  END IF;

  UPDATE public.conversations AS c
  SET removed_at = v_now,
      removed_by = v_actor_id,
      status = 'CLOSED',
      ai_handling = false,
      closed_at = COALESCE(c.closed_at, v_now)
  WHERE c.id = p_conversation_id AND c.tenant_id = v_tenant_id;

  UPDATE public.pending_outbound AS p
  SET failed_at = v_now,
      failed_reason = 'CONVERSATION_REMOVED',
      validation_status = 'BLOCKED',
      validation_reason_code = 'CONVERSATION_REMOVED',
      processing_owner = NULL,
      processing_started_at = NULL,
      processing_expires_at = NULL
  WHERE p.conversation_id = p_conversation_id
    AND p.tenant_id = v_tenant_id
    AND p.sent_at IS NULL
    AND p.failed_at IS NULL;

  INSERT INTO public.lead_events (tenant_id, lead_id, actor_id, event_type, payload, created_at)
  VALUES (
    v_tenant_id,
    v_lead_id,
    v_actor_id,
    'conversation_removed_from_pipeline',
    jsonb_build_object('conversation_id', p_conversation_id),
    v_now
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_conversation(uuid) TO authenticated;

COMMENT ON COLUMN public.conversations.removed_at IS
  'Hides the conversation from the sales pipeline; messages are retained for audit.';
COMMENT ON FUNCTION public.dismiss_conversation(uuid) IS
  'Tenant-scoped removal of one conversation, with pending AI sends canceled atomically.';

COMMIT;
