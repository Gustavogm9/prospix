-- Provider billing ledger.
-- This table stores externally verifiable provider costs, separated from
-- tenant_usage, which is an operational counter/estimate ledger.

BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (
    provider IN (
      'GOOGLE_CLOUD',
      'GOOGLE_MAPS',
      'OPENAI',
      'WHATSAPP',
      'EVOLUTION',
      'WAHA',
      'TAVILY',
      'FIRECRAWL',
      'INFRA',
      'OTHER'
    )
  ),
  service TEXT NOT NULL,
  sku_id TEXT NULL,
  sku_description TEXT NULL,
  period_month DATE NOT NULL,
  usage_start_at TIMESTAMP WITH TIME ZONE NULL,
  usage_end_at TIMESTAMP WITH TIME ZONE NULL,
  cost_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',
  quantity NUMERIC NULL,
  unit TEXT NULL,
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (
    source IN (
      'MANUAL',
      'GOOGLE_BILLING_EXPORT',
      'CSV_IMPORT',
      'API_IMPORT',
      'ESTIMATE',
      'SYSTEM'
    )
  ),
  attribution_status TEXT NOT NULL DEFAULT 'TENANT_ATTRIBUTED' CHECK (
    attribution_status IN ('TENANT_ATTRIBUTED', 'UNALLOCATED', 'ESTIMATED')
  ),
  external_project_id TEXT NULL,
  external_billing_account_id TEXT NULL,
  external_invoice_id TEXT NULL,
  external_row_id TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NULL,
  created_by_id TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT provider_cost_ledger_currency_upper CHECK (currency = UPPER(currency)),
  CONSTRAINT provider_cost_ledger_cost_not_negative CHECK (cost_cents >= 0),
  CONSTRAINT provider_cost_ledger_period_is_month_start CHECK (
    period_month = date_trunc('month', period_month)::date
  ),
  CONSTRAINT provider_cost_ledger_unallocated_has_no_tenant CHECK (
    attribution_status <> 'UNALLOCATED' OR tenant_id IS NULL
  ),
  CONSTRAINT provider_cost_ledger_tenant_attributed_has_tenant CHECK (
    attribution_status <> 'TENANT_ATTRIBUTED' OR tenant_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS provider_cost_ledger_tenant_period_idx
  ON public.provider_cost_ledger (tenant_id, period_month DESC, provider, service);

CREATE INDEX IF NOT EXISTS provider_cost_ledger_period_provider_idx
  ON public.provider_cost_ledger (period_month DESC, provider, service);

CREATE INDEX IF NOT EXISTS provider_cost_ledger_attribution_idx
  ON public.provider_cost_ledger (period_month DESC, attribution_status);

CREATE UNIQUE INDEX IF NOT EXISTS provider_cost_ledger_external_row_uidx
  ON public.provider_cost_ledger (source, external_row_id)
  WHERE external_row_id IS NOT NULL;

ALTER TABLE public.provider_cost_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_cost_ledger_select ON public.provider_cost_ledger;
CREATE POLICY provider_cost_ledger_select
  ON public.provider_cost_ledger
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS provider_cost_ledger_service_role_all ON public.provider_cost_ledger;
CREATE POLICY provider_cost_ledger_service_role_all
  ON public.provider_cost_ledger
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.provider_cost_ledger TO authenticated;
GRANT ALL ON public.provider_cost_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.touch_provider_cost_ledger_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_provider_cost_ledger_updated_at ON public.provider_cost_ledger;
CREATE TRIGGER touch_provider_cost_ledger_updated_at
  BEFORE UPDATE ON public.provider_cost_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_provider_cost_ledger_updated_at();

COMMENT ON TABLE public.provider_cost_ledger IS
  'Externally verifiable provider billing ledger. Do not confuse with tenant_usage, which is an internal operational counter.';

COMMENT ON COLUMN public.provider_cost_ledger.cost_cents IS
  'Cost in cents of provider invoice currency, normally BRL. Values must come from billing export/API/manual evidence, not inferred UI counters.';

COMMENT ON COLUMN public.provider_cost_ledger.evidence IS
  'Auditable source metadata such as billing export filename, invoice id, Google project, import checksum, or manual approval reference.';

COMMIT;
