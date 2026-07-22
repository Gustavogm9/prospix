-- Canonical first-touch eligibility view.
-- This is intentionally read-only: it classifies leads without changing lead,
-- queue, conversation, campaign, script, or Guardian records.

BEGIN;

CREATE OR REPLACE VIEW public.first_touch_lead_eligibility AS
WITH daily_ai_outbound AS (
  SELECT
    messages.tenant_id,
    COUNT(*)::INTEGER AS sent_today
  FROM public.messages
  WHERE messages.direction::TEXT = 'OUTBOUND'
    AND messages.sender::TEXT = 'AI'
    AND messages.created_at >= (
      date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
      AT TIME ZONE 'America/Sao_Paulo'
    )
    AND messages.created_at <= now()
  GROUP BY messages.tenant_id
),
lead_base AS (
  SELECT
    leads.*,
    regexp_replace(COALESCE(leads.whatsapp, ''), '\D', '', 'g') AS whatsapp_digits
  FROM public.leads
),
classified AS (
  SELECT
    lead_base.tenant_id,
    lead_base.id AS lead_id,
    lead_base.campaign_id,
    campaigns.name AS campaign_name,
    campaigns.status::TEXT AS campaign_status,
    campaigns.profession::TEXT AS campaign_profession,
    selected_script.id AS script_id,
    selected_script.name AS script_name,
    selected_script.status::TEXT AS script_status,
    selected_script.category::TEXT AS script_category,
    selected_script.target_profession::TEXT AS script_target_profession,
    CASE
      WHEN campaigns.active_script_id IS NOT NULL THEN 'EXPLICIT'
      WHEN selected_script.id IS NOT NULL THEN 'FALLBACK'
      ELSE 'NONE'
    END AS script_selection_source,
    lead_base.status::TEXT AS lead_status,
    lead_base.source::TEXT AS lead_source,
    lead_base.created_at,
    lead_base.updated_at,
    lead_base.deleted_at,
    lead_base.contacted_at,
    lead_base.queued_first_touch_at,
    lead_base.whatsapp IS NOT NULL AND btrim(lead_base.whatsapp) <> '' AS has_whatsapp,
    lead_base.whatsapp_digits,
    (lead_base.whatsapp_digits ~ '^55[0-9]{2}9[0-9]{8}$') AS has_mobile_whatsapp_shape,
    lead_base.whatsapp_valid,
    lead_base.phone_validation_status,
    lead_base.phone_validation_confidence,
    lead_base.relevance_status,
    lead_base.relevance_score,
    lead_base.fit_score,
    lead_base.entity_type,
    lead_base.identity_confidence,
    lead_base.lead_guardian_flags,
    COALESCE(active_variations.active_variation_count, 0)::INTEGER AS active_variation_count,
    COALESCE(daily_ai_outbound.sent_today, 0)::INTEGER AS tenant_ai_outbound_today,
    COALESCE(campaigns.daily_limit, 50)::INTEGER AS campaign_daily_limit,
    EXTRACT(HOUR FROM now() AT TIME ZONE 'America/Sao_Paulo')::INTEGER AS current_brt_hour,
    COALESCE(campaigns.hour_window_start, 8)::INTEGER AS campaign_hour_window_start,
    COALESCE(campaigns.hour_window_end, 20)::INTEGER AS campaign_hour_window_end,
    EXISTS (
      SELECT 1
      FROM public.optouts optouts
      WHERE optouts.tenant_id = lead_base.tenant_id
        AND (
          optouts.whatsapp = lead_base.whatsapp
          OR regexp_replace(COALESCE(optouts.whatsapp, ''), '\D', '', 'g') = lead_base.whatsapp_digits
        )
    ) AS has_optout,
    EXISTS (
      SELECT 1
      FROM public.conversations conversations
      JOIN public.pending_outbound pending
        ON pending.conversation_id = conversations.id
      WHERE conversations.tenant_id = lead_base.tenant_id
        AND conversations.lead_id = lead_base.id
        AND pending.message_type = 'OUTBOUND_START'
        AND pending.sent_at IS NULL
        AND pending.failed_at IS NULL
    ) AS has_active_first_touch_queue,
    EXISTS (
      SELECT 1
      FROM public.conversations conversations
      JOIN public.pending_outbound pending
        ON pending.conversation_id = conversations.id
      WHERE conversations.tenant_id = lead_base.tenant_id
        AND conversations.lead_id = lead_base.id
        AND pending.message_type = 'OUTBOUND_START'
        AND pending.sent_at IS NULL
        AND pending.failed_at IS NOT NULL
    ) AS has_failed_first_touch_queue,
    EXISTS (
      SELECT 1
      FROM public.conversations conversations
      JOIN public.pending_outbound pending
        ON pending.conversation_id = conversations.id
      WHERE conversations.tenant_id = lead_base.tenant_id
        AND conversations.lead_id = lead_base.id
        AND pending.message_type = 'OUTBOUND_START'
        AND pending.sent_at IS NOT NULL
    ) AS has_sent_first_touch_queue,
    (
      EXISTS (
      SELECT 1
      FROM public.guardian_decisions decisions
      WHERE decisions.tenant_id = lead_base.tenant_id
        AND decisions.lead_id = lead_base.id
        AND decisions.decision IN ('BLOCK', 'HARD_BLOCK')
        AND decisions.guardian_key IN (
          'G02_LEAD_RELEVANCE',
          'G04_IDENTITY_PERSONALIZATION',
          'G05_CONVERSATION_STATE',
          'G13_PLACEHOLDER_LEAK',
          'G14_INTERNAL_LEAK',
          'G15_PROMPT_INJECTION',
          'G16_SEMANTIC_SCOPE',
          'G17_NATURALNESS'
        )
      )
      OR COALESCE(lead_base.lead_guardian_flags ? 'guardian_engine_v3', FALSE)
    ) AS has_prior_guardian_block,
    CASE
      WHEN lead_base.relevance_score IS NULL THEN NULL
      WHEN lead_base.relevance_score < 0 THEN 0
      WHEN lead_base.relevance_score <= 1 THEN lead_base.relevance_score
      WHEN lead_base.relevance_score <= 10 THEN lead_base.relevance_score / 10
      WHEN lead_base.relevance_score <= 100 THEN lead_base.relevance_score / 100
      ELSE NULL
    END AS normalized_relevance_score,
    CASE
      WHEN lead_base.fit_score IS NULL THEN NULL
      WHEN lead_base.fit_score < 0 THEN 0
      WHEN lead_base.fit_score <= 1 THEN lead_base.fit_score
      WHEN lead_base.fit_score <= 10 THEN lead_base.fit_score / 10
      WHEN lead_base.fit_score <= 100 THEN lead_base.fit_score / 100
      ELSE NULL
    END AS normalized_fit_score,
    COALESCE(g02.review_min, 0.7) AS g02_review_min,
    COALESCE(g02.low_relevance_action, 'BLOCK') AS g02_low_relevance_action,
    COALESCE(g02.unknown_entity_action, 'BLOCK') AS g02_unknown_entity_action,
    lower(COALESCE(lead_base.name, '')) AS lead_name_lower,
    explicit_script.id AS explicit_script_id,
    explicit_script.status::TEXT AS explicit_script_status,
    explicit_script.category::TEXT AS explicit_script_category,
    explicit_script.target_profession::TEXT AS explicit_script_target_profession
  FROM lead_base
  LEFT JOIN public.campaigns campaigns
    ON campaigns.id = lead_base.campaign_id
   AND campaigns.tenant_id = lead_base.tenant_id
  LEFT JOIN public.scripts explicit_script
    ON explicit_script.id = campaigns.active_script_id
   AND explicit_script.tenant_id = campaigns.tenant_id
  LEFT JOIN LATERAL (
    SELECT scripts.*
    FROM public.scripts scripts
    WHERE campaigns.id IS NOT NULL
      AND scripts.tenant_id = campaigns.tenant_id
      AND scripts.archived_at IS NULL
      AND scripts.status::TEXT = 'ACTIVE'
      AND scripts.category::TEXT = 'APPROACH'
      AND (
        (campaigns.active_script_id IS NOT NULL AND scripts.id = campaigns.active_script_id)
        OR (
          campaigns.active_script_id IS NULL
          AND (
            scripts.target_profession IS NULL
            OR scripts.target_profession::TEXT = campaigns.profession::TEXT
          )
        )
      )
    ORDER BY
      CASE
        WHEN campaigns.active_script_id IS NOT NULL AND scripts.id = campaigns.active_script_id THEN 0
        WHEN scripts.target_profession::TEXT = campaigns.profession::TEXT THEN 1
        WHEN scripts.target_profession IS NULL THEN 2
        ELSE 3
      END,
      scripts.total_usages DESC NULLS LAST,
      scripts.created_at ASC
    LIMIT 1
  ) selected_script ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS active_variation_count
    FROM public.script_variations variations
    WHERE selected_script.id IS NOT NULL
      AND variations.script_id = selected_script.id
      AND variations.tenant_id = lead_base.tenant_id
      AND variations.active IS TRUE
  ) active_variations ON TRUE
  LEFT JOIN daily_ai_outbound
    ON daily_ai_outbound.tenant_id = lead_base.tenant_id
  LEFT JOIN LATERAL (
    WITH active_version AS (
      SELECT versions.id
      FROM public.guardian_config_versions versions
      WHERE versions.tenant_id = lead_base.tenant_id
        AND versions.status = 'ACTIVE'
      ORDER BY versions.version_number DESC
      LIMIT 1
    )
    SELECT
      MAX(CASE WHEN var_values.variable_key = 'lead_relevance_review_min' THEN (var_values.value #>> '{}')::NUMERIC END) AS review_min,
      MAX(CASE WHEN var_values.variable_key = 'low_relevance_action' THEN var_values.value #>> '{}' END) AS low_relevance_action,
      MAX(CASE WHEN var_values.variable_key = 'unknown_entity_action' THEN var_values.value #>> '{}' END) AS unknown_entity_action
    FROM active_version
    JOIN public.tenant_guardian_variable_values var_values
      ON var_values.config_version_id = active_version.id
     AND var_values.tenant_id = lead_base.tenant_id
     AND var_values.guardian_key = 'G02_LEAD_RELEVANCE'
  ) g02 ON TRUE
),
reasoned AS (
  SELECT
    classified.*,
    (
      classified.relevance_status IN (
        'BLOCK_LOW_RELEVANCE',
        'BLOCK_ENTITY_MISMATCH',
        'COMMERCIAL_LEAD_SKIPPED',
        'DISQUALIFIED',
        'INVALID',
        'INVALID_NUMBER',
        'IRRELEVANT',
        'LOW_RELEVANCE',
        'NOT_RELEVANT',
        'REJECTED',
        'UNQUALIFIED',
        'WEAK'
      )
      OR (
        classified.entity_type = 'UNKNOWN'
        AND upper(classified.g02_unknown_entity_action) = 'BLOCK'
      )
      OR (
        classified.normalized_relevance_score IS NOT NULL
        AND classified.normalized_relevance_score < classified.g02_review_min
        AND upper(classified.g02_low_relevance_action) = 'BLOCK'
      )
      OR (
        classified.normalized_relevance_score IS NULL
        AND classified.normalized_fit_score IS NOT NULL
        AND classified.normalized_fit_score < classified.g02_review_min
        AND upper(classified.g02_low_relevance_action) = 'BLOCK'
      )
    ) AS would_block_by_g02_relevance,
    (
      classified.script_target_profession IN ('DOCTOR', 'LAWYER', 'DENTIST')
      AND (
        classified.lead_name_lower LIKE '%pousada%'
        OR classified.lead_name_lower LIKE '%hotel%'
        OR classified.lead_name_lower LIKE '%chacara%'
        OR classified.lead_name_lower LIKE '%chácara%'
        OR classified.lead_name_lower LIKE '%variedades%'
        OR classified.lead_name_lower LIKE '%artesanato%'
        OR classified.lead_name_lower LIKE '%imports%'
        OR classified.lead_name_lower LIKE '%turismo%'
        OR classified.lead_name_lower LIKE '%parque%'
        OR classified.lead_name_lower LIKE '%restaurante%'
        OR classified.lead_name_lower LIKE '%grill%'
        OR classified.lead_name_lower LIKE '%picanha%'
        OR classified.lead_name_lower LIKE '%tintas%'
        OR classified.lead_name_lower LIKE '%loja%'
        OR classified.lead_name_lower LIKE '%loteamento%'
        OR classified.lead_name_lower LIKE '%auto%'
        OR classified.lead_name_lower LIKE '%mecanica%'
        OR classified.lead_name_lower LIKE '%mecânica%'
        OR classified.lead_name_lower LIKE '%oficina%'
        OR classified.lead_name_lower LIKE '%barbearia%'
        OR classified.lead_name_lower LIKE '%salao%'
        OR classified.lead_name_lower LIKE '%salão%'
        OR classified.lead_name_lower LIKE '%construcao%'
        OR classified.lead_name_lower LIKE '%construção%'
        OR classified.lead_name_lower LIKE '%distribuidora%'
        OR classified.lead_name_lower LIKE '%mercado%'
        OR classified.lead_name_lower LIKE '%supermercado%'
        OR classified.lead_name_lower LIKE '%padaria%'
        OR classified.lead_name_lower LIKE '%confeitaria%'
      )
    ) AS commercial_name_for_individual_script
  FROM classified
),
finalized AS (
  SELECT
    reasoned.*,
    CASE
      WHEN reasoned.deleted_at IS NOT NULL THEN 'DELETED'
      WHEN reasoned.lead_status <> 'ENRICHED' THEN 'LEAD_NOT_ENRICHED'
      WHEN reasoned.contacted_at IS NOT NULL THEN 'ALREADY_CONTACTED'
      WHEN reasoned.has_sent_first_touch_queue THEN 'ALREADY_SENT'
      WHEN reasoned.has_active_first_touch_queue THEN 'FIRST_TOUCH_PENDING'
      WHEN reasoned.has_failed_first_touch_queue THEN 'FIRST_TOUCH_FAILED'
      WHEN reasoned.has_prior_guardian_block THEN 'PREVIOUSLY_GUARDIAN_BLOCKED'
      WHEN reasoned.queued_first_touch_at IS NOT NULL THEN 'FIRST_TOUCH_ALREADY_MARKED'
      WHEN NOT reasoned.has_whatsapp THEN 'MISSING_WHATSAPP'
      WHEN NOT reasoned.has_mobile_whatsapp_shape
        OR reasoned.whatsapp_valid IS FALSE
        OR reasoned.phone_validation_status IN (
          'FIXED_LINE',
          'INVALID',
          'INVALID_NUMBER',
          'LANDLINE',
          'NO_WHATSAPP',
          'NOT_MOBILE',
          'OPTED_OUT',
          'UNREACHABLE'
        ) THEN 'INVALID_MOBILE'
      WHEN reasoned.has_optout THEN 'OPTED_OUT'
      WHEN reasoned.campaign_id IS NULL THEN 'MISSING_CAMPAIGN'
      WHEN reasoned.campaign_status IS NULL OR reasoned.campaign_status <> 'ACTIVE' THEN 'CAMPAIGN_INACTIVE_OR_MISSING'
      WHEN reasoned.current_brt_hour < reasoned.campaign_hour_window_start
        OR reasoned.current_brt_hour >= reasoned.campaign_hour_window_end THEN 'OUTSIDE_CAMPAIGN_WINDOW'
      WHEN reasoned.tenant_ai_outbound_today >= reasoned.campaign_daily_limit THEN 'DAILY_LIMIT_REACHED'
      WHEN reasoned.explicit_script_id IS NOT NULL AND (
        reasoned.explicit_script_status <> 'ACTIVE'
        OR reasoned.explicit_script_status IS NULL
      ) THEN 'SCRIPT_INACTIVE_OR_MISSING'
      WHEN reasoned.explicit_script_id IS NOT NULL
        AND reasoned.explicit_script_category <> 'APPROACH' THEN 'SCRIPT_NOT_APPROACH'
      WHEN reasoned.script_id IS NULL THEN 'MISSING_ACTIVE_SCRIPT'
      WHEN reasoned.script_target_profession IS NOT NULL
        AND reasoned.campaign_profession IS NOT NULL
        AND reasoned.script_target_profession <> reasoned.campaign_profession THEN 'SCRIPT_PROFESSION_MISMATCH'
      WHEN reasoned.active_variation_count <= 0 THEN 'MISSING_ACTIVE_VARIATION'
      WHEN reasoned.commercial_name_for_individual_script THEN 'COMMERCIAL_NAME_FOR_INDIVIDUAL_SCRIPT'
      WHEN reasoned.would_block_by_g02_relevance THEN 'GUARDIAN_RELEVANCE_BLOCK'
      ELSE 'ELIGIBLE'
    END AS eligibility_reason
  FROM reasoned
)
SELECT
  tenant_id,
  lead_id,
  campaign_id,
  campaign_name,
  campaign_status,
  campaign_profession,
  script_id,
  script_name,
  script_status,
  script_category,
  script_target_profession,
  script_selection_source,
  lead_status,
  lead_source,
  created_at,
  updated_at,
  deleted_at,
  contacted_at,
  queued_first_touch_at,
  has_whatsapp,
  whatsapp_digits,
  has_mobile_whatsapp_shape,
  whatsapp_valid,
  phone_validation_status,
  phone_validation_confidence,
  relevance_status,
  relevance_score,
  fit_score,
  normalized_relevance_score,
  normalized_fit_score,
  entity_type,
  identity_confidence,
  active_variation_count,
  tenant_ai_outbound_today,
  campaign_daily_limit,
  current_brt_hour,
  campaign_hour_window_start,
  campaign_hour_window_end,
  has_optout,
  has_active_first_touch_queue,
  has_failed_first_touch_queue,
  has_sent_first_touch_queue,
  has_prior_guardian_block,
  would_block_by_g02_relevance,
  commercial_name_for_individual_script,
  eligibility_reason,
  eligibility_reason = 'ELIGIBLE' AS is_eligible_now
FROM finalized;

COMMENT ON VIEW public.first_touch_lead_eligibility IS
  'Canonical read-only classification for active first-touch eligibility. Used by monitoring and send-messages so panels and workers count candidates the same way.';

GRANT SELECT ON public.first_touch_lead_eligibility TO authenticated;

COMMIT;
