-- Frente G · Nível 1 · TenantDiscovery (manual tracking)
-- Roadmap completo: docs/agents/frente-g-discovery-onboarding.md

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM (
  'NOT_STARTED',
  'SCHEDULED',
  'IN_SESSION',
  'CONSOLIDATING',
  'VALIDATING',
  'APPROVED',
  'CHURNED_BEFORE_APPROVAL'
);

-- CreateTable
CREATE TABLE "tenant_discoveries" (
  "tenant_id" UUID NOT NULL,
  "status" "DiscoveryStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "scheduled_for" TIMESTAMPTZ,
  "conducted_at" TIMESTAMPTZ,
  "audio_r2_key" TEXT,
  "video_r2_key" TEXT,
  "transcript_r2_key" TEXT,
  "attachments" JSONB,
  "voice_profile_draft" JSONB,
  "scripts_draft" JSONB,
  "validated_at" TIMESTAMPTZ,
  "validation_rounds" INTEGER NOT NULL DEFAULT 0,
  "approved_at" TIMESTAMPTZ,
  "approval_proof_r2_key" TEXT,
  "pm_user_id" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "tenant_discoveries_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "tenant_discoveries_status_idx" ON "tenant_discoveries"("status");

-- AddForeignKey
ALTER TABLE "tenant_discoveries"
  ADD CONSTRAINT "tenant_discoveries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (pm_user_id · referência opcional ao operador responsável)
ALTER TABLE "tenant_discoveries"
  ADD CONSTRAINT "tenant_discoveries_pm_user_id_fkey"
  FOREIGN KEY ("pm_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
