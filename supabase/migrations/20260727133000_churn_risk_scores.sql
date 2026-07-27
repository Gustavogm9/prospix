BEGIN;

CREATE TABLE IF NOT EXISTS public.churn_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'low',
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT churn_risk_scores_tenant_unique UNIQUE (tenant_id),
  CONSTRAINT churn_risk_scores_score_range CHECK (score >= 0 AND score <= 100),
  CONSTRAINT churn_risk_scores_level_check CHECK (level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT churn_risk_scores_reasons_array CHECK (jsonb_typeof(reasons) = 'array'),
  CONSTRAINT churn_risk_scores_metrics_object CHECK (jsonb_typeof(metrics) = 'object')
);

CREATE INDEX IF NOT EXISTS churn_risk_scores_score_idx
  ON public.churn_risk_scores (score DESC, calculated_at DESC);

CREATE INDEX IF NOT EXISTS churn_risk_scores_level_idx
  ON public.churn_risk_scores (level, score DESC);

ALTER TABLE public.churn_risk_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS churn_risk_scores_read
  ON public.churn_risk_scores;

CREATE POLICY churn_risk_scores_read
  ON public.churn_risk_scores
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

REVOKE ALL ON public.churn_risk_scores FROM anon, authenticated;
GRANT SELECT ON public.churn_risk_scores TO authenticated;
GRANT ALL ON public.churn_risk_scores TO service_role;

COMMENT ON TABLE public.churn_risk_scores IS
  'Optional cross-tenant churn risk cache used by the admin tenants panel. Absence of rows means no calculated risk yet.';

COMMENT ON COLUMN public.churn_risk_scores.score IS
  'Normalized churn risk score from 0 to 100.';

COMMIT;
