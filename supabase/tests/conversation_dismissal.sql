-- Read-only post-migration smoke check. Run with a privileged SQL connection.
BEGIN READ ONLY;

DO $$
DECLARE
  v_missing_user uuid := gen_random_uuid();
BEGIN
  IF to_regprocedure('public.dismiss_conversation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_DISMISS_FUNCTION_MISSING';
  END IF;

  IF has_function_privilege('anon', 'public.dismiss_conversation(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.dismiss_conversation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CONVERSATION_DISMISS_GRANTS_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'removed_at'
  ) THEN
    RAISE EXCEPTION 'CONVERSATION_REMOVED_MARKER_MISSING';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.dismiss_conversation(gen_random_uuid());
    RAISE EXCEPTION 'ANONYMOUS_DISMISS_WAS_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_missing_user::text, true);
  BEGIN
    PERFORM public.dismiss_conversation(gen_random_uuid());
    RAISE EXCEPTION 'UNKNOWN_USER_DISMISS_WAS_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
