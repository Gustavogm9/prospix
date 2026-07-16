-- WhatsApp connection guards and observability.
-- Additive only: no existing table, column, constraint, policy, or function is removed.

CREATE TABLE IF NOT EXISTS public.whatsapp_connection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_state TEXT NULL,
  reason_code TEXT NOT NULL,
  raw_error_redacted JSONB NULL,
  local_status_before TEXT NULL,
  local_status_after TEXT NULL,
  pending_due_count INTEGER NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_connection_events_tenant_created_idx
  ON public.whatsapp_connection_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_connection_events_reason_created_idx
  ON public.whatsapp_connection_events (reason_code, created_at DESC);

ALTER TABLE public.whatsapp_guardian_status
  ADD COLUMN IF NOT EXISTS external_state TEXT,
  ADD COLUMN IF NOT EXISTS external_checked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_disconnect_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS quarantined_until TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS circuit_open_until TIMESTAMP WITH TIME ZONE;

COMMENT ON TABLE public.whatsapp_connection_events IS
  'Structured audit log for WhatsApp/Evolution connection state changes and critical send guards.';

COMMENT ON COLUMN public.whatsapp_guardian_status.external_state IS
  'Last externally observed Evolution connection state, e.g. open, connecting, close.';

COMMENT ON COLUMN public.whatsapp_guardian_status.quarantined_until IS
  'When set in the future, active first-touch messages are delayed until this timestamp.';

ALTER TABLE public.whatsapp_connection_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connection_events_select ON public.whatsapp_connection_events;
DROP POLICY IF EXISTS whatsapp_connection_events_insert ON public.whatsapp_connection_events;

CREATE POLICY whatsapp_connection_events_select
  ON public.whatsapp_connection_events
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

CREATE POLICY whatsapp_connection_events_insert
  ON public.whatsapp_connection_events
  FOR INSERT TO service_role
  WITH CHECK (true);
