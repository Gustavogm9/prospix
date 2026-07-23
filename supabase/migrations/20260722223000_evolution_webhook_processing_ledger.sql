-- Processing ledger and idempotency guard for Evolution messages.upsert webhooks.
-- This gives operators an auditable trail after the webhook returns a fast ACK
-- and prevents duplicate message rows for the same WhatsApp provider message id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.evolution_webhook_processing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  instance_name TEXT NULL,
  whatsapp_message_id TEXT NULL,
  whatsapp_message_id_hash TEXT NULL,
  remote_jid_hash TEXT NULL,
  from_me BOOLEAN NULL,
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  conversation_id UUID NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  skip_reason TEXT NULL,
  error_message TEXT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 1,
  accepted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMP WITH TIME ZONE NULL DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE NULL,
  failed_at TIMESTAMP WITH TIME ZONE NULL,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT evolution_webhook_processing_events_status_check
    CHECK (status IN ('PROCESSING', 'PROCESSED', 'SKIPPED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS evolution_webhook_processing_events_msg_uidx
  ON public.evolution_webhook_processing_events (event_name, instance_name, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evolution_webhook_processing_events_status_idx
  ON public.evolution_webhook_processing_events (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS evolution_webhook_processing_events_tenant_status_idx
  ON public.evolution_webhook_processing_events (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS evolution_webhook_processing_events_failed_idx
  ON public.evolution_webhook_processing_events (failed_at DESC)
  WHERE failed_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_whatsapp_message_id_uidx
  ON public.messages (tenant_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

ALTER TABLE public.evolution_webhook_processing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.evolution_webhook_processing_events FROM PUBLIC;
REVOKE ALL ON TABLE public.evolution_webhook_processing_events FROM anon;
REVOKE ALL ON TABLE public.evolution_webhook_processing_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evolution_webhook_processing_events TO service_role;

COMMENT ON TABLE public.evolution_webhook_processing_events IS
  'Restricted operational ledger for Evolution messages.upsert processing after fast ACK. Contains raw webhook payload for recovery; service-role only.';
COMMENT ON COLUMN public.evolution_webhook_processing_events.payload IS
  'Raw Evolution webhook payload retained for operational recovery/replay. Do not expose to tenant-facing clients.';
COMMENT ON INDEX public.messages_tenant_whatsapp_message_id_uidx IS
  'Prevents duplicate persisted messages when Evolution retries the same provider message id.';

COMMIT;
