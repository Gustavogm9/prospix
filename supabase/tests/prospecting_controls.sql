-- Post-deploy, read-only regression gate for the controlled prospecting release.
BEGIN;

DO $$
DECLARE
  v_target_tenant UUID := '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::UUID;
  v_target_campaign UUID := 'e11fce13-79a9-41f9-afc0-e341a5ad7759'::UUID;
  v_qa_lead UUID := '1848688e-55e6-4093-a0a5-0e967452a398'::UUID;
  v_table TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'prospecting_runs', 'provider_usage_events', 'provider_cost_imports',
        'qualification_sessions', 'qualification_answers', 'campaign_qa_allowlist'
      )
      AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'PROSPECTING_RLS_DISABLED';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.begin_prospecting_run(uuid,uuid,uuid,text,text,text,integer,jsonb,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.import_provider_cost_rows(uuid,text,text,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PROSPECTING_PRIVILEGE_REGRESSION';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'prospecting_runs', 'provider_usage_events', 'provider_cost_imports',
    'qualification_sessions', 'qualification_answers', 'campaign_qa_allowlist'
  ] LOOP
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
      OR has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
      OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
      OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'PROSPECTING_TABLE_EXPOSED_TO_ANON: %', v_table;
    END IF;

    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
      OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
      OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'PROSPECTING_TABLE_WRITE_EXPOSED: %', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaigns
    WHERE id = v_target_campaign
      AND tenant_id = v_target_tenant
      AND status::TEXT = 'PAUSED'
      AND homologation_mode = true
      AND discovery_auto_enabled = false
      AND capture_sources = ARRAY['GOOGLE_MAPS']::TEXT[]
      AND active_script_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'TARGET_CAMPAIGN_NOT_CONTAINED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_ai_outbound_controls
    WHERE tenant_id = v_target_tenant AND paused = true
  ) THEN
    RAISE EXCEPTION 'TARGET_TENANT_OUTBOUND_NOT_PAUSED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaign_qa_allowlist
    WHERE campaign_id = v_target_campaign
      AND lead_id = v_qa_lead
      AND expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'AUTHORIZED_QA_LEAD_NOT_ALLOWLISTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.campaigns campaign
    JOIN public.scripts script ON script.id = campaign.active_script_id
    WHERE campaign.id = v_target_campaign
      AND script.qualification_config->>'framework' = 'METLIFE_PROTECTION_INCOME_V1'
      AND script.qualification_config->>'collect_health_data' = 'false'
  ) THEN
    RAISE EXCEPTION 'QUALIFICATION_CONFIG_NOT_ACTIVE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pending_outbound pending
    JOIN public.conversations conversation ON conversation.id = pending.conversation_id
    JOIN public.leads lead ON lead.id = conversation.lead_id
    WHERE lead.campaign_id = v_target_campaign
      AND pending.sent_at IS NULL
      AND pending.failed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'TARGET_CAMPAIGN_HAS_OPEN_PENDING_MESSAGES';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_definitions
    WHERE guardian_key = 'G09_QUALIFICATION'
      AND execution_stage = 'POST_GENERATION'
  ) THEN
    RAISE EXCEPTION 'G09_STAGE_MISMATCH';
  END IF;
END;
$$;

ROLLBACK;
