-- Remove project-wide default grants from the controlled prospecting tables.
-- Reads stay tenant-scoped for authenticated users; writes are service-only.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
  public.prospecting_runs,
  public.provider_usage_events,
  public.provider_cost_imports,
  public.qualification_sessions,
  public.qualification_answers,
  public.campaign_qa_allowlist
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.prospecting_runs,
  public.provider_usage_events,
  public.provider_cost_imports,
  public.qualification_sessions,
  public.qualification_answers,
  public.campaign_qa_allowlist
FROM authenticated;

GRANT SELECT ON TABLE
  public.prospecting_runs,
  public.provider_usage_events,
  public.provider_cost_imports,
  public.qualification_sessions,
  public.qualification_answers,
  public.campaign_qa_allowlist
TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.prospecting_runs,
  public.provider_usage_events,
  public.provider_cost_imports,
  public.qualification_sessions,
  public.qualification_answers,
  public.campaign_qa_allowlist
TO service_role;

COMMIT;
