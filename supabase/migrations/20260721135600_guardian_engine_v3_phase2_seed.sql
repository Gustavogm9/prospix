-- Guardian Engine V3 - Phase 2 seed and read model.
-- This migration is additive and idempotent:
-- - Seeds guardian_definitions and guardian_variable_definitions.
-- - Creates one ACTIVE initial config version per tenant when none exists.
-- - Copies current production behavior into the initial tenant settings.
-- - Keeps new validators in OBSERVE until later rollout phases.
-- - Adds a read-only RPC for admin/API/runner config loading.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS pg_temp._guardian_phase2_definitions;
DROP TABLE IF EXISTS pg_temp._guardian_phase2_defaults;

CREATE TEMP TABLE _guardian_phase2_definitions (
  guardian_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  layer TEXT NOT NULL,
  execution_stage TEXT NOT NULL,
  function_scope TEXT NOT NULL,
  default_enabled BOOLEAN NOT NULL,
  default_mode TEXT NOT NULL,
  fail_policy TEXT NOT NULL,
  is_system_critical BOOLEAN NOT NULL,
  sort_order INTEGER NOT NULL,
  initial_enabled BOOLEAN NOT NULL,
  initial_mode TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _guardian_phase2_definitions (
  guardian_key,
  name,
  description,
  layer,
  execution_stage,
  function_scope,
  default_enabled,
  default_mode,
  fail_policy,
  is_system_critical,
  sort_order,
  initial_enabled,
  initial_mode
) VALUES
  ('G00_ENGINE_CONFIG', 'Configuration and versioning', 'Requires a valid active Guardian Engine configuration before runtime execution.', 'ADMIN', 'CONFIG_LOAD', 'shared', true, 'HARD_BLOCK', 'USE_LAST_KNOWN_GOOD_CONFIG', true, 0, true, 'HARD_BLOCK'),
  ('G01_INBOUND_IDEMPOTENCY', 'Inbound idempotency and aggregation', 'Prevents duplicate inbound processing and waits for fast inbound bursts to settle.', 'INBOUND', 'INBOUND_PRE_CLASSIFICATION', 'webhook-evolution', true, 'BLOCK', 'FAIL_CLOSED', false, 10, true, 'OBSERVE'),
  ('G02_LEAD_RELEVANCE', 'Evidence-based lead relevance', 'Requires sufficient evidence that the lead matches the campaign and script target.', 'LEAD', 'PRE_GENERATION', 'shared', true, 'BLOCK', 'FAIL_CLOSED', false, 20, true, 'OBSERVE'),
  ('G03_PHONE_ENTITY', 'Phone and entity validation', 'Blocks invalid, non-mobile, missing, or incompatible commercial entities before sending.', 'LEAD', 'PRE_SEND', 'send-messages', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 30, true, 'HARD_BLOCK'),
  ('G04_IDENTITY_PERSONALIZATION', 'Identity and personalization', 'Prevents unsafe use of names, titles, gendered terms, and business-like names.', 'IDENTITY', 'POST_GENERATION', 'shared', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 40, true, 'OBSERVE'),
  ('G05_CONVERSATION_STATE', 'Finite conversation state', 'Prevents invalid state transitions and automatic replies in closed or escalated conversations.', 'CONVERSATION_STATE', 'PRE_GENERATION', 'shared', true, 'BLOCK', 'FAIL_CLOSED', false, 50, true, 'OBSERVE'),
  ('G06_REFUSAL_CLOSURE', 'Refusal and closure', 'Closes AI handling when the lead refuses contact or asks to stop.', 'INBOUND', 'INBOUND_PRE_CLASSIFICATION', 'webhook-evolution', true, 'HARD_BLOCK', 'FAIL_CLOSED', false, 60, true, 'HARD_BLOCK'),
  ('G07_ANTI_LOOP', 'Semantic anti-loop', 'Escalates conversations that keep cycling without progress.', 'CONVERSATION_STATE', 'PRE_GENERATION', 'webhook-evolution', true, 'BLOCK', 'FAIL_CLOSED', false, 70, true, 'BLOCK'),
  ('G08_OBJECTION_FRAMEWORK', 'Objection framework', 'Applies the approved objection framework and tenant objection records when appropriate.', 'GENERATION', 'GENERATION', 'webhook-evolution', true, 'WARN', 'FAIL_OPEN', false, 80, true, 'WARN'),
  ('G09_QUALIFICATION', 'Consultative qualification', 'Keeps qualification consultative with one objective question per turn.', 'GENERATION', 'GENERATION', 'webhook-evolution', true, 'WARN', 'FAIL_OPEN', false, 90, true, 'WARN'),
  ('G10_AGENDA', 'Agenda and closing', 'Prevents premature, unsupported, weekend, or fake scheduling invitations.', 'GENERATION', 'POST_GENERATION', 'shared', true, 'BLOCK', 'FAIL_CLOSED', false, 100, true, 'WARN'),
  ('G11_SHORT_RESPONSES', 'Short responses', 'Keeps outbound WhatsApp replies short, natural, and low-density.', 'POST_GENERATION', 'POST_GENERATION', 'shared', true, 'BLOCK', 'FAIL_CLOSED', false, 110, true, 'WARN'),
  ('G12_STRUCTURED_OUTPUT', 'Structured output', 'Requires a valid candidate payload before operational use.', 'POST_GENERATION', 'POST_GENERATION', 'shared', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 120, true, 'OBSERVE'),
  ('G13_PLACEHOLDER_LEAK', 'Placeholder leak', 'Detects leaked placeholders and unsubstituted template variables.', 'POST_GENERATION', 'POST_GENERATION', 'shared', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 130, true, 'OBSERVE'),
  ('G14_INTERNAL_LEAK', 'Internal structure leak', 'Detects prompts, ids, table names, JSON, and internal implementation terms in user-visible text.', 'POST_GENERATION', 'POST_GENERATION', 'shared', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 140, true, 'OBSERVE'),
  ('G15_PROMPT_INJECTION', 'Adversarial instruction', 'Detects attempts to override rules, extract prompts, or request internal data.', 'INBOUND', 'INBOUND_PRE_CLASSIFICATION', 'webhook-evolution', true, 'BLOCK', 'FAIL_CLOSED', false, 150, true, 'OBSERVE'),
  ('G16_SEMANTIC_SCOPE', 'Semantic scope', 'Blocks unsupported claims, off-script topics, and unanswered user questions.', 'POST_GENERATION', 'POST_GENERATION', 'shared', true, 'BLOCK', 'FAIL_CLOSED', false, 160, true, 'OBSERVE'),
  ('G17_NATURALNESS', 'Controlled naturalness', 'Detects robotic wording, repeated openers, excess enthusiasm, and unsafe automation disclosure.', 'POST_GENERATION', 'POST_GENERATION', 'shared', true, 'WARN', 'FAIL_CLOSED', false, 170, true, 'OBSERVE'),
  ('G18_BUSINESS_HOURS', 'Business hours and wake spread', 'Delays outbound work outside business windows and spreads morning backlog safely.', 'QUEUE', 'PRE_ENQUEUE', 'shared', true, 'BLOCK', 'FAIL_CLOSED', false, 180, true, 'BLOCK'),
  ('G19_GLOBAL_CADENCE', 'Global cadence', 'Controls send cadence by WhatsApp number state and global tenant throughput.', 'SEND', 'PRE_SEND', 'send-messages', true, 'BLOCK', 'FAIL_CLOSED', false, 190, true, 'BLOCK'),
  ('G20_CONTACT_CADENCE', 'Contact cadence', 'Controls per-contact spacing, follow-up count, and multi-contact load.', 'SEND', 'PRE_SEND', 'send-messages', true, 'BLOCK', 'FAIL_CLOSED', false, 200, true, 'OBSERVE'),
  ('G21_CONCURRENCY_LOCK', 'Concurrency lock', 'Prevents duplicate sends through tenant and conversation locks.', 'SEND', 'PRE_SEND', 'send-messages', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 210, true, 'HARD_BLOCK'),
  ('G22_SEND_INTEGRITY', 'Send integrity and errors', 'Classifies send failures, retries transient errors, and suspends on critical connection failures.', 'INTEGRITY', 'POST_SEND_ERROR', 'send-messages', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 220, true, 'HARD_BLOCK'),
  ('G23_OBSERVABILITY', 'Observability and traceability', 'Requires decisions, evidence, hashes, and redaction for traceable Guardian operations.', 'OBSERVABILITY', 'ALL_STAGES', 'shared', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 230, true, 'HARD_BLOCK'),
  ('G24_ADMIN_CHANGE_CONTROL', 'Admin change control', 'Requires drafts, validation, simulation, audit reason, and rollback for dangerous changes.', 'ADMIN', 'ADMIN_VALIDATE', 'admin', true, 'HARD_BLOCK', 'FAIL_CLOSED', true, 240, true, 'HARD_BLOCK');

CREATE TEMP TABLE _guardian_phase2_defaults (
  guardian_key TEXT PRIMARY KEY,
  default_settings JSONB NOT NULL
) ON COMMIT DROP;

INSERT INTO _guardian_phase2_defaults (guardian_key, default_settings) VALUES
  ('G00_ENGINE_CONFIG', $json${
    "require_active_config": true,
    "allow_runtime_without_config": false,
    "use_last_known_good_config": true,
    "config_cache_ttl_seconds": 60,
    "config_hash_required": true,
    "draft_activation_requires_simulation": true,
    "activation_requires_audit_reason": true
  }$json$::jsonb),
  ('G01_INBOUND_IDEMPOTENCY', $json${
    "inbound_dedup_window_hours": 24,
    "same_text_hash_window_minutes": 10,
    "quiet_window_min_seconds": 12,
    "quiet_window_max_seconds": 25,
    "aggregate_burst_messages": true,
    "max_aggregate_window_seconds": 45,
    "ignore_duplicate_inbound": true
  }$json$::jsonb),
  ('G02_LEAD_RELEVANCE', $json${
    "lead_relevance_allow_min": 0.85,
    "lead_relevance_review_min": 0.70,
    "required_evidence_count": 2,
    "profession_match_min": 0.80,
    "source_confidence_min": 0.75,
    "identity_person_score_min": 0.75,
    "commercial_token_penalty": 0.25,
    "hard_disqualifier_penalty": 0.40,
    "unknown_entity_action": "BLOCK",
    "low_relevance_action": "BLOCK",
    "score_weights": {
      "profession_match_score": 0.35,
      "phone_confidence_score": 0.20,
      "identity_person_score": 0.15,
      "geo_or_market_fit_score": 0.10,
      "source_freshness_score": 0.10,
      "name_confidence": 0.10,
      "commercial_token_penalty": -0.25,
      "hard_disqualifier_penalty": -0.40
    }
  }$json$::jsonb),
  ('G03_PHONE_ENTITY', $json${
    "country_allowed": ["BR"],
    "require_e164": true,
    "e164_regex": "^\\+55[1-9]{2}9\\d{8}$",
    "legacy_br_mobile_regex": "^55\\d{2}9\\d{8}$",
    "accept_fixed_line": false,
    "accept_unknown_type": false,
    "phone_validation_confidence_min": 0.95,
    "commercial_blacklist_enabled": true,
    "commercial_blacklist_terms": [
      "pousada",
      "hotel",
      "ch\\u00e1cara",
      "chacara",
      "variedades",
      "artesanato",
      "imports",
      "turismo",
      "parque",
      "restaurante",
      "grill",
      "picanha",
      "tintas",
      "loja",
      "loteamento",
      "auto",
      "mec\\u00e2nica",
      "mecanica",
      "oficina",
      "barbearia",
      "sal\\u00e3o",
      "salao",
      "constru\\u00e7\\u00e3o",
      "construcao",
      "distribuidora",
      "mercado",
      "supermercado",
      "padaria",
      "confeitaria"
    ]
  }$json$::jsonb),
  ('G04_IDENTITY_PERSONALIZATION', $json${
    "allow_name_use": true,
    "name_confidence_min": 0.90,
    "allow_title_use": true,
    "title_verified_required": true,
    "allow_gendered_terms": false,
    "gender_confidence_min": 0.98,
    "gender_source_required": "EXPLICIT",
    "fallback_greeting": "Oi, tudo bem?",
    "forbidden_unverified_titles": ["Dr.", "Dra.", "Doutor", "Doutora", "Sr.", "Sra.", "Senhor", "Senhora"],
    "block_wrong_name": true,
    "block_business_like_name": true
  }$json$::jsonb),
  ('G05_CONVERSATION_STATE', $json${
    "allowed_states": ["NEW", "ELIGIBLE", "OPENING_READY", "OPENING_SENT", "AWAITING_REPLY", "ENGAGED", "QUALIFYING", "OBJECTION_HANDLING", "AGENDA_ELIGIBLE", "SCHEDULED", "CLOSED", "ESCALATED", "BLOCKED"],
    "transition_map": {
      "NEW": ["ELIGIBLE"],
      "ELIGIBLE": ["OPENING_READY"],
      "OPENING_READY": ["OPENING_SENT"],
      "OPENING_SENT": ["AWAITING_REPLY"],
      "AWAITING_REPLY": ["ENGAGED", "CLOSED", "ESCALATED"],
      "ENGAGED": ["QUALIFYING", "OBJECTION_HANDLING", "AGENDA_ELIGIBLE", "CLOSED", "ESCALATED"],
      "QUALIFYING": ["ENGAGED", "AGENDA_ELIGIBLE", "CLOSED", "ESCALATED"],
      "OBJECTION_HANDLING": ["ENGAGED", "QUALIFYING", "CLOSED", "ESCALATED"],
      "AGENDA_ELIGIBLE": ["SCHEDULED", "ENGAGED", "CLOSED", "ESCALATED"],
      "SCHEDULED": ["CLOSED"],
      "CLOSED": [],
      "ESCALATED": [],
      "BLOCKED": []
    },
    "invalid_transition_action": "BLOCK",
    "closed_conversation_action": "BLOCK",
    "escalated_conversation_action": "BLOCK",
    "scheduled_conversation_auto_reply_allowed": false,
    "max_state_age_hours": 720
  }$json$::jsonb),
  ('G06_REFUSAL_CLOSURE', $json${
    "intent_block_values": ["NOT_INTERESTED"],
    "confidence_min": 0.70,
    "set_ai_handling_false": true,
    "set_conversation_status": "CLOSED",
    "create_closing_message": true,
    "closing_delay_seconds": 5,
    "idempotency_key_prefix": "closure_"
  }$json$::jsonb),
  ('G07_ANTI_LOOP', $json${
    "max_message_count": 10,
    "max_bot_turns_without_progress": 5,
    "semantic_similarity_max": 0.82,
    "unresolved_user_questions_max": 2,
    "same_question_repeat_max": 2,
    "escalate_on_loop": true,
    "set_ai_handling_false": true,
    "set_conversation_status": "ESCALATED"
  }$json$::jsonb),
  ('G08_OBJECTION_FRAMEWORK', $json${
    "enabled": true,
    "trigger_intents": ["OBJECTION"],
    "framework": "LDA",
    "max_objection_turns": 2,
    "max_questions": 1,
    "use_custom_objections_table": true,
    "fallback_to_handoff_when_unknown": true
  }$json$::jsonb),
  ('G09_QUALIFICATION', $json${
    "enabled": true,
    "trigger_intents": ["INTERESTED", "QUESTION"],
    "max_questions_total": 1,
    "answer_user_question_first": true,
    "qualification_depth_per_turn": 1,
    "forbid_question_stack": true,
    "handoff_when_unanswerable": true
  }$json$::jsonb),
  ('G10_AGENDA', $json${
    "allow_schedule_invite_when_user_requests": true,
    "allow_schedule_invite_when_pain_clear": true,
    "pain_clarity_min": 0.80,
    "forbid_weekends": true,
    "allowed_weekdays": [1, 2, 3, 4, 5],
    "meeting_duration_minutes": 15,
    "double_alternative_enabled": true,
    "max_time_options": 2,
    "forbid_fake_availability": true
  }$json$::jsonb),
  ('G11_SHORT_RESPONSES', $json${
    "max_bubbles": 2,
    "min_chars_per_bubble": 8,
    "max_chars_per_bubble": 220,
    "max_total_chars": 360,
    "max_sentences_per_bubble": 2,
    "max_questions_total": 1,
    "allow_bullets": false,
    "allow_markdown": false,
    "allow_long_explanation": false
  }$json$::jsonb),
  ('G12_STRUCTURED_OUTPUT', $json${
    "candidate_schema": {
      "type": "object",
      "required": ["messages", "intent", "used_name", "used_title", "used_gendered_term", "claims", "handoff_required"],
      "properties": {
        "messages": {
          "type": "array",
          "minItems": 1,
          "maxItems": 2,
          "items": { "type": "string", "minLength": 8, "maxLength": 220 }
        },
        "intent": {
          "type": "string",
          "enum": ["QUESTION", "INTERESTED", "OBJECTION", "SCHEDULED", "NOT_INTERESTED", "OTHER"]
        },
        "used_name": { "type": "boolean" },
        "used_title": { "type": "boolean" },
        "used_gendered_term": { "type": "boolean" },
        "claims": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["text", "evidence_id"],
            "properties": {
              "text": { "type": "string" },
              "evidence_id": { "type": "string" }
            }
          }
        },
        "handoff_required": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  }$json$::jsonb),
  ('G13_PLACEHOLDER_LEAK', $json${
    "block_regexes": ["\\[[^\\]]+\\]", "\\{\\{[^}]+\\}\\}", "<\\s*[a-zA-Z_][^>]{0,40}\\s*>", "\\$[A-Z_][A-Z0-9_]*", "%[A-Z_][A-Z0-9_]*%"],
    "block_examples": ["[nome]", "[cliente]", "{{first_name}}", "{{nome}}", "<cliente>", "$FIRST_NAME", "%NOME%"],
    "rewrite_once": true,
    "second_failure_action": "HARD_BLOCK"
  }$json$::jsonb),
  ('G14_INTERNAL_LEAK', $json${
    "blocked_terms_case_insensitive": ["system prompt", "developer message", "prompt interno", "tenant_id", "lead_id", "conversation_id", "classification.intent", "pending_outbound", "supabase", "edge function", "guardian_key", "guardiao interno", "json schema", "template interno", "variavel interna"],
    "block_code_like_payload": true,
    "block_json_visible_to_lead": true,
    "block_ids": true,
    "rewrite_once": true,
    "second_failure_action": "HARD_BLOCK"
  }$json$::jsonb),
  ('G15_PROMPT_INJECTION', $json${
    "injection_score_block_min": 0.60,
    "injection_score_warn_min": 0.40,
    "ignore_user_instruction_to_change_rules": true,
    "block_prompt_extraction": true,
    "block_roleplay_override": true,
    "block_tool_or_secret_request": true,
    "allowed_response_strategy": "SHORT_BOUNDARY_AND_RETURN_TO_CONTEXT"
  }$json$::jsonb),
  ('G16_SEMANTIC_SCOPE', $json${
    "allowed_sources": ["conversation_history", "lead_record", "script", "approved_objections", "approved_knowledge_base", "calendar_availability"],
    "unsupported_claims_max": 0,
    "parallel_subject_action": "BLOCK_OR_HANDOFF",
    "must_answer_user_question_first": true,
    "forbid_unapproved_numbers": true,
    "forbid_unapproved_promises": true,
    "forbid_external_facts_without_source": true
  }$json$::jsonb),
  ('G17_NATURALNESS', $json${
    "default_tone": "NEUTRAL_INFORMAL",
    "max_exclamation_marks": 1,
    "max_emoji_per_conversation_window": 1,
    "avoid_repeated_openers": true,
    "avoid_sales_cliches": true,
    "avoid_overexplaining": true,
    "avoid_robotic_disclosure_phrases": true,
    "forbid_false_human_identity_claim": true,
    "safe_automation_disclosure": "Sou um assistente do time e consigo te ajudar por aqui. Se fizer sentido, encaminho pro responsavel tambem."
  }$json$::jsonb),
  ('G18_BUSINESS_HOURS', $json${
    "timezone": "America/Sao_Paulo",
    "business_start": "08:00",
    "business_end": "20:00",
    "block_after_hour": 20,
    "block_before_hour": 8,
    "wake_spread_enabled": true,
    "wake_spread_start": "08:12",
    "wake_spread_end": "09:40",
    "wake_batch_max_per_10min": 2,
    "skip_weekends": true,
    "delay_reason_required": true,
    "outside_window_decision": "DELAY"
  }$json$::jsonb),
  ('G19_GLOBAL_CADENCE', $json${
    "states": {
      "COLD": {
        "min_global_delay_seconds": 20,
        "base_delay_min_seconds": 45,
        "base_delay_max_seconds": 120,
        "max_messages_per_minute": 2,
        "max_messages_per_hour": 45,
        "max_new_chats_per_hour": 3,
        "max_new_chats_per_day": 20
      },
      "NORMAL": {
        "min_global_delay_seconds": 12,
        "base_delay_min_seconds": 18,
        "base_delay_max_seconds": 45,
        "max_messages_per_minute": 3,
        "max_messages_per_hour": 90,
        "max_new_chats_per_hour": 6,
        "max_new_chats_per_day": 80
      },
      "HIGH_LOAD": {
        "min_global_delay_seconds": 15,
        "base_delay_min_seconds": 25,
        "base_delay_max_seconds": 70,
        "max_messages_per_minute": 3,
        "max_messages_per_hour": 90,
        "max_new_chats_per_hour": 0
      },
      "COOLDOWN": {
        "min_global_delay_seconds": 60,
        "base_delay_min_seconds": 120,
        "base_delay_max_seconds": 600,
        "max_messages_per_minute": 1,
        "max_messages_per_hour": 15,
        "max_new_chats_per_hour": 0
      }
    },
    "jitter_rules": {
      "roll_80_to_95_multiplier": 1.5,
      "roll_above_95_multiplier": 2.5
    },
    "limit_decision": "DELAY"
  }$json$::jsonb),
  ('G20_CONTACT_CADENCE', $json${
    "first_response_delay_min_seconds": 18,
    "first_response_delay_max_seconds": 120,
    "inter_bubble_delay_min_seconds": 8,
    "inter_bubble_delay_max_seconds": 28,
    "same_lead_gap_without_reply_min_hours": 24,
    "same_lead_gap_without_reply_max_hours": 72,
    "max_followups_without_reply": 2,
    "active_contacts_30m_max": 6,
    "priority_order": ["RECENT_INBOUND", "SCHEDULING_FLOW", "FOLLOWUP_ALLOWED", "NEW_ELIGIBLE_LEAD", "RETRY_NON_CRITICAL"]
  }$json$::jsonb),
  ('G21_CONCURRENCY_LOCK', $json${
    "tenant_lock_enabled": true,
    "conversation_lock_enabled": true,
    "tenant_lock_ttl_seconds": 120,
    "conversation_lock_ttl_seconds": 120,
    "stale_lock_recovery_seconds": 180,
    "max_worker_batch_size_cold": 1,
    "max_worker_batch_size_normal": 2,
    "max_worker_batch_size_high_load": 1,
    "abort_on_lock_failure": true
  }$json$::jsonb),
  ('G22_SEND_INTEGRITY', $json${
    "critical_errors": ["401", "conflict", "device_removed", "stream errored"],
    "transient_errors": ["timeout", "429", "500", "502", "503", "504"],
    "retry_max": 2,
    "retry_backoff_seconds": [60, 300],
    "critical_error_threshold": 1,
    "same_error_burst_threshold": 3,
    "same_error_burst_window_minutes": 10,
    "suspend_on_critical": true,
    "notify_owner": true,
    "create_operational_alert": true
  }$json$::jsonb),
  ('G23_OBSERVABILITY', $json${
    "log_all_guardian_decisions": true,
    "log_pass_decisions": true,
    "log_block_decisions": true,
    "redact_message_payloads": true,
    "store_hashes": true,
    "store_evidence_json": true,
    "retention_days": 180,
    "admin_filterable_logs": true
  }$json$::jsonb),
  ('G24_ADMIN_CHANGE_CONTROL', $json${
    "all_changes_create_draft": true,
    "direct_live_edit_allowed": false,
    "activation_requires_simulation": true,
    "activation_requires_audit_reason": true,
    "critical_guardian_disable_requires_owner": true,
    "break_glass_requires_reason": true,
    "break_glass_auto_expire_minutes": 15,
    "rollback_enabled": true,
    "rollback_keeps_audit": true
  }$json$::jsonb);

INSERT INTO public.guardian_definitions (
  guardian_key,
  name,
  description,
  layer,
  execution_stage,
  function_scope,
  default_enabled,
  default_mode,
  fail_policy,
  is_system_critical,
  sort_order
)
SELECT
  guardian_key,
  name,
  description,
  layer,
  execution_stage,
  function_scope,
  default_enabled,
  default_mode,
  fail_policy,
  is_system_critical,
  sort_order
FROM _guardian_phase2_definitions
ON CONFLICT (guardian_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  layer = EXCLUDED.layer,
  execution_stage = EXCLUDED.execution_stage,
  function_scope = EXCLUDED.function_scope,
  default_enabled = EXCLUDED.default_enabled,
  default_mode = EXCLUDED.default_mode,
  fail_policy = EXCLUDED.fail_policy,
  is_system_critical = EXCLUDED.is_system_critical,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO public.guardian_variable_definitions (
  guardian_key,
  variable_key,
  label,
  description,
  value_type,
  default_value,
  min_value,
  max_value,
  allowed_values,
  validation_regex,
  unit,
  is_required,
  is_sensitive,
  requires_confirmation,
  requires_owner
)
SELECT
  defaults.guardian_key,
  vars.key AS variable_key,
  initcap(replace(vars.key, '_', ' ')) AS label,
  'Seeded Phase 2 setting for ' || defaults.guardian_key || '.' || vars.key AS description,
  CASE
    WHEN vars.key LIKE '%regex%' THEN 'regex'
    WHEN vars.key LIKE '%time%' OR vars.value #>> '{}' ~ '^[0-2][0-9]:[0-5][0-9]$' THEN 'time'
    WHEN vars.key LIKE '%seconds' OR vars.key LIKE '%ttl_seconds' OR vars.key LIKE '%delay_seconds' THEN 'duration_seconds'
    WHEN vars.key LIKE '%action'
      OR vars.key IN (
        'framework',
        'gender_source_required',
        'allowed_response_strategy',
        'parallel_subject_action',
        'default_tone',
        'outside_window_decision',
        'limit_decision',
        'second_failure_action',
        'set_conversation_status'
      ) THEN 'enum'
    WHEN jsonb_typeof(vars.value) = 'boolean' THEN 'boolean'
    WHEN jsonb_typeof(vars.value) = 'number' AND vars.value::text ~ '^-?[0-9]+$' THEN 'integer'
    WHEN jsonb_typeof(vars.value) = 'number' THEN 'decimal'
    WHEN jsonb_typeof(vars.value) = 'array'
      AND vars.key IN (
        'allowed_sources',
        'blocked_terms_case_insensitive',
        'block_examples',
        'country_allowed',
        'critical_errors',
        'forbidden_unverified_titles',
        'intent_block_values',
        'priority_order',
        'transient_errors',
        'trigger_intents'
      ) THEN 'string_array'
    WHEN jsonb_typeof(vars.value) IN ('array', 'object') THEN 'json'
    ELSE 'string'
  END AS value_type,
  vars.value AS default_value,
  CASE
    WHEN vars.key LIKE '%confidence%' OR vars.key LIKE '%score%' OR vars.key LIKE '%similarity%' THEN 0
    WHEN jsonb_typeof(vars.value) = 'number' THEN 0
    ELSE NULL
  END AS min_value,
  CASE
    WHEN vars.key LIKE '%confidence%' OR vars.key LIKE '%score%' OR vars.key LIKE '%similarity%' THEN 1
    WHEN vars.key = 'max_total_chars' THEN 2000
    WHEN vars.key LIKE '%per_minute' THEN 60
    WHEN vars.key LIKE '%per_hour' THEN 1000
    WHEN vars.key LIKE '%per_day' THEN 10000
    WHEN vars.key LIKE '%ttl_seconds' THEN 3600
    ELSE NULL
  END AS max_value,
  CASE
    WHEN vars.key IN ('unknown_entity_action', 'low_relevance_action', 'invalid_transition_action', 'closed_conversation_action', 'escalated_conversation_action') THEN '["BLOCK", "ESCALATE", "WARN", "OBSERVE"]'::jsonb
    WHEN vars.key IN ('outside_window_decision', 'limit_decision') THEN '["DELAY", "BLOCK"]'::jsonb
    WHEN vars.key = 'second_failure_action' THEN '["BLOCK", "HARD_BLOCK", "ESCALATE"]'::jsonb
    WHEN vars.key = 'set_conversation_status' THEN '["CLOSED", "ESCALATED", "BLOCKED"]'::jsonb
    WHEN vars.key = 'framework' THEN '["LDA"]'::jsonb
    WHEN vars.key = 'gender_source_required' THEN '["EXPLICIT"]'::jsonb
    WHEN vars.key = 'allowed_response_strategy' THEN '["SHORT_BOUNDARY_AND_RETURN_TO_CONTEXT"]'::jsonb
    WHEN vars.key = 'parallel_subject_action' THEN '["BLOCK_OR_HANDOFF", "BLOCK", "ESCALATE"]'::jsonb
    WHEN vars.key = 'default_tone' THEN '["NEUTRAL_INFORMAL", "FORMAL", "DIRECT"]'::jsonb
    ELSE NULL
  END AS allowed_values,
  CASE
    WHEN vars.key LIKE '%regex%' THEN vars.value #>> '{}'
    ELSE NULL
  END AS validation_regex,
  CASE
    WHEN vars.key LIKE '%hours%' THEN 'hours'
    WHEN vars.key LIKE '%minutes%' THEN 'minutes'
    WHEN vars.key LIKE '%seconds%' THEN 'seconds'
    WHEN vars.key LIKE '%chars%' THEN 'characters'
    WHEN vars.key LIKE '%score%' OR vars.key LIKE '%confidence%' OR vars.key LIKE '%similarity%' THEN 'ratio'
    ELSE NULL
  END AS unit,
  true AS is_required,
  false AS is_sensitive,
  (
    vars.key LIKE '%critical%'
    OR vars.key LIKE '%block%'
    OR vars.key LIKE '%hard%'
    OR vars.key LIKE '%regex%'
    OR vars.key LIKE '%policy%'
    OR vars.key LIKE '%requires%'
    OR defs.is_system_critical
  ) AS requires_confirmation,
  (
    defs.is_system_critical
    AND (
      vars.key LIKE '%critical%'
      OR vars.key LIKE '%block%'
      OR vars.key LIKE '%regex%'
      OR vars.key LIKE '%requires%'
      OR vars.key LIKE '%direct_live_edit%'
      OR vars.key LIKE '%break_glass%'
    )
  ) AS requires_owner
FROM _guardian_phase2_defaults defaults
JOIN _guardian_phase2_definitions defs
  ON defs.guardian_key = defaults.guardian_key
CROSS JOIN LATERAL jsonb_each(defaults.default_settings) AS vars(key, value)
ON CONFLICT (guardian_key, variable_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type,
  default_value = EXCLUDED.default_value,
  min_value = EXCLUDED.min_value,
  max_value = EXCLUDED.max_value,
  allowed_values = EXCLUDED.allowed_values,
  validation_regex = EXCLUDED.validation_regex,
  unit = EXCLUDED.unit,
  is_required = EXCLUDED.is_required,
  is_sensitive = EXCLUDED.is_sensitive,
  requires_confirmation = EXCLUDED.requires_confirmation,
  requires_owner = EXCLUDED.requires_owner,
  updated_at = now();

WITH canonical_config AS (
  SELECT
    'sha256:' || encode(
      digest(
        jsonb_build_object(
          'phase', 'guardian_engine_v3_phase2',
          'definitions', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'guardian_key', guardian_key,
                'default_enabled', default_enabled,
                'default_mode', default_mode,
                'fail_policy', fail_policy,
                'is_system_critical', is_system_critical,
                'sort_order', sort_order,
                'initial_enabled', initial_enabled,
                'initial_mode', initial_mode
              )
              ORDER BY guardian_key
            )
            FROM _guardian_phase2_definitions
          ),
          'defaults', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'guardian_key', guardian_key,
                'default_settings', default_settings
              )
              ORDER BY guardian_key
            )
            FROM _guardian_phase2_defaults
          )
        )::text::bytea,
        'sha256'
      ),
      'hex'
    ) AS config_hash
),
tenant_targets AS (
  SELECT
    tenants.id AS tenant_id,
    COALESCE(max(existing.version_number), 0) + 1 AS next_version_number
  FROM public.tenants tenants
  LEFT JOIN public.guardian_config_versions existing
    ON existing.tenant_id = tenants.id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.guardian_config_versions active
    WHERE active.tenant_id = tenants.id
      AND active.status = 'ACTIVE'
  )
  GROUP BY tenants.id
),
created_versions AS (
  INSERT INTO public.guardian_config_versions (
    tenant_id,
    version_number,
    status,
    config_hash,
    activated_at,
    notes
  )
  SELECT
    tenant_targets.tenant_id,
    tenant_targets.next_version_number,
    'ACTIVE',
    canonical_config.config_hash,
    now(),
    'Guardian Engine V3 Phase 2 initial active config seeded from current production behavior. New validators remain in OBSERVE.'
  FROM tenant_targets
  CROSS JOIN canonical_config
  RETURNING id, tenant_id
)
INSERT INTO public.guardian_admin_audit_log (
  tenant_id,
  action,
  config_version_id,
  reason
)
SELECT
  tenant_id,
  'ACTIVATE_VERSION',
  id,
  'Phase 2 migration created initial ACTIVE Guardian Engine config.'
FROM created_versions;

INSERT INTO public.tenant_guardian_settings (
  tenant_id,
  config_version_id,
  guardian_key,
  enabled,
  mode,
  fail_policy,
  sort_order
)
SELECT
  active_versions.tenant_id,
  active_versions.id AS config_version_id,
  defs.guardian_key,
  defs.initial_enabled,
  defs.initial_mode,
  defs.fail_policy,
  defs.sort_order
FROM public.guardian_config_versions active_versions
CROSS JOIN _guardian_phase2_definitions defs
WHERE active_versions.status = 'ACTIVE'
ON CONFLICT (tenant_id, config_version_id, guardian_key) DO NOTHING;

INSERT INTO public.tenant_guardian_variable_values (
  tenant_id,
  config_version_id,
  guardian_key,
  variable_key,
  value
)
SELECT
  settings.tenant_id,
  settings.config_version_id,
  variable_defs.guardian_key,
  variable_defs.variable_key,
  variable_defs.default_value
FROM public.tenant_guardian_settings settings
JOIN public.guardian_variable_definitions variable_defs
  ON variable_defs.guardian_key = settings.guardian_key
ON CONFLICT (tenant_id, config_version_id, guardian_key, variable_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_guardian_active_config(p_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH target_tenant AS (
    SELECT COALESCE(p_tenant_id, public.current_tenant_id()) AS tenant_id
  ),
  active_version AS (
    SELECT versions.*
    FROM public.guardian_config_versions versions
    JOIN target_tenant target
      ON target.tenant_id = versions.tenant_id
    WHERE versions.status = 'ACTIVE'
    ORDER BY versions.version_number DESC
    LIMIT 1
  ),
  draft_version AS (
    SELECT versions.*
    FROM public.guardian_config_versions versions
    JOIN target_tenant target
      ON target.tenant_id = versions.tenant_id
    WHERE versions.status = 'DRAFT'
    ORDER BY versions.version_number DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'tenant_id', active_version.tenant_id,
    'active_version', jsonb_build_object(
      'id', active_version.id,
      'version_number', active_version.version_number,
      'config_hash', active_version.config_hash,
      'activated_at', active_version.activated_at
    ),
    'draft_version', (
      SELECT CASE
        WHEN draft_version.id IS NULL THEN NULL::jsonb
        ELSE jsonb_build_object(
          'id', draft_version.id,
          'version_number', draft_version.version_number,
          'config_hash', draft_version.config_hash,
          'created_at', draft_version.created_at
        )
      END
      FROM draft_version
    ),
    'guardians', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'guardian_key', settings.guardian_key,
          'name', definitions.name,
          'description', definitions.description,
          'layer', definitions.layer,
          'execution_stage', definitions.execution_stage,
          'function_scope', definitions.function_scope,
          'enabled', settings.enabled,
          'mode', settings.mode,
          'fail_policy', settings.fail_policy,
          'is_system_critical', definitions.is_system_critical,
          'sort_order', settings.sort_order,
          'variables', (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'variable_key', variable_values.variable_key,
                  'label', variable_defs.label,
                  'description', variable_defs.description,
                  'value_type', variable_defs.value_type,
                  'value', variable_values.value,
                  'default_value', variable_defs.default_value,
                  'min_value', variable_defs.min_value,
                  'max_value', variable_defs.max_value,
                  'allowed_values', variable_defs.allowed_values,
                  'validation_regex', variable_defs.validation_regex,
                  'unit', variable_defs.unit,
                  'is_required', variable_defs.is_required,
                  'is_sensitive', variable_defs.is_sensitive,
                  'requires_confirmation', variable_defs.requires_confirmation,
                  'requires_owner', variable_defs.requires_owner
                )
                ORDER BY variable_values.variable_key
              ),
              '[]'::jsonb
            )
            FROM public.tenant_guardian_variable_values variable_values
            JOIN public.guardian_variable_definitions variable_defs
              ON variable_defs.guardian_key = variable_values.guardian_key
             AND variable_defs.variable_key = variable_values.variable_key
            WHERE variable_values.tenant_id = settings.tenant_id
              AND variable_values.config_version_id = settings.config_version_id
              AND variable_values.guardian_key = settings.guardian_key
          )
        )
        ORDER BY settings.sort_order, settings.guardian_key
      ),
      '[]'::jsonb
    )
  )
  FROM active_version
  LEFT JOIN public.tenant_guardian_settings settings
    ON settings.tenant_id = active_version.tenant_id
   AND settings.config_version_id = active_version.id
  LEFT JOIN public.guardian_definitions definitions
    ON definitions.guardian_key = settings.guardian_key
  GROUP BY
    active_version.id,
    active_version.tenant_id,
    active_version.version_number,
    active_version.config_hash,
    active_version.activated_at;
$$;

REVOKE ALL ON FUNCTION public.get_guardian_active_config(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guardian_active_config(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_guardian_active_config(UUID) TO service_role;

COMMENT ON FUNCTION public.get_guardian_active_config(UUID) IS
  'Returns the active Guardian Engine V3 config as JSON for admin/API/runner read paths. Security is enforced by caller RLS/service role.';
