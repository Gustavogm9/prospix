-- Standalone PostgreSQL fixture for the dismissal migration; run in a disposable database:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/conversation_dismissal_fixture.sql
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  deleted_at timestamptz
);
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id),
  role text NOT NULL,
  deleted_at timestamptz
);
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  lead_id uuid NOT NULL,
  status text NOT NULL,
  ai_handling boolean NOT NULL,
  closed_at timestamptz,
  last_message_at timestamptz
);
GRANT UPDATE ON public.conversations TO authenticated;
CREATE TABLE public.pending_outbound (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  sent_at timestamptz,
  failed_at timestamptz,
  failed_reason text,
  validation_status text,
  validation_reason_code text,
  processing_owner text,
  processing_started_at timestamptz,
  processing_expires_at timestamptz
);
CREATE TABLE public.lead_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  actor_id uuid,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL
);

INSERT INTO public.tenants (id, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ACTIVE');
INSERT INTO public.users (id, tenant_id, role, deleted_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'OWNER', NULL),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'OWNER', NULL),
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ASSISTANT', now());
INSERT INTO public.conversations (id, tenant_id, lead_id, status, ai_handling, last_message_at) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000011', 'ACTIVE', true, now()),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-4000-8000-000000000011', 'ACTIVE', true, now());
INSERT INTO public.pending_outbound (id, tenant_id, conversation_id, sent_at) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', NULL),
  ('aaaaaaaa-0000-4000-8000-000000000022', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', now()),
  ('bbbbbbbb-0000-4000-8000-000000000021', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-4000-8000-000000000001', NULL);

\ir ../migrations/20261110110000_conversation_dismissal.sql

DO $$ BEGIN
  IF has_function_privilege('anon', 'public.dismiss_conversation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ANON_HAS_DISMISS_PERMISSION';
  END IF;
END $$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  BEGIN
    UPDATE public.conversations SET removed_at = now()
    WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'DIRECT_REMOVAL_MARKER_UPDATE_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.dismiss_conversation('aaaaaaaa-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'CROSS_TENANT_REMOVAL_ALLOWED';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
END $$;

SET request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ BEGIN
  BEGIN
    PERFORM public.dismiss_conversation('aaaaaaaa-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'DISABLED_USER_REMOVAL_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SELECT public.dismiss_conversation('aaaaaaaa-0000-4000-8000-000000000001');
SELECT public.dismiss_conversation('aaaaaaaa-0000-4000-8000-000000000001');
RESET ROLE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'
      AND removed_at IS NOT NULL
      AND removed_by = '11111111-1111-4111-8111-111111111111'
      AND status = 'CLOSED' AND ai_handling = false
  ) THEN RAISE EXCEPTION 'CONVERSATION_NOT_CLOSED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pending_outbound
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000021'
      AND failed_at IS NOT NULL AND failed_reason = 'CONVERSATION_REMOVED'
  ) THEN RAISE EXCEPTION 'PENDING_MESSAGE_NOT_CANCELED'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.pending_outbound
    WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000022', 'bbbbbbbb-0000-4000-8000-000000000021')
      AND failed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'OTHER_QUEUE_ITEM_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.lead_events WHERE event_type = 'conversation_removed_from_pipeline') <> 1 THEN
    RAISE EXCEPTION 'AUDIT_NOT_IDEMPOTENT';
  END IF;
END $$;
