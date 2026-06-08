CREATE OR REPLACE FUNCTION increment_tenant_usage(
  p_tenant_id uuid,
  p_llm_tokens_input bigint DEFAULT 0,
  p_llm_tokens_output bigint DEFAULT 0,
  p_whatsapp_msgs int DEFAULT 0,
  p_maps_calls int DEFAULT 0
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
    llm_cost_cents,
    whatsapp_cost_cents,
    google_maps_cost_cents,
    updated_at
  )
  VALUES (
    p_tenant_id, 
    v_period_month, 
    p_llm_tokens_input, 
    p_llm_tokens_output, 
    p_whatsapp_msgs, 
    p_maps_calls,
    0, 0, 0,
    now()
  )
  ON CONFLICT (tenant_id, period_month)
  DO UPDATE SET
    llm_tokens_input = tenant_usage.llm_tokens_input + EXCLUDED.llm_tokens_input,
    llm_tokens_output = tenant_usage.llm_tokens_output + EXCLUDED.llm_tokens_output,
    whatsapp_messages_sent = tenant_usage.whatsapp_messages_sent + EXCLUDED.whatsapp_messages_sent,
    google_maps_calls = tenant_usage.google_maps_calls + EXCLUDED.google_maps_calls,
    updated_at = now();

  -- Recalcula custos com base no total acumulado do mês (evita erros de arredondamento)
  -- GPT-4o-mini: US$ 0.15/1M in, US$ 0.60/1M out. Dólar a R$ 5,00 -> R$ 0.75 / 1M in (75 cents), R$ 3.00 / 1M out (300 cents)
  -- Maps: R$ 0.20 por lead capturado (20 cents)
  UPDATE tenant_usage
  SET
    llm_cost_cents = round(((llm_tokens_input * 75.0) + (llm_tokens_output * 300.0)) / 1000000.0)::int,
    google_maps_cost_cents = google_maps_calls * 20
  WHERE tenant_id = p_tenant_id AND period_month = v_period_month;
END;
$$;

COMMENT ON FUNCTION increment_tenant_usage IS 'Incrementa uso do tenant e recalcula custos no mês corrente';
