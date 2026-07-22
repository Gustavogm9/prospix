-- Enable realtime change notifications for the tenant WhatsApp operational panel.
-- Additive/idempotent: only adds existing tables that are not already present
-- in the Supabase realtime publication.

BEGIN;

DO $$
DECLARE
  v_table REGCLASS;
  v_schema TEXT;
  v_name TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.whatsapp_guardian_status'::regclass,
    'public.whatsapp_connection_events'::regclass,
    'public.whatsapp_guardian_state_transitions'::regclass,
    'public.leads'::regclass,
    'public.conversations'::regclass,
    'public.messages'::regclass,
    'public.pending_outbound'::regclass
  ]
  LOOP
    SELECT n.nspname, c.relname
    INTO v_schema, v_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = v_table;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = v_schema
        AND tablename = v_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', v_table);
    END IF;
  END LOOP;
END;
$$;

COMMIT;
