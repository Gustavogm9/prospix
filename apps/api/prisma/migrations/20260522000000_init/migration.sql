-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CHURNING', 'CHURNED');

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ASSISTANT', 'GUILDS_ADMIN');

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('GUILDS_SHARED', 'TENANT_OWN');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Profession" AS ENUM ('DOCTOR', 'LAWYER', 'DENTIST', 'ENTREPRENEUR', 'ENGINEER', 'ARCHITECT', 'ACCOUNTANT', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('GOOGLE_MAPS', 'RECEITA_FEDERAL', 'CRM_SP', 'OAB_SP', 'CRO_SP', 'LINKEDIN', 'REFERRAL', 'LANDING_PAGE', 'MANUAL', 'IMPORTED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('CAPTURED', 'ENRICHED', 'CONTACTED', 'NO_RESPONSE', 'CONVERSING', 'QUALIFIED', 'MEETING_SCHEDULED', 'CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED', 'LOST_BEFORE_MEETING', 'OPTED_OUT', 'ARCHIVED', 'ESCALATED_HUMAN');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('AI', 'USER', 'LEAD');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'HAPPENED', 'NO_SHOW', 'RESCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingOutcome" AS ENUM ('CLOSED', 'SECOND_MEETING', 'NOT_INTERESTED', 'THINKING');

-- CreateEnum
CREATE TYPE "ScriptCategory" AS ENUM ('APPROACH', 'OBJECTION', 'EDUCATION', 'CLOSING', 'FOLLOW_UP', 'REFERRAL', 'REACTIVATION');

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'REFUNDED', 'WAIVED');

-- CreateEnum
CREATE TYPE "PromptType" AS ENUM ('SYSTEM', 'CLASSIFIER', 'GUARDRAIL_CORRECTIVE', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'WHATSAPP', 'EMAIL', 'SMS');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "TenantStatus" NOT NULL,
    "plan" "TenantPlan" NOT NULL,
    "segment" VARCHAR(64),
    "setup_paid_cents" INTEGER,
    "mrr_cents" INTEGER NOT NULL,
    "contract_signed_at" TIMESTAMPTZ,
    "go_live_at" TIMESTAMPTZ,
    "brand_logo_url" TEXT,
    "brand_primary_color" VARCHAR(7),
    "custom_domain" VARCHAR(255),
    "ai_voice_profile" JSONB,
    "whatsapp_warmup_day" INTEGER NOT NULL DEFAULT 1,
    "whatsapp_warmup_started_at" TIMESTAMPTZ,
    "high_value_areas" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_secrets" (
    "tenant_id" UUID NOT NULL,
    "evolution_base_url" TEXT,
    "evolution_instance_name" TEXT,
    "evolution_api_key_encrypted" TEXT,
    "evolution_webhook_secret" TEXT,
    "google_calendar_id" TEXT,
    "google_oauth_refresh_encrypted" TEXT,
    "google_oauth_scope" TEXT,
    "google_maps_api_key_encrypted" TEXT,
    "openai_api_key_encrypted" TEXT,
    "anthropic_api_key_encrypted" TEXT,
    "google_ai_api_key_encrypted" TEXT,
    "ai_provider" "AIProvider" NOT NULL DEFAULT 'GUILDS_SHARED',
    "twilio_account_sid_encrypted" TEXT,
    "twilio_auth_token_encrypted" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_secrets_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_ai_configs" (
    "tenant_id" UUID NOT NULL,
    "system_provider" VARCHAR(16),
    "system_model" VARCHAR(64),
    "classifier_provider" VARCHAR(16),
    "classifier_model" VARCHAR(64),
    "guardrail_provider" VARCHAR(16),
    "guardrail_model" VARCHAR(64),
    "fallback_chain" JSONB,
    "system_temperature" DECIMAL(3,2) NOT NULL DEFAULT 0.4,
    "classifier_temperature" DECIMAL(3,2) NOT NULL DEFAULT 0.0,
    "max_output_tokens" INTEGER NOT NULL DEFAULT 1024,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_ai_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_invitations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "created_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "used_by_user_id" UUID,
    "revoked_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "role" "UserRole" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "whatsapp" VARCHAR(20) NOT NULL,
    "susep" VARCHAR(64),
    "partner_code" VARCHAR(64),
    "partner_brand" VARCHAR(64),
    "city" VARCHAR(128),
    "bio" TEXT,
    "avatar_url" TEXT,
    "password_hash" TEXT,
    "preferences" JSONB,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "profession" "Profession" NOT NULL,
    "cities" TEXT[],
    "neighborhoods" TEXT[],
    "daily_limit" INTEGER NOT NULL DEFAULT 100,
    "hour_window_start" INTEGER NOT NULL DEFAULT 9,
    "hour_window_end" INTEGER NOT NULL DEFAULT 18,
    "active_script_id" UUID,
    "filters" JSONB,
    "total_captured" INTEGER NOT NULL DEFAULT 0,
    "total_conversing" INTEGER NOT NULL DEFAULT 0,
    "total_scheduled" INTEGER NOT NULL DEFAULT 0,
    "total_closed_won" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID,
    "source" "LeadSource" NOT NULL,
    "source_external_id" TEXT,
    "source_raw_data" JSONB,
    "name" VARCHAR(255),
    "profession" "Profession",
    "whatsapp" VARCHAR(20) NOT NULL,
    "whatsapp_valid" BOOLEAN,
    "email" VARCHAR(255),
    "address" JSONB,
    "age_estimate" INTEGER,
    "registration_number" VARCHAR(64),
    "partner_or_owner" BOOLEAN,
    "years_of_practice" INTEGER,
    "google_rating" DECIMAL(3,2),
    "google_reviews_count" INTEGER,
    "fit_score" DECIMAL(3,1),
    "status" "LeadStatus" NOT NULL DEFAULT 'CAPTURED',
    "pipeline_stage" VARCHAR(64),
    "metadata" JSONB,
    "tags" TEXT[],
    "contacted_at" TIMESTAMPTZ,
    "first_response_at" TIMESTAMPTZ,
    "qualified_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "author_id" UUID,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_profiles" (
    "lead_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "smoker" BOOLEAN,
    "physical_activity" TEXT,
    "weight_kg" DECIMAL(5,2),
    "height_cm" INTEGER,
    "bmi_calculated" DECIMAL(4,2),
    "pre_existing_diseases" TEXT,
    "continuous_medication" TEXT,
    "recent_surgery" BOOLEAN,
    "family_history" JSONB,
    "risk_category" VARCHAR(32),
    "estimated_premium_min_cents" INTEGER,
    "estimated_premium_max_cents" INTEGER,
    "collected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "ai_handling" BOOLEAN NOT NULL DEFAULT true,
    "script_id" UUID,
    "current_node_id" VARCHAR(64),
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ,
    "last_inbound_at" TIMESTAMPTZ,
    "last_outbound_at" TIMESTAMPTZ,
    "escalated_reason" VARCHAR(64),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "whatsapp_message_id" VARCHAR(128),
    "delivery_status" "MessageDeliveryStatus",
    "delivered_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,
    "failed_reason" TEXT,
    "llm_model" VARCHAR(64),
    "llm_tokens_input" INTEGER,
    "llm_tokens_output" INTEGER,
    "llm_cost_cents" INTEGER,
    "llm_latency_ms" INTEGER,
    "script_id" UUID,
    "script_variation_id" UUID,
    "script_node_id" VARCHAR(64),
    "intent_detected" VARCHAR(64),
    "intent_confidence" DECIMAL(3,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_outbound" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "failed_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_outbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "conversation_id" UUID,
    "google_event_id" VARCHAR(128),
    "scheduled_for" TIMESTAMPTZ NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "attendees" JSONB,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" "MeetingOutcome",
    "policy_value_cents" INTEGER,
    "commission_cents" INTEGER,
    "notes" TEXT,
    "referrals_collected" JSONB,
    "referrals_count" INTEGER NOT NULL DEFAULT 0,
    "rescheduled_from_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "outcome_marked_at" TIMESTAMPTZ,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scripts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cloned_from_template_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "category" "ScriptCategory" NOT NULL,
    "target_profession" "Profession",
    "status" "ScriptStatus" NOT NULL DEFAULT 'DRAFT',
    "flow" JSONB,
    "base_message" TEXT,
    "variables" TEXT[],
    "response_rate" DECIMAL(5,4),
    "conversion_rate" DECIMAL(5,4),
    "total_usages" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "script_variations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "script_id" UUID NOT NULL,
    "variant_letter" VARCHAR(2) NOT NULL,
    "message" TEXT NOT NULL,
    "weight" DECIMAL(3,2) NOT NULL DEFAULT 0.33,
    "total_sent" INTEGER NOT NULL DEFAULT 0,
    "total_responded" INTEGER NOT NULL DEFAULT 0,
    "total_converted" INTEGER NOT NULL DEFAULT 0,
    "response_rate" DECIMAL(5,4),
    "conversion_rate" DECIMAL(5,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "script_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "script_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "segment" VARCHAR(64) NOT NULL,
    "category" "ScriptCategory" NOT NULL,
    "target_profession" "Profession",
    "flow_template" JSONB NOT NULL,
    "base_message_template" TEXT,
    "variables" TEXT[],
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "script_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optouts" (
    "tenant_id" UUID NOT NULL,
    "whatsapp" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(128),
    "source" VARCHAR(32),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optouts_pkey" PRIMARY KEY ("tenant_id","whatsapp")
);

-- CreateTable
CREATE TABLE "tenant_usage" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_month" DATE NOT NULL,
    "llm_tokens_input" BIGINT NOT NULL DEFAULT 0,
    "llm_tokens_output" BIGINT NOT NULL DEFAULT 0,
    "llm_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_messages_sent" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "google_maps_calls" INTEGER NOT NULL DEFAULT 0,
    "google_maps_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "leads_captured_count" INTEGER NOT NULL DEFAULT 0,
    "conversations_started" INTEGER NOT NULL DEFAULT 0,
    "meetings_scheduled" INTEGER NOT NULL DEFAULT 0,
    "meetings_closed" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_billing" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_month" DATE NOT NULL,
    "mrr_cents" INTEGER NOT NULL,
    "excess_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ,
    "due_at" TIMESTAMPTZ NOT NULL,
    "invoice_url" TEXT,
    "payment_method" VARCHAR(32),
    "external_invoice_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "link" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "channels" "NotificationChannel"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "action" VARCHAR(128) NOT NULL,
    "target_type" VARCHAR(64),
    "target_id" VARCHAR(128),
    "payload" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "created_by_id" UUID,
    "prompt_type" "PromptType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template" TEXT NOT NULL,
    "variables_required" JSONB,
    "test_cases" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ,
    "deprecated_at" TIMESTAMPTZ,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" VARCHAR(128) NOT NULL,
    "tenant_id" UUID,
    "endpoint" VARCHAR(255) NOT NULL,
    "response_cache" JSONB,
    "status_code" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tenant_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "author_id" UUID,
    "content" TEXT NOT NULL,
    "category" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_custom_domain_key" ON "tenants"("custom_domain");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_segment_idx" ON "tenants"("segment");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invitations_code_key" ON "tenant_invitations"("code");

-- CreateIndex
CREATE INDEX "tenant_invitations_tenant_id_idx" ON "tenant_invitations"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_invitations_code_used_at_revoked_at_idx" ON "tenant_invitations"("code", "used_at", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_key" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_refresh_token_idx" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_status_idx" ON "campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_pipeline_stage_idx" ON "leads"("tenant_id", "pipeline_stage");

-- CreateIndex
CREATE INDEX "leads_tenant_id_fit_score_idx" ON "leads"("tenant_id", "fit_score" DESC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_created_at_idx" ON "leads"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leads_campaign_id_idx" ON "leads"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_whatsapp_key" ON "leads"("tenant_id", "whatsapp");

-- CreateIndex
CREATE INDEX "lead_notes_tenant_id_lead_id_idx" ON "lead_notes"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "health_profiles_tenant_id_idx" ON "health_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_idx" ON "conversations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_lead_id_idx" ON "conversations"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_whatsapp_message_id_key" ON "messages"("whatsapp_message_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_created_at_idx" ON "messages"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_whatsapp_message_id_idx" ON "messages"("whatsapp_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "pending_outbound_idempotency_key_key" ON "pending_outbound"("idempotency_key");

-- CreateIndex
CREATE INDEX "pending_outbound_scheduled_for_sent_at_idx" ON "pending_outbound"("scheduled_for", "sent_at");

-- CreateIndex
CREATE INDEX "pending_outbound_tenant_id_idx" ON "pending_outbound"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_google_event_id_key" ON "meetings"("google_event_id");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_scheduled_for_idx" ON "meetings"("tenant_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_status_idx" ON "meetings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "meetings_lead_id_idx" ON "meetings"("lead_id");

-- CreateIndex
CREATE INDEX "scripts_tenant_id_status_category_idx" ON "scripts"("tenant_id", "status", "category");

-- CreateIndex
CREATE INDEX "script_variations_tenant_id_idx" ON "script_variations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "script_variations_script_id_variant_letter_key" ON "script_variations"("script_id", "variant_letter");

-- CreateIndex
CREATE INDEX "script_templates_segment_active_idx" ON "script_templates"("segment", "active");

-- CreateIndex
CREATE INDEX "lead_events_tenant_id_lead_id_created_at_idx" ON "lead_events"("tenant_id", "lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lead_events_event_type_idx" ON "lead_events"("event_type");

-- CreateIndex
CREATE INDEX "optouts_tenant_id_idx" ON "optouts"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_usage_tenant_id_idx" ON "tenant_usage"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_usage_tenant_id_period_month_key" ON "tenant_usage"("tenant_id", "period_month");

-- CreateIndex
CREATE INDEX "tenant_billing_tenant_id_status_idx" ON "tenant_billing"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tenant_billing_status_due_at_idx" ON "tenant_billing"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_billing_tenant_id_period_month_key" ON "tenant_billing"("tenant_id", "period_month");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_idx" ON "notifications"("tenant_id", "user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_event_type_key" ON "notification_preferences"("user_id", "event_type");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "prompt_versions_tenant_id_prompt_type_is_active_idx" ON "prompt_versions"("tenant_id", "prompt_type", "is_active");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "tenant_notes_tenant_id_created_at_idx" ON "tenant_notes"("tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ai_configs" ADD CONSTRAINT "tenant_ai_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_active_script_id_fkey" FOREIGN KEY ("active_script_id") REFERENCES "scripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_profiles" ADD CONSTRAINT "health_profiles_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_outbound" ADD CONSTRAINT "pending_outbound_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_cloned_from_template_id_fkey" FOREIGN KEY ("cloned_from_template_id") REFERENCES "script_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script_variations" ADD CONSTRAINT "script_variations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script_variations" ADD CONSTRAINT "script_variations_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optouts" ADD CONSTRAINT "optouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_usage" ADD CONSTRAINT "tenant_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_notes" ADD CONSTRAINT "tenant_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_notes" ADD CONSTRAINT "tenant_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
