-- Scope: one existing account, canonical Auth identity, existing QA tenant.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $operation$
DECLARE
 v_old uuid := '99999999-9999-9999-9999-999999999999';
 v_auth uuid := '2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9';
 v_tenant uuid := '6de57a0c-f8f5-4990-b9c3-87a83d95e75d';
 v_before public.users%ROWTYPE;
 v_after public.users%ROWTYPE;
 v_fk record;
 v_count bigint;
 v_others bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('prospix-client-access-gustavo-macedo-2026-11-24',0));
 IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=v_tenant AND t.name='Corretora de Teste' AND t.status::text='ACTIVE' AND t.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'TENANT_SCOPE_CHANGED'; END IF;
 IF (SELECT count(*) FROM auth.users a WHERE lower(a.email)='gustavo.macedo@guilds.com.br')<>1
    OR NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id=v_auth AND lower(a.email)='gustavo.macedo@guilds.com.br' AND a.email_confirmed_at IS NOT NULL AND (a.banned_until IS NULL OR a.banned_until<=now()))
    OR EXISTS (SELECT 1 FROM auth.users a WHERE a.id=v_old)
 THEN RAISE EXCEPTION 'AUTH_IDENTITY_CHANGED'; END IF;
 SELECT count(*) INTO v_others FROM public.users u JOIN auth.users a ON a.id=u.id AND lower(a.email)=lower(u.email)
 WHERE u.id NOT IN (v_old,v_auth) AND u.role::text='GUILDS_ADMIN' AND u.tenant_id IS NULL AND u.deleted_at IS NULL;
 IF v_others<1 THEN RAISE EXCEPTION 'NO_OTHER_CONFIRMED_SUPER_ADMIN'; END IF;
 IF (SELECT count(*) FROM public.users u WHERE lower(u.email)='gustavo.macedo@guilds.com.br')<>1
 THEN RAISE EXCEPTION 'PROFILE_EMAIL_AMBIGUOUS'; END IF;
 IF EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_auth AND lower(u.email)='gustavo.macedo@guilds.com.br' AND u.role::text='OWNER' AND u.tenant_id=v_tenant AND u.deleted_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_old)
 THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_auth) THEN RAISE EXCEPTION 'AUTH_ID_ALREADY_HAS_OTHER_PROFILE'; END IF;
 SELECT u.* INTO v_before FROM public.users u WHERE u.id=v_old AND lower(u.email)='gustavo.macedo@guilds.com.br'
   AND u.role::text='GUILDS_ADMIN' AND u.tenant_id IS NULL AND u.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXPECTED_PROFILE_CHANGED'; END IF;
 -- Linked history is excluded rather than moved implicitly by a primary-key update.
 FOR v_fk IN
   SELECT ns.nspname AS schema_name, cl.relname AS table_name, att.attname AS column_name
   FROM pg_constraint c
   JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
   JOIN pg_attribute id_att ON id_att.attrelid=c.confrelid AND id_att.attname='id'
   JOIN pg_attribute att ON att.attrelid=c.conrelid AND att.attnum=c.conkey[array_position(c.confkey,id_att.attnum)]
   WHERE c.contype='f' AND c.confrelid='public.users'::regclass AND id_att.attnum=ANY(c.confkey)
 LOOP
   EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',v_fk.schema_name,v_fk.table_name,v_fk.column_name) INTO v_count USING v_old;
   IF v_count>0 THEN RAISE EXCEPTION 'PROFILE_HAS_LINKED_HISTORY: %.% (% rows)',v_fk.schema_name,v_fk.table_name,v_count; END IF;
 END LOOP;
 UPDATE public.users u SET id=v_auth,role='OWNER',tenant_id=v_tenant,updated_at=now()
 WHERE u.id=v_old AND u.role::text='GUILDS_ADMIN' AND u.tenant_id IS NULL AND lower(u.email)='gustavo.macedo@guilds.com.br' AND u.deleted_at IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION 'UNEXPECTED_UPDATED_COUNT'; END IF;
 SELECT u.* INTO v_after FROM public.users u WHERE u.id=v_auth;
 IF v_after.name IS DISTINCT FROM v_before.name OR v_after.email IS DISTINCT FROM v_before.email
    OR v_after.whatsapp IS DISTINCT FROM v_before.whatsapp OR v_after.password_hash IS DISTINCT FROM v_before.password_hash
 THEN RAISE EXCEPTION 'UNEXPECTED_PROFILE_FIELD_CHANGE'; END IF;
 IF v_others<>(SELECT count(*) FROM public.users u JOIN auth.users a ON a.id=u.id AND lower(a.email)=lower(u.email)
   WHERE u.id NOT IN (v_old,v_auth) AND u.role::text='GUILDS_ADMIN' AND u.tenant_id IS NULL AND u.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'OTHER_ADMINS_CHANGED'; END IF;
 INSERT INTO public.audit_log(action,target_type,target_id,tenant_id,payload)
 VALUES('user.client_access_granted','user',v_auth::text,v_tenant,
   jsonb_build_object('operation','2026-11-24-grant-client-access','previous_profile_id',v_old,'previous_role','GUILDS_ADMIN','role','OWNER','authorization','explicit_user_request','identity_reconciled',true));
END;
$operation$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9',true);
SELECT set_config('request.jwt.claims','{"sub":"2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9","role":"authenticated","app_metadata":{"role":"OWNER","tenant_id":"6de57a0c-f8f5-4990-b9c3-87a83d95e75d"}}',true);
DO $rls$
BEGIN
 IF (SELECT count(*) FROM public.users u WHERE u.id=auth.uid() AND u.role::text='OWNER' AND u.tenant_id='6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid AND u.deleted_at IS NULL)<>1
 THEN RAISE EXCEPTION 'OWN_PROFILE_NOT_VISIBLE'; END IF;
 IF (SELECT count(*) FROM public.tenants t WHERE t.id='6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid)<>1
 THEN RAISE EXCEPTION 'OWN_TENANT_NOT_VISIBLE'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenants t WHERE t.id<>'6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid)
    OR EXISTS(SELECT 1 FROM public.leads l WHERE l.tenant_id<>'6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid)
 THEN RAISE EXCEPTION 'CROSS_TENANT_READ_NOT_DENIED'; END IF;
END;
$rls$;
RESET ROLE;
SELECT jsonb_build_object('matched_identity_profile',u.id=a.id AND lower(u.email)=lower(a.email),
 'role',u.role,'tenant_id',u.tenant_id,'tenant_name',t.name,'profile_active',u.deleted_at IS NULL,
 'auth_confirmed',a.email_confirmed_at IS NOT NULL,'auth_role',a.raw_app_meta_data->>'role','auth_tenant',a.raw_app_meta_data->>'tenant_id','rls_own_and_other_tenant_passed',true) AS verification
FROM public.users u JOIN auth.users a ON a.id=u.id JOIN public.tenants t ON t.id=u.tenant_id
WHERE u.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid;
ROLLBACK;
