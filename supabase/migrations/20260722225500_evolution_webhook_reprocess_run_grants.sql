-- Tighten service-role grants for selective webhook reprocess audit runs.

BEGIN;

REVOKE ALL ON public.evolution_webhook_reprocess_runs FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.evolution_webhook_reprocess_runs TO service_role;

COMMIT;
