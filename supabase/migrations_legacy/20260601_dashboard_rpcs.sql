-- ═══════════════════════════════════════════════════════════════════════════════
-- Dashboard RPC Functions for Prospix
-- Migration: 20260601_dashboard_rpcs.sql
--
-- These functions provide server-side aggregations for the dashboard,
-- avoiding multiple round-trips and large data transfers.
-- Each function is SECURITY DEFINER + search_path=public, and filters by
-- p_tenant_id so RLS is satisfied.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. dashboard_today ────────────────────────────────────────────────────────
-- Returns today's operational metrics for a tenant.
-- meetings_today, conversations_ready, pending_manual, need_callback, new_leads_today.
CREATE OR REPLACE FUNCTION dashboard_today(p_tenant_id uuid)
RETURNS TABLE (
  meetings_today   bigint,
  conversations_ready bigint,
  pending_manual   bigint,
  need_callback    bigint,
  new_leads_today  bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  today_bounds AS (
    SELECT
      date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS day_start,
      date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' + interval '1 day' - interval '1 millisecond' AS day_end
  ),
  m AS (
    SELECT count(*) AS cnt
    FROM meetings, today_bounds
    WHERE tenant_id = p_tenant_id
      AND scheduled_for >= today_bounds.day_start
      AND scheduled_for <= today_bounds.day_end
      AND status IN ('SCHEDULED', 'CONFIRMED')
  ),
  conv_ready AS (
    SELECT count(*) AS cnt
    FROM conversations
    WHERE tenant_id = p_tenant_id
      AND status = 'ACTIVE'
      AND ai_handling = true
  ),
  conv_pending AS (
    SELECT count(*) AS cnt
    FROM conversations
    WHERE tenant_id = p_tenant_id
      AND status IN ('PAUSED', 'ESCALATED')
      AND ai_handling = false
  ),
  callback AS (
    SELECT count(*) AS cnt
    FROM leads
    WHERE tenant_id = p_tenant_id
      AND status = 'CONTACTED'
      AND deleted_at IS NULL
  ),
  new_leads AS (
    SELECT count(*) AS cnt
    FROM leads, today_bounds
    WHERE tenant_id = p_tenant_id
      AND created_at >= today_bounds.day_start
      AND created_at <= today_bounds.day_end
      AND deleted_at IS NULL
  )
  SELECT
    m.cnt         AS meetings_today,
    conv_ready.cnt AS conversations_ready,
    conv_pending.cnt AS pending_manual,
    callback.cnt  AS need_callback,
    new_leads.cnt AS new_leads_today
  FROM m, conv_ready, conv_pending, callback, new_leads;
$$;

COMMENT ON FUNCTION dashboard_today(uuid) IS
  'Returns today''s operational dashboard metrics for a given tenant.';


-- ─── 2. dashboard_funnel ───────────────────────────────────────────────────────
-- Returns lead count per pipeline_stage/status for the tenant.
-- Counts all non-deleted leads grouped by status.
CREATE OR REPLACE FUNCTION dashboard_funnel(p_tenant_id uuid)
RETURNS TABLE (
  status text,
  cnt    bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.status::text AS status,
    count(*)       AS cnt
  FROM leads l
  WHERE l.tenant_id = p_tenant_id
    AND l.deleted_at IS NULL
  GROUP BY l.status
  ORDER BY
    CASE l.status
      WHEN 'CAPTURED'          THEN 1
      WHEN 'ENRICHED'          THEN 2
      WHEN 'CONTACTED'         THEN 3
      WHEN 'NO_RESPONSE'       THEN 4
      WHEN 'CONVERSING'        THEN 5
      WHEN 'QUALIFIED'         THEN 6
      WHEN 'MEETING_SCHEDULED' THEN 7
      WHEN 'CLOSED_WON'        THEN 8
      WHEN 'CLOSED_LOST'       THEN 9
      ELSE 10
    END;
$$;

COMMENT ON FUNCTION dashboard_funnel(uuid) IS
  'Returns lead counts grouped by status for funnel visualization.';


-- ─── 3. dashboard_performance ──────────────────────────────────────────────────
-- Returns revenue/commission aggregates from meetings with outcome = CLOSED.
-- Looks at all-time data by default (filtering can happen client-side or
-- with an extended version of this RPC).
CREATE OR REPLACE FUNCTION dashboard_performance(p_tenant_id uuid)
RETURNS TABLE (
  total_policy_cents     bigint,
  total_commission_cents bigint,
  sales_count            bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(sum(m.policy_value_cents), 0)::bigint  AS total_policy_cents,
    coalesce(sum(m.commission_cents), 0)::bigint     AS total_commission_cents,
    count(*)::bigint                                  AS sales_count
  FROM meetings m
  WHERE m.tenant_id = p_tenant_id
    AND m.outcome = 'CLOSED';
$$;

COMMENT ON FUNCTION dashboard_performance(uuid) IS
  'Returns total policy value, commissions, and sales count for closed meetings.';


-- ─── 4. dashboard_ai_usage ─────────────────────────────────────────────────────
-- Returns current month LLM/WhatsApp/Maps costs and plan limits.
CREATE OR REPLACE FUNCTION dashboard_ai_usage(p_tenant_id uuid)
RETURNS TABLE (
  llm_cost_cents      bigint,
  whatsapp_cost_cents bigint,
  maps_cost_cents     bigint,
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
      coalesce(u.google_maps_cost_cents, 0)::bigint    AS maps
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
    (usage.llm + usage.whatsapp + usage.maps)      AS total_costs_cents,
    plan_info.limit_cents::bigint                  AS max_limit_cents,
    CASE WHEN plan_info.limit_cents > 0
      THEN round(((usage.llm + usage.whatsapp + usage.maps)::numeric / plan_info.limit_cents) * 100, 1)
      ELSE 0
    END                                            AS used_percent,
    greatest(0, plan_info.limit_cents - (usage.llm + usage.whatsapp + usage.maps))::bigint AS remaining_cents
  FROM usage, plan_info;
$$;

COMMENT ON FUNCTION dashboard_ai_usage(uuid) IS
  'Returns current month AI/WhatsApp/Maps costs with plan limit percentages.';


-- ─── 5. dashboard_weekly_captures ──────────────────────────────────────────────
-- Returns lead capture counts for each of the last 7 days.
CREATE OR REPLACE FUNCTION dashboard_weekly_captures(p_tenant_id uuid)
RETURNS TABLE (
  capture_date date,
  cnt          bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH days AS (
    SELECT generate_series(
      (current_date - interval '6 days')::date,
      current_date,
      interval '1 day'
    )::date AS d
  )
  SELECT
    days.d AS capture_date,
    count(l.id) AS cnt
  FROM days
  LEFT JOIN leads l
    ON l.tenant_id = p_tenant_id
    AND l.deleted_at IS NULL
    AND l.created_at::date = days.d
  GROUP BY days.d
  ORDER BY days.d;
$$;

COMMENT ON FUNCTION dashboard_weekly_captures(uuid) IS
  'Returns daily lead capture counts for the last 7 days.';


-- ─── 6. dashboard_hot_leads ────────────────────────────────────────────────────
-- Returns top 10 leads by fit_score, excluding terminal statuses.
CREATE OR REPLACE FUNCTION dashboard_hot_leads(p_tenant_id uuid)
RETURNS TABLE (
  id                  uuid,
  name                text,
  profession          text,
  whatsapp            text,
  address             jsonb,
  fit_score           numeric,
  status              text,
  google_rating       numeric,
  google_reviews_count integer,
  registration_number text,
  created_at          timestamptz,
  contacted_at        timestamptz,
  first_response_at   timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.profession::text,
    l.whatsapp,
    l.address::jsonb,
    l.fit_score,
    l.status::text,
    l.google_rating,
    l.google_reviews_count::integer,
    l.registration_number,
    l.created_at,
    l.contacted_at,
    l.first_response_at
  FROM leads l
  WHERE l.tenant_id = p_tenant_id
    AND l.deleted_at IS NULL
    AND l.fit_score IS NOT NULL
    AND l.status NOT IN ('ARCHIVED', 'OPTED_OUT', 'CLOSED_LOST')
  ORDER BY l.fit_score DESC
  LIMIT 10;
$$;

COMMENT ON FUNCTION dashboard_hot_leads(uuid) IS
  'Returns top 10 leads ranked by fit_score, excluding terminal statuses.';
