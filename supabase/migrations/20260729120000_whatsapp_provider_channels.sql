-- Provider-aware WhatsApp channels.
-- Adds WAHA coexistence without replacing the existing Evolution integration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('TENANT', 'ADMIN_MONITORING')),
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  admin_monitoring_channel_id UUID NULL REFERENCES public.admin_monitoring_channels(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('EVOLUTION', 'WAHA')),
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  api_key_encrypted TEXT NULL,
  webhook_secret TEXT NULL,
  send_enabled BOOLEAN NOT NULL DEFAULT true,
  receive_enabled BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  connection_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (connection_status IN ('UNKNOWN', 'PENDING_QR', 'CONNECTED', 'DISCONNECTED', 'ERROR')),
  external_state TEXT NULL,
  last_qr_requested_at TIMESTAMP WITH TIME ZONE NULL,
  connected_at TIMESTAMP WITH TIME ZONE NULL,
  disconnected_at TIMESTAMP WITH TIME ZONE NULL,
  last_checked_at TIMESTAMP WITH TIME ZONE NULL,
  last_error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_channels_owner_required CHECK (
    (owner_type = 'TENANT' AND tenant_id IS NOT NULL AND admin_monitoring_channel_id IS NULL)
    OR
    (owner_type = 'ADMIN_MONITORING' AND admin_monitoring_channel_id IS NOT NULL)
  ),
  CONSTRAINT whatsapp_channels_base_url_http CHECK (base_url ~* '^https?://'),
  CONSTRAINT whatsapp_channels_instance_name_safe CHECK (instance_name ~ '^[A-Za-z0-9_.:@-]{2,160}$')
);

CREATE INDEX IF NOT EXISTS whatsapp_channels_owner_idx
  ON public.whatsapp_channels (owner_type, tenant_id, active, send_enabled, receive_enabled);

CREATE INDEX IF NOT EXISTS whatsapp_channels_provider_instance_idx
  ON public.whatsapp_channels (provider, instance_name);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_one_active_sender_per_tenant_idx
  ON public.whatsapp_channels (tenant_id)
  WHERE owner_type = 'TENANT'
    AND active = true
    AND send_enabled = true;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_one_active_sender_per_admin_channel_idx
  ON public.whatsapp_channels (admin_monitoring_channel_id)
  WHERE owner_type = 'ADMIN_MONITORING'
    AND active = true
    AND send_enabled = true;

ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_channels_select ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_select
  ON public.whatsapp_channels
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS whatsapp_channels_service_role_all ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_service_role_all
  ON public.whatsapp_channels
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.whatsapp_channels TO authenticated;
GRANT ALL ON public.whatsapp_channels TO service_role;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT NULL CHECK (whatsapp_provider IN ('EVOLUTION', 'WAHA')),
  ADD COLUMN IF NOT EXISTS whatsapp_channel_id UUID NULL REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT NULL;

CREATE INDEX IF NOT EXISTS messages_whatsapp_channel_created_idx
  ON public.messages (whatsapp_channel_id, created_at DESC)
  WHERE whatsapp_channel_id IS NOT NULL;

ALTER TABLE public.pending_outbound
  ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT NULL CHECK (whatsapp_provider IN ('EVOLUTION', 'WAHA')),
  ADD COLUMN IF NOT EXISTS whatsapp_channel_id UUID NULL REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pending_outbound_whatsapp_channel_scheduled_idx
  ON public.pending_outbound (whatsapp_channel_id, scheduled_for ASC)
  WHERE sent_at IS NULL
    AND failed_at IS NULL
    AND whatsapp_channel_id IS NOT NULL;

ALTER TABLE public.whatsapp_connection_events
  ADD COLUMN IF NOT EXISTS provider TEXT NULL CHECK (provider IN ('EVOLUTION', 'WAHA')),
  ADD COLUMN IF NOT EXISTS whatsapp_channel_id UUID NULL REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS instance_name TEXT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_connection_events_provider_created_idx
  ON public.whatsapp_connection_events (provider, instance_name, created_at DESC)
  WHERE provider IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_processing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('EVOLUTION', 'WAHA')),
  event_name TEXT NOT NULL,
  instance_name TEXT NULL,
  provider_message_id TEXT NULL,
  provider_message_id_hash TEXT NULL,
  remote_jid_hash TEXT NULL,
  from_me BOOLEAN NULL,
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  conversation_id UUID NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACCEPTED'
    CHECK (status IN ('ACCEPTED', 'SKIPPED', 'PROCESSED', 'FAILED')),
  skip_reason TEXT NULL,
  error_message TEXT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  accepted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  processing_started_at TIMESTAMP WITH TIME ZONE NULL,
  processed_at TIMESTAMP WITH TIME ZONE NULL,
  failed_at TIMESTAMP WITH TIME ZONE NULL,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_webhook_processing_events_provider_msg_uidx
  ON public.whatsapp_webhook_processing_events (provider, event_name, instance_name, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_webhook_processing_events_tenant_created_idx
  ON public.whatsapp_webhook_processing_events (tenant_id, accepted_at DESC);

ALTER TABLE public.whatsapp_webhook_processing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_webhook_processing_events_select ON public.whatsapp_webhook_processing_events;
CREATE POLICY whatsapp_webhook_processing_events_select
  ON public.whatsapp_webhook_processing_events
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS whatsapp_webhook_processing_events_service_role_all ON public.whatsapp_webhook_processing_events;
CREATE POLICY whatsapp_webhook_processing_events_service_role_all
  ON public.whatsapp_webhook_processing_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.whatsapp_webhook_processing_events TO authenticated;
GRANT ALL ON public.whatsapp_webhook_processing_events TO service_role;

CREATE OR REPLACE FUNCTION public.touch_whatsapp_channels_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_whatsapp_channels_updated_at ON public.whatsapp_channels;
CREATE TRIGGER touch_whatsapp_channels_updated_at
  BEFORE UPDATE ON public.whatsapp_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_whatsapp_channels_updated_at();

CREATE OR REPLACE FUNCTION public.resolve_active_whatsapp_channel(p_tenant_id UUID)
RETURNS TABLE (
  id UUID,
  provider TEXT,
  label TEXT,
  base_url TEXT,
  instance_name TEXT,
  api_key_encrypted TEXT,
  send_enabled BOOLEAN,
  receive_enabled BOOLEAN,
  connection_status TEXT,
  external_state TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    channel.id,
    channel.provider,
    channel.label,
    channel.base_url,
    channel.instance_name,
    channel.api_key_encrypted,
    channel.send_enabled,
    channel.receive_enabled,
    channel.connection_status,
    channel.external_state
  FROM public.whatsapp_channels channel
  WHERE channel.owner_type = 'TENANT'
    AND channel.tenant_id = p_tenant_id
    AND channel.active = true
  ORDER BY channel.send_enabled DESC, channel.receive_enabled DESC, channel.updated_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_active_whatsapp_channel(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_active_whatsapp_channel(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_active_whatsapp_channel(UUID) TO service_role;

COMMENT ON TABLE public.whatsapp_channels IS
  'Provider-aware WhatsApp channels for tenant and admin-monitoring senders. Evolution remains supported while WAHA can coexist per channel.';
COMMENT ON TABLE public.whatsapp_webhook_processing_events IS
  'Provider-neutral webhook ledger for WAHA/Evolution processing and deduplication evidence.';
COMMENT ON FUNCTION public.resolve_active_whatsapp_channel(UUID) IS
  'Returns the active provider-aware WhatsApp channel for a tenant. If no row exists, legacy tenant_secrets fallback is handled by Edge Functions.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_channels;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
