-- Transactional Guardian admin helpers.
-- Additive only: the UI/API edits DRAFT versions and activates through a
-- single database transaction, never by mutating the ACTIVE config directly.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.guardian_create_draft_from_active(
  p_tenant_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_draft_id UUID;
  v_active_version RECORD;
  v_next_version INTEGER;
  v_new_version_id UUID;
  v_reason TEXT;
BEGIN
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'GUARDIAN_DRAFT_REASON_REQUIRED';
  END IF;

  SELECT id
  INTO v_existing_draft_id
  FROM public.guardian_config_versions
  WHERE tenant_id = p_tenant_id
    AND status = 'DRAFT'
  ORDER BY version_number DESC
  LIMIT 1;

  IF v_existing_draft_id IS NOT NULL THEN
    RETURN v_existing_draft_id;
  END IF;

  SELECT *
  INTO v_active_version
  FROM public.guardian_config_versions
  WHERE tenant_id = p_tenant_id
    AND status = 'ACTIVE'
  ORDER BY version_number DESC
  LIMIT 1;

  IF v_active_version.id IS NULL THEN
    RAISE EXCEPTION 'ACTIVE_GUARDIAN_CONFIG_NOT_FOUND';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.guardian_config_versions
  WHERE tenant_id = p_tenant_id;

  INSERT INTO public.guardian_config_versions (
    tenant_id,
    version_number,
    status,
    config_hash,
    created_by,
    notes
  )
  VALUES (
    p_tenant_id,
    v_next_version,
    'DRAFT',
    'sha256:' || encode(digest(
      p_tenant_id::TEXT || ':' || v_active_version.id::TEXT || ':' || clock_timestamp()::TEXT,
      'sha256'
    ), 'hex'),
    p_actor_user_id,
    v_reason
  )
  RETURNING id INTO v_new_version_id;

  INSERT INTO public.tenant_guardian_settings (
    tenant_id,
    config_version_id,
    guardian_key,
    enabled,
    mode,
    fail_policy,
    sort_order
  )
  SELECT
    tenant_id,
    v_new_version_id,
    guardian_key,
    enabled,
    mode,
    fail_policy,
    sort_order
  FROM public.tenant_guardian_settings
  WHERE tenant_id = p_tenant_id
    AND config_version_id = v_active_version.id;

  INSERT INTO public.tenant_guardian_variable_values (
    tenant_id,
    config_version_id,
    guardian_key,
    variable_key,
    value
  )
  SELECT
    tenant_id,
    v_new_version_id,
    guardian_key,
    variable_key,
    value
  FROM public.tenant_guardian_variable_values
  WHERE tenant_id = p_tenant_id
    AND config_version_id = v_active_version.id;

  INSERT INTO public.guardian_admin_audit_log (
    tenant_id,
    actor_user_id,
    action,
    config_version_id,
    reason,
    new_value
  )
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'CREATE_DRAFT',
    v_new_version_id,
    v_reason,
    jsonb_build_object(
      'from_active_version_id', v_active_version.id,
      'draft_version_id', v_new_version_id,
      'version_number', v_next_version
    )
  );

  RETURN v_new_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guardian_activate_draft_version(
  p_tenant_id UUID,
  p_config_version_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft_version RECORD;
  v_active_version RECORD;
  v_reason TEXT;
  v_last_change_at TIMESTAMPTZ;
  v_last_passed_validation_at TIMESTAMPTZ;
BEGIN
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL OR LENGTH(v_reason) < 10 THEN
    RAISE EXCEPTION 'GUARDIAN_ACTIVATION_REASON_REQUIRED';
  END IF;

  SELECT *
  INTO v_draft_version
  FROM public.guardian_config_versions
  WHERE id = p_config_version_id
    AND tenant_id = p_tenant_id
    AND status = 'DRAFT'
  FOR UPDATE;

  IF v_draft_version.id IS NULL THEN
    RAISE EXCEPTION 'DRAFT_GUARDIAN_CONFIG_NOT_FOUND';
  END IF;

  SELECT MAX(created_at)
  INTO v_last_change_at
  FROM public.guardian_admin_audit_log
  WHERE tenant_id = p_tenant_id
    AND config_version_id = p_config_version_id
    AND action IN ('CREATE_DRAFT', 'UPDATE_GUARDIAN', 'UPDATE_VARIABLE');

  SELECT MAX(created_at)
  INTO v_last_passed_validation_at
  FROM public.guardian_simulation_runs
  WHERE tenant_id = p_tenant_id
    AND config_version_id = p_config_version_id
    AND passed = true;

  IF v_last_passed_validation_at IS NULL
    OR (v_last_change_at IS NOT NULL AND v_last_passed_validation_at < v_last_change_at)
  THEN
    RAISE EXCEPTION 'DRAFT_REQUIRES_PASSED_VALIDATION';
  END IF;

  SELECT *
  INTO v_active_version
  FROM public.guardian_config_versions
  WHERE tenant_id = p_tenant_id
    AND status = 'ACTIVE'
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  IF v_active_version.id IS NOT NULL THEN
    UPDATE public.guardian_config_versions
    SET
      status = 'ARCHIVED',
      notes = concat_ws(E'\n', notes, 'Archived by admin activation of version ' || v_draft_version.version_number || '.')
    WHERE id = v_active_version.id;
  END IF;

  UPDATE public.guardian_config_versions
  SET
    status = 'ACTIVE',
    activated_by = p_actor_user_id,
    activated_at = now(),
    notes = concat_ws(E'\n', notes, 'Activated by admin: ' || v_reason)
  WHERE id = p_config_version_id;

  INSERT INTO public.guardian_admin_audit_log (
    tenant_id,
    actor_user_id,
    action,
    config_version_id,
    reason,
    old_value,
    new_value
  )
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'ACTIVATE_VERSION',
    p_config_version_id,
    v_reason,
    CASE
      WHEN v_active_version.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'active_version_id', v_active_version.id,
        'version_number', v_active_version.version_number
      )
    END,
    jsonb_build_object(
      'active_version_id', p_config_version_id,
      'version_number', v_draft_version.version_number,
      'validated_at', v_last_passed_validation_at
    )
  );

  RETURN p_config_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.guardian_create_draft_from_active(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardian_activate_draft_version(UUID, UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.guardian_create_draft_from_active(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.guardian_activate_draft_version(UUID, UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.guardian_create_draft_from_active(UUID, UUID, TEXT) IS
  'Creates a Guardian DRAFT config by copying the active version for safe admin editing.';

COMMENT ON FUNCTION public.guardian_activate_draft_version(UUID, UUID, UUID, TEXT) IS
  'Atomically archives the active Guardian config and activates a validated DRAFT version.';
