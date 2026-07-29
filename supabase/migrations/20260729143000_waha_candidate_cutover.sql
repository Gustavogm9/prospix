-- WAHA candidate cutover safety.
-- WAHA rows can exist as inactive candidates without replacing Evolution.

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
  WITH active_channel AS (
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
    LIMIT 1
  )
  SELECT * FROM active_channel
  UNION ALL
  SELECT
    NULL::uuid AS id,
    'EVOLUTION'::text AS provider,
    'Evolution legado'::text AS label,
    COALESCE(NULLIF(secret.evolution_base_url, ''), 'https://evolution-evolution-api.qr4jgl.easypanel.host')::text AS base_url,
    secret.evolution_instance_name::text AS instance_name,
    secret.evolution_api_key_encrypted::text AS api_key_encrypted,
    true AS send_enabled,
    true AS receive_enabled,
    'UNKNOWN'::text AS connection_status,
    NULL::text AS external_state
  FROM public.tenant_secrets secret
  WHERE secret.tenant_id = p_tenant_id
    AND NULLIF(secret.evolution_instance_name, '') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM active_channel)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.promote_whatsapp_channel_to_primary(
  p_tenant_id UUID,
  p_channel_id UUID,
  p_source TEXT DEFAULT 'app'
)
RETURNS TABLE (
  channel_id UUID,
  provider TEXT,
  instance_name TEXT,
  active BOOLEAN,
  send_enabled BOOLEAN,
  receive_enabled BOOLEAN,
  connection_status TEXT,
  external_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promoted_at TIMESTAMP WITH TIME ZONE := statement_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_channels channel
    WHERE channel.id = p_channel_id
      AND channel.tenant_id = p_tenant_id
      AND channel.owner_type = 'TENANT'
      AND channel.provider = 'WAHA'
  ) THEN
    RAISE EXCEPTION 'WAHA channel not found for tenant';
  END IF;

  UPDATE public.whatsapp_channels channel
  SET active = false,
      send_enabled = false,
      receive_enabled = false,
      updated_at = promoted_at,
      metadata = COALESCE(channel.metadata, '{}'::jsonb)
        || jsonb_build_object('deactivated_for_primary_cutover_at', promoted_at)
  WHERE channel.owner_type = 'TENANT'
    AND channel.tenant_id = p_tenant_id
    AND channel.id <> p_channel_id
    AND channel.active = true;

  RETURN QUERY
  UPDATE public.whatsapp_channels channel
  SET active = true,
      send_enabled = true,
      receive_enabled = true,
      connection_status = 'CONNECTED',
      external_state = 'WORKING',
      connected_at = COALESCE(channel.connected_at, promoted_at),
      disconnected_at = NULL,
      last_checked_at = promoted_at,
      last_error = NULL,
      updated_at = promoted_at,
      metadata = COALESCE(channel.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'role', 'primary',
          'promoted_at', promoted_at,
          'promoted_by', COALESCE(NULLIF(p_source, ''), 'app')
        )
  WHERE channel.id = p_channel_id
    AND channel.tenant_id = p_tenant_id
    AND channel.owner_type = 'TENANT'
    AND channel.provider = 'WAHA'
  RETURNING
    channel.id,
    channel.provider,
    channel.instance_name,
    channel.active,
    channel.send_enabled,
    channel.receive_enabled,
    channel.connection_status,
    channel.external_state;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_whatsapp_channel_to_primary(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_whatsapp_channel_to_primary(UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.resolve_active_whatsapp_channel(UUID) IS
  'Returns the active provider-aware WhatsApp channel for a tenant, falling back to legacy Evolution when no primary channel exists.';

COMMENT ON FUNCTION public.promote_whatsapp_channel_to_primary(UUID, UUID, TEXT) IS
  'Atomically promotes a validated WAHA channel to the tenant primary WhatsApp sender. The caller must verify WAHA WORKING before calling.';
