-- Guardian Engine V3 - Phase 6
-- Activates contact cadence, conversation lock, and wake-spread enforcement
-- through a new active config version. Previous active versions are archived instead of edited.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE INDEX IF NOT EXISTS pending_outbound_phase6_due_idx
  ON public.pending_outbound (tenant_id, scheduled_for, priority, created_at)
  WHERE sent_at IS NULL
    AND failed_at IS NULL
    AND attempts < 3;

CREATE INDEX IF NOT EXISTS pending_outbound_phase6_followup_idx
  ON public.pending_outbound (tenant_id, conversation_id, created_at)
  WHERE message_type = 'COMMERCIAL_FOLLOWUP'
    AND failed_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_phase6_outbound_contacts_idx
  ON public.messages (tenant_id, created_at DESC, conversation_id)
  WHERE direction = 'OUTBOUND';

CREATE OR REPLACE FUNCTION public.try_acquire_conversation_lock(
  p_conversation_id UUID,
  p_tenant_id UUID,
  p_lock_until TIMESTAMP WITH TIME ZONE,
  p_now TIMESTAMP WITH TIME ZONE DEFAULT now()
)
RETURNS TABLE(acquired BOOLEAN, current_lock_until TIMESTAMP WITH TIME ZONE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
     SET conversation_lock_until = p_lock_until
   WHERE id = p_conversation_id
     AND tenant_id = p_tenant_id
     AND (
       conversation_lock_until IS NULL
       OR conversation_lock_until < p_now
     )
  RETURNING conversation_lock_until INTO current_lock_until;

  IF FOUND THEN
    acquired := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT conversations.conversation_lock_until
    INTO current_lock_until
    FROM public.conversations
   WHERE id = p_conversation_id
     AND tenant_id = p_tenant_id;

  acquired := false;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_conversation_lock(UUID, UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_acquire_conversation_lock(UUID, UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE) TO service_role;

CREATE TEMP TABLE _guardian_phase6_required_modes (
  guardian_key TEXT PRIMARY KEY,
  enforced_mode TEXT NOT NULL CHECK (enforced_mode IN ('BLOCK', 'HARD_BLOCK'))
) ON COMMIT DROP;

INSERT INTO _guardian_phase6_required_modes (guardian_key, enforced_mode) VALUES
  ('G18_BUSINESS_HOURS', 'BLOCK'),
  ('G20_CONTACT_CADENCE', 'BLOCK'),
  ('G21_CONCURRENCY_LOCK', 'HARD_BLOCK');

CREATE TEMP TABLE _guardian_phase6_targets AS
SELECT
  active_versions.id AS old_config_version_id,
  active_versions.tenant_id,
  (
    SELECT COALESCE(MAX(version_number), 0) + 1
    FROM public.guardian_config_versions existing_versions
    WHERE existing_versions.tenant_id = active_versions.tenant_id
  ) AS new_version_number,
  gen_random_uuid() AS new_config_version_id
FROM public.guardian_config_versions active_versions
WHERE active_versions.status = 'ACTIVE'
  AND EXISTS (
    SELECT 1
    FROM _guardian_phase6_required_modes required_modes
    LEFT JOIN public.tenant_guardian_settings current_settings
      ON current_settings.config_version_id = active_versions.id
     AND current_settings.guardian_key = required_modes.guardian_key
    WHERE current_settings.id IS NULL
       OR current_settings.enabled IS DISTINCT FROM true
       OR current_settings.mode IS DISTINCT FROM required_modes.enforced_mode
  );

UPDATE public.guardian_config_versions versions
SET status = 'ARCHIVED',
    notes = COALESCE(versions.notes || E'\n', '') || 'Archived by Guardian Engine V3 Phase 6 cadence/lock/wake-spread migration.'
FROM _guardian_phase6_targets targets
WHERE versions.id = targets.old_config_version_id;

INSERT INTO public.guardian_config_versions (
  id,
  tenant_id,
  version_number,
  status,
  config_hash,
  created_by,
  activated_by,
  created_at,
  activated_at,
  notes
)
SELECT
  targets.new_config_version_id,
  targets.tenant_id,
  targets.new_version_number,
  'ACTIVE',
  'sha256:' || encode(
    digest(
      concat_ws(
        ':',
        'guardian-engine-v3-phase6',
        targets.tenant_id::text,
        targets.old_config_version_id::text,
        targets.new_version_number::text,
        'G18:BLOCK,G20:BLOCK,G21:HARD_BLOCK'
      ),
      'sha256'
    ),
    'hex'
  ),
  NULL,
  NULL,
  now(),
  now(),
  'Guardian Engine V3 Phase 6: G18 wake-spread, G20 contact cadence and G21 conversation lock activated.'
FROM _guardian_phase6_targets targets;

INSERT INTO public.tenant_guardian_settings (
  tenant_id,
  config_version_id,
  guardian_key,
  enabled,
  mode,
  fail_policy,
  sort_order,
  created_at,
  updated_at
)
SELECT
  targets.tenant_id,
  targets.new_config_version_id,
  old_settings.guardian_key,
  CASE WHEN required_modes.guardian_key IS NOT NULL THEN true ELSE old_settings.enabled END,
  COALESCE(required_modes.enforced_mode, old_settings.mode),
  old_settings.fail_policy,
  old_settings.sort_order,
  now(),
  now()
FROM _guardian_phase6_targets targets
JOIN public.tenant_guardian_settings old_settings
  ON old_settings.config_version_id = targets.old_config_version_id
LEFT JOIN _guardian_phase6_required_modes required_modes
  ON required_modes.guardian_key = old_settings.guardian_key;

INSERT INTO public.tenant_guardian_variable_values (
  tenant_id,
  config_version_id,
  guardian_key,
  variable_key,
  value,
  created_at,
  updated_at
)
SELECT
  targets.tenant_id,
  targets.new_config_version_id,
  old_values.guardian_key,
  old_values.variable_key,
  old_values.value,
  now(),
  now()
FROM _guardian_phase6_targets targets
JOIN public.tenant_guardian_variable_values old_values
  ON old_values.config_version_id = targets.old_config_version_id;

INSERT INTO public.guardian_admin_audit_log (
  tenant_id,
  actor_user_id,
  action,
  guardian_key,
  variable_key,
  old_value,
  new_value,
  config_version_id,
  reason,
  created_at
)
SELECT
  targets.tenant_id,
  NULL,
  'ACTIVATE_VERSION',
  NULL,
  NULL,
  jsonb_build_object('previous_config_version_id', targets.old_config_version_id),
  jsonb_build_object(
    'new_config_version_id', targets.new_config_version_id,
    'phase', 'PHASE_6_CADENCE_LOCK_WAKE_SPREAD',
    'enforced_guardians', jsonb_build_array(
      'G18_BUSINESS_HOURS',
      'G20_CONTACT_CADENCE',
      'G21_CONCURRENCY_LOCK'
    ),
    'modes', jsonb_build_object(
      'G18_BUSINESS_HOURS', 'BLOCK',
      'G20_CONTACT_CADENCE', 'BLOCK',
      'G21_CONCURRENCY_LOCK', 'HARD_BLOCK'
    )
  ),
  targets.new_config_version_id,
  'Guardian Engine V3 Phase 6 cadence, lock and wake-spread validators activated.',
  now()
FROM _guardian_phase6_targets targets;
