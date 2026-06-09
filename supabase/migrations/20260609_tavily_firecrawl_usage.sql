DROP FUNCTION IF EXISTS dashboard_ai_usage(uuid);
DROP FUNCTION IF EXISTS increment_tenant_usage(uuid, bigint, bigint, int, int);
ALTER TABLE public.tenant_usage ADD COLUMN IF NOT EXISTS tavily_calls int DEFAULT 0;
ALTER TABLE public.tenant_usage ADD COLUMN IF NOT EXISTS firecrawl_calls int DEFAULT 0;
ALTER TABLE public.tenant_usage ADD COLUMN IF NOT EXISTS tavily_cost_cents int DEFAULT 0;
ALTER TABLE public.tenant_usage ADD COLUMN IF NOT EXISTS firecrawl_cost_cents int DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_tenant_usage(
  p_tenant_id uuid,
  p_llm_tokens_input bigint DEFAULT 0,
  p_llm_tokens_output bigint DEFAULT 0,
  p_whatsapp_msgs int DEFAULT 0,
  p_maps_calls int DEFAULT 0,
  p_tavily_calls int DEFAULT 0,
  p_firecrawl_calls int DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_month date := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  INSERT INTO tenant_usage (
    tenant_id, 
    period_month, 
    llm_tokens_input, 
    llm_tokens_output, 
    whatsapp_messages_sent, 
    google_maps_calls,
    tavily_calls,
    firecrawl_calls,
    llm_cost_cents,
    whatsapp_cost_cents,
    google_maps_cost_cents,
    tavily_cost_cents,
    firecrawl_cost_cents,
    updated_at
  )
  VALUES (
    p_tenant_id, 
    v_period_month, 
    p_llm_tokens_input, 
    p_llm_tokens_output, 
    p_whatsapp_msgs, 
    p_maps_calls,
    p_tavily_calls,
    p_firecrawl_calls,
    0, 0, 0, 0, 0,
    now()
  )
  ON CONFLICT (tenant_id, period_month)
  DO UPDATE SET
    llm_tokens_input = tenant_usage.llm_tokens_input + EXCLUDED.llm_tokens_input,
    llm_tokens_output = tenant_usage.llm_tokens_output + EXCLUDED.llm_tokens_output,
    whatsapp_messages_sent = tenant_usage.whatsapp_messages_sent + EXCLUDED.whatsapp_messages_sent,
    google_maps_calls = tenant_usage.google_maps_calls + EXCLUDED.google_maps_calls,
    tavily_calls = tenant_usage.tavily_calls + EXCLUDED.tavily_calls,
    firecrawl_calls = tenant_usage.firecrawl_calls + EXCLUDED.firecrawl_calls,
    updated_at = now();

  -- Recalcula custos com base no total acumulado do mês (evita erros de arredondamento)
  -- GPT-4o-mini: 75 cents / 1M in, 300 cents / 1M out
  -- Maps: 20 cents per call
  -- Tavily: 5 cents per search (1 cent USD)
  -- Firecrawl: 10 cents per scrape (2 cents USD)
  UPDATE tenant_usage
  SET
    llm_cost_cents = round(((llm_tokens_input * 75.0) + (llm_tokens_output * 300.0)) / 1000000.0)::int,
    google_maps_cost_cents = google_maps_calls * 20,
    tavily_cost_cents = tavily_calls * 5,
    firecrawl_cost_cents = firecrawl_calls * 10
  WHERE tenant_id = p_tenant_id AND period_month = v_period_month;
END;
$$;

COMMENT ON FUNCTION increment_tenant_usage IS 'Incrementa uso do tenant e recalcula custos no mês corrente';

CREATE OR REPLACE FUNCTION dashboard_ai_usage(p_tenant_id uuid)
RETURNS TABLE (
  llm_cost_cents      bigint,
  whatsapp_cost_cents bigint,
  maps_cost_cents     bigint,
  tavily_cost_cents   bigint,
  firecrawl_cost_cents bigint,
  total_costs_cents   bigint,
  max_limit_cents     bigint,
  used_percent        numeric,
  remaining_cents     bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  current_period AS (
    SELECT date_trunc('month', now())::timestamptz AS period_month
  ),
  usage AS (
    SELECT
      coalesce(u.llm_cost_cents, 0)::bigint           AS llm,
      coalesce(u.whatsapp_cost_cents, 0)::bigint       AS whatsapp,
      coalesce(u.google_maps_cost_cents, 0)::bigint    AS maps,
      coalesce(u.tavily_cost_cents, 0)::bigint         AS tavily,
      coalesce(u.firecrawl_cost_cents, 0)::bigint      AS firecrawl
    FROM current_period cp
    LEFT JOIN tenant_usage u
      ON u.tenant_id = p_tenant_id
      AND u.period_month = cp.period_month
  ),
  plan_info AS (
    SELECT
      CASE t.plan
        WHEN 'STARTER'  THEN 5000
        WHEN 'STANDARD' THEN 15000
        WHEN 'PREMIUM'  THEN 50000
        ELSE 5000
      END AS limit_cents
    FROM tenants t
    WHERE t.id = p_tenant_id
  )
  SELECT
    usage.llm                                      AS llm_cost_cents,
    usage.whatsapp                                 AS whatsapp_cost_cents,
    usage.maps                                     AS maps_cost_cents,
    usage.tavily                                   AS tavily_cost_cents,
    usage.firecrawl                                AS firecrawl_cost_cents,
    (usage.llm + usage.whatsapp + usage.maps + usage.tavily + usage.firecrawl) AS total_costs_cents,
    plan_info.limit_cents::bigint                  AS max_limit_cents,
    CASE WHEN plan_info.limit_cents > 0
      THEN round(((usage.llm + usage.whatsapp + usage.maps + usage.tavily + usage.firecrawl)::numeric / plan_info.limit_cents) * 100, 1)
      ELSE 0
    END                                            AS used_percent,
    greatest(0, plan_info.limit_cents - (usage.llm + usage.whatsapp + usage.maps + usage.tavily + usage.firecrawl))::bigint AS remaining_cents
  FROM usage, plan_info;
$$;

COMMENT ON FUNCTION dashboard_ai_usage(uuid) IS 'Returns current month AI/WhatsApp/Maps/Tavily/Firecrawl costs with plan limit percentages.';
