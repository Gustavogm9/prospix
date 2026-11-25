-- A customer's row policy must check the caller's role, not the target row's role.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
DECLARE
 v_using text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.users'::regclass AND c.relrowsecurity)
 THEN RAISE EXCEPTION 'USERS_RLS_NOT_ENABLED'; END IF;
 SELECT pg_get_expr(p.polqual,p.polrelid) INTO v_using FROM pg_policy p
 WHERE p.polrelid='public.users'::regclass AND p.polname='tenant_isolation_users' AND p.polcmd='*' AND p.polpermissive;
 IF v_using IS NULL OR v_using NOT IN (
   '((tenant_id = current_tenant_id()) OR (role = ''GUILDS_ADMIN''::"UserRole"))',
   '((tenant_id = current_tenant_id()) OR (current_user_role() = ''GUILDS_ADMIN''::text))'
 ) THEN RAISE EXCEPTION 'USER_POLICY_PRECONDITION_MISMATCH'; END IF;
END;
$guard$;
ALTER POLICY tenant_isolation_users ON public.users
 USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'GUILDS_ADMIN')
 WITH CHECK (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'GUILDS_ADMIN');
COMMENT ON POLICY tenant_isolation_users ON public.users IS
 'Tenant members access their own tenant; global access depends on the caller role, never the target user role.';
COMMIT;
