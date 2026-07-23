-- Tighten operational view grants to the minimum needed by server-side admin
-- monitoring. The ledger table remains service-role only.

BEGIN;

REVOKE ALL ON public.evolution_webhook_operational_health FROM service_role;
GRANT SELECT ON public.evolution_webhook_operational_health TO service_role;

REVOKE ALL ON public.evolution_webhook_operational_failures FROM service_role;
GRANT SELECT ON public.evolution_webhook_operational_failures TO service_role;

COMMIT;
