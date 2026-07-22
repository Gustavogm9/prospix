-- Restrict due-queue diagnostics to backend service access.
-- The view includes lead/campaign context and is consumed through server APIs.

REVOKE ALL ON public.ai_worker_due_queue_diagnostics FROM anon;
REVOKE ALL ON public.ai_worker_due_queue_diagnostics FROM authenticated;
GRANT SELECT ON public.ai_worker_due_queue_diagnostics TO service_role;
