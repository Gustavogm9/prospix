-- Authorized correction: this is a new customer, not another owner of the QA tenant.
-- Creates one empty workspace and changes only this user's membership/profile.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $separate$
DECLARE
 v_user uuid := '2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9';
 v_old uuid := '6de57a0c-f8f5-4990-b9c3-87a83d95e75d';
 v_new uuid := 'dda78e66-575f-45d4-b136-4d7ad5dc4de7';
 v_table record;
 v_count bigint;
 v_old_counts jsonb := '{}'::jsonb;
 v_old_after jsonb := '{}'::jsonb;
 v_other_owners jsonb;
 v_profile public.users%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('prospix-new-client-gustavo-macedo-2026-11-25',0));
 IF (SELECT count(*) FROM public.users u WHERE lower(u.email)='gustavo.macedo@guilds.com.br')<>1
    OR (SELECT count(*) FROM auth.users a WHERE lower(a.email)='gustavo.macedo@guilds.com.br')<>1
    OR NOT EXISTS(SELECT 1 FROM auth.users a WHERE a.id=v_user AND lower(a.email)='gustavo.macedo@guilds.com.br' AND a.email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'ACCOUNT_IDENTITY_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_user AND u.tenant_id=v_new AND u.role::text='OWNER' AND u.deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_new AND t.slug='gustavo-macedo' AND t.deleted_at IS NULL)
 THEN RETURN; END IF;
 SELECT u.* INTO v_profile FROM public.users u WHERE u.id=v_user AND lower(u.email)='gustavo.macedo@guilds.com.br'
   AND u.tenant_id=v_old AND u.role::text='OWNER' AND u.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXPECTED_OLD_MEMBERSHIP_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_old AND t.name='Corretora de Teste' AND t.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'SOURCE_TENANT_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_new OR t.slug='gustavo-macedo')
 THEN RAISE EXCEPTION 'NEW_TENANT_COLLISION'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',u.id,'role',u.role,'tenant_id',u.tenant_id) ORDER BY u.id) INTO v_other_owners
 FROM public.users u WHERE u.tenant_id=v_old AND u.id<>v_user;

 FOR v_table IN
   SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.atttypid='uuid'::regtype AND c.relname<>'users'
 LOOP
   EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',v_table.table_name) INTO v_count USING v_old;
   v_old_counts:=v_old_counts||jsonb_build_object(v_table.table_name,v_count);
 END LOOP;

 INSERT INTO public.tenants(id,name,slug,segment,status,plan,mrr_cents,updated_at)
 VALUES(v_new,'Gustavo Macedo','gustavo-macedo','insurance_other','ONBOARDING','STANDARD',0,now());
 INSERT INTO public.tenant_secrets(tenant_id,updated_at) VALUES(v_new,now());
 INSERT INTO public.tenant_ai_configs(tenant_id,updated_at) VALUES(v_new,now());
 INSERT INTO public.tenant_ai_outbound_controls(tenant_id,paused,paused_at,paused_by,pause_reason,updated_at)
 VALUES(v_new,true,now(),'authorized-account-correction','Conta nova aguardando configuração inicial',now());

 UPDATE public.users u SET tenant_id=v_new,name='Gustavo Macedo',whatsapp='',city=NULL,susep=NULL,
   avatar_url=NULL,bio=NULL,partner_brand=NULL,partner_code=NULL,preferences='{}'::jsonb,last_login_at=NULL,updated_at=now()
 WHERE u.id=v_user AND u.tenant_id=v_old AND u.role::text='OWNER' AND u.deleted_at IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION 'UNEXPECTED_MEMBERSHIP_UPDATE_COUNT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_user AND u.password_hash IS NOT DISTINCT FROM v_profile.password_hash AND u.email=v_profile.email)
 THEN RAISE EXCEPTION 'UNEXPECTED_IDENTITY_OR_PASSWORD_CHANGE'; END IF;
 IF v_other_owners IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('id',u.id,'role',u.role,'tenant_id',u.tenant_id) ORDER BY u.id) FROM public.users u WHERE u.tenant_id=v_old AND u.id<>v_user)
 THEN RAISE EXCEPTION 'OTHER_MEMBERSHIPS_CHANGED'; END IF;

 INSERT INTO public.audit_log(action,target_type,target_id,tenant_id,payload)
 VALUES('user.new_customer_workspace_created','user',v_user::text,v_new,
   jsonb_build_object('operation','2026-11-25-separate-new-client','previous_tenant_id',v_old,'new_tenant_id',v_new,'no_business_data_copied',true));

 FOR v_table IN
   SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped
   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.atttypid='uuid'::regtype AND c.relname<>'users'
 LOOP
   EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',v_table.table_name) INTO v_count USING v_old;
   v_old_after:=v_old_after||jsonb_build_object(v_table.table_name,v_count);
   EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',v_table.table_name) INTO v_count USING v_new;
   IF v_table.table_name NOT IN ('tenant_secrets','tenant_ai_configs','tenant_ai_outbound_controls','audit_log') AND v_count<>0
   THEN RAISE EXCEPTION 'NEW_WORKSPACE_NOT_EMPTY: %',v_table.table_name; END IF;
 END LOOP;
 IF v_old_counts IS DISTINCT FROM v_old_after THEN RAISE EXCEPTION 'SOURCE_BUSINESS_DATA_CHANGED'; END IF;
END;
$separate$;

SELECT set_config('ops.fixture_admin_id',(SELECT min(u.id::text) FROM public.users u JOIN auth.users a ON a.id=u.id AND lower(a.email)=lower(u.email) WHERE u.role::text='GUILDS_ADMIN' AND u.deleted_at IS NULL),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9',true);
SELECT set_config('request.jwt.claims','{"sub":"2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9","role":"authenticated","app_metadata":{"role":"OWNER","tenant_id":"dda78e66-575f-45d4-b136-4d7ad5dc4de7"}}',true);
DO $permissions$
BEGIN
 IF (SELECT count(*) FROM public.users u WHERE u.id=auth.uid() AND u.tenant_id='dda78e66-575f-45d4-b136-4d7ad5dc4de7'::uuid AND u.name='Gustavo Macedo' AND u.whatsapp='' AND u.role::text='OWNER')<>1
 THEN RAISE EXCEPTION 'NEW_PROFILE_NOT_VISIBLE'; END IF;
 IF (SELECT count(*) FROM public.tenants t WHERE t.id='dda78e66-575f-45d4-b136-4d7ad5dc4de7'::uuid)<>1
 THEN RAISE EXCEPTION 'NEW_TENANT_NOT_VISIBLE'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenants t WHERE t.id<>'dda78e66-575f-45d4-b136-4d7ad5dc4de7'::uuid)
    OR EXISTS(SELECT 1 FROM public.users u WHERE u.id<>auth.uid())
    OR EXISTS(SELECT 1 FROM public.leads) OR EXISTS(SELECT 1 FROM public.conversations)
    OR EXISTS(SELECT 1 FROM public.messages) OR EXISTS(SELECT 1 FROM public.meetings)
    OR EXISTS(SELECT 1 FROM public.campaigns) OR EXISTS(SELECT 1 FROM public.scripts)
 THEN RAISE EXCEPTION 'NEW_ACCOUNT_SCOPE_OR_EMPTY_STATE_FAILED: %',jsonb_build_object(
   'other_tenants',(SELECT count(*) FROM public.tenants t WHERE t.id<>'dda78e66-575f-45d4-b136-4d7ad5dc4de7'::uuid),
   'other_users',(SELECT count(*) FROM public.users u WHERE u.id<>auth.uid()),
   'leads',(SELECT count(*) FROM public.leads),'conversations',(SELECT count(*) FROM public.conversations),
   'messages',(SELECT count(*) FROM public.messages),'meetings',(SELECT count(*) FROM public.meetings),
   'campaigns',(SELECT count(*) FROM public.campaigns),'scripts',(SELECT count(*) FROM public.scripts)); END IF;
END;
$permissions$;
SELECT set_config('request.jwt.claim.sub',current_setting('ops.fixture_admin_id'),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ops.fixture_admin_id'),'role','authenticated','app_metadata',jsonb_build_object('role','GUILDS_ADMIN'))::text,true);
DO $admin_access$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE role::text='GUILDS_ADMIN') OR (SELECT count(*) FROM public.tenants)<2
 THEN RAISE EXCEPTION 'LEGITIMATE_ADMIN_ACCESS_REGRESSION'; END IF;
END;
$admin_access$;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SET LOCAL ROLE anon;
DO $anonymous_access$
BEGIN
 BEGIN
  IF EXISTS(SELECT 1 FROM public.users) THEN RAISE EXCEPTION 'ANONYMOUS_USER_DATA_VISIBLE'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END;
$anonymous_access$;
RESET ROLE;
SELECT jsonb_build_object('tenant_id',u.tenant_id,'role',u.role,'profile_reset',u.name='Gustavo Macedo' AND u.whatsapp='' AND u.city IS NULL AND u.susep IS NULL AND u.avatar_url IS NULL AND u.bio IS NULL AND u.partner_brand IS NULL AND u.partner_code IS NULL AND u.preferences::jsonb='{}'::jsonb,
 'leads',(SELECT count(*) FROM public.leads WHERE tenant_id=u.tenant_id),
 'conversations',(SELECT count(*) FROM public.conversations WHERE tenant_id=u.tenant_id),
 'messages',(SELECT count(*) FROM public.messages WHERE tenant_id=u.tenant_id),
 'campaigns',(SELECT count(*) FROM public.campaigns WHERE tenant_id=u.tenant_id),
 'scripts',(SELECT count(*) FROM public.scripts WHERE tenant_id=u.tenant_id),
 'meetings',(SELECT count(*) FROM public.meetings WHERE tenant_id=u.tenant_id),
 'commercial_knowledge',(SELECT count(*) FROM public.commercial_knowledge_chunks WHERE tenant_id=u.tenant_id),
 'whatsapp_channels',(SELECT count(*) FROM public.whatsapp_channels WHERE tenant_id=u.tenant_id),
 'calendar_connected',EXISTS(SELECT 1 FROM public.tenant_secrets s WHERE s.tenant_id=u.tenant_id AND s.google_oauth_refresh_encrypted IS NOT NULL),
 'outbound_paused',EXISTS(SELECT 1 FROM public.tenant_ai_outbound_controls x WHERE x.tenant_id=u.tenant_id AND x.paused),
 'fresh_claims_isolation_passed',true) AS verification
FROM public.users u WHERE u.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid;
ROLLBACK;
