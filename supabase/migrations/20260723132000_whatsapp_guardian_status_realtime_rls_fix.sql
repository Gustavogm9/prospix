-- Fix tenant-scoped Realtime visibility for the WhatsApp operational panel.
-- The panel subscribes to postgres_changes on whatsapp_guardian_status; Supabase
-- Realtime applies SELECT RLS to decide whether authenticated clients receive
-- the event. Use the canonical helper functions already used by adjacent
-- WhatsApp observability tables instead of a direct users subquery.

BEGIN;

ALTER TABLE public.whatsapp_guardian_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_guardian_status_read
  ON public.whatsapp_guardian_status;

CREATE POLICY whatsapp_guardian_status_read
  ON public.whatsapp_guardian_status
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

REVOKE ALL ON public.whatsapp_guardian_status FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_guardian_status TO authenticated;
GRANT ALL ON public.whatsapp_guardian_status TO service_role;

COMMENT ON POLICY whatsapp_guardian_status_read
  ON public.whatsapp_guardian_status
  IS 'Allows authenticated tenant users and Guilds admins to read WhatsApp status so operational Realtime subscriptions can receive tenant-scoped updates.';

COMMIT;
