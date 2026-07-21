-- Guardian Engine V3 - Phase 5
-- Activates lead relevance, conversation state, prompt-injection, and semantic-scope gates
-- through a new active config version. Previous active versions are archived instead of edited.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE _guardian_phase5_required_modes (
  guardian_key TEXT PRIMARY KEY,
  enforced_mode TEXT NOT NULL CHECK (enforced_mode IN ('BLOCK', 'HARD_BLOCK'))
) ON COMMIT DROP;

INSERT INTO _guardian_phase5_required_modes (guardian_key, enforced_mode) VALUES
  ('G02_LEAD_RELEVANCE', 'BLOCK'),
  ('G05_CONVERSATION_STATE', 'BLOCK'),
  ('G15_PROMPT_INJECTION', 'BLOCK'),
  ('G16_SEMANTIC_SCOPE', 'BLOCK');

CREATE TEMP TABLE _guardian_phase5_targets AS
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
    FROM _guardian_phase5_required_modes required_modes
    LEFT JOIN public.tenant_guardian_settings current_settings
      ON current_settings.config_version_id = active_versions.id
     AND current_settings.guardian_key = required_modes.guardian_key
    WHERE current_settings.id IS NULL
       OR current_settings.enabled IS DISTINCT FROM true
       OR current_settings.mode IS DISTINCT FROM required_modes.enforced_mode
  );

UPDATE public.guardian_config_versions versions
SET status = 'ARCHIVED',
    notes = COALESCE(versions.notes || E'\n', '') || 'Archived by Guardian Engine V3 Phase 5 relevance/state/semantic migration.'
FROM _guardian_phase5_targets targets
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
        'guardian-engine-v3-phase5',
        targets.tenant_id::text,
        targets.old_config_version_id::text,
        targets.new_version_number::text,
        'G02,G05,G15,G16:BLOCK'
      ),
      'sha256'
    ),
    'hex'
  ),
  NULL,
  NULL,
  now(),
  now(),
  'Guardian Engine V3 Phase 5: G02, G05, G15 and G16 activated in BLOCK.'
FROM _guardian_phase5_targets targets;

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
FROM _guardian_phase5_targets targets
JOIN public.tenant_guardian_settings old_settings
  ON old_settings.config_version_id = targets.old_config_version_id
LEFT JOIN _guardian_phase5_required_modes required_modes
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
FROM _guardian_phase5_targets targets
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
    'phase', 'PHASE_5_RELEVANCE_STATE_SEMANTIC',
    'enforced_guardians', jsonb_build_array(
      'G02_LEAD_RELEVANCE',
      'G05_CONVERSATION_STATE',
      'G15_PROMPT_INJECTION',
      'G16_SEMANTIC_SCOPE'
    ),
    'mode', 'BLOCK'
  ),
  targets.new_config_version_id,
  'Guardian Engine V3 Phase 5 relevance, state and semantic validators activated.',
  now()
FROM _guardian_phase5_targets targets;
