-- CreateEnum
CREATE TYPE "LgpdRequestType" AS ENUM (
  'EXPORT_DATA',
  'DELETE_TENANT_DATA',
  'DELETE_LEAD_DATA',
  'CORRECT_DATA',
  'CONFIRM_DATA'
);

-- CreateEnum
CREATE TYPE "LgpdRequestStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
  'CANCELED'
);

-- CreateTable
CREATE TABLE "lgpd_requests" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "requested_by_user_id" UUID,
  "requested_by_lead" VARCHAR(24),
  "type" "LgpdRequestType" NOT NULL,
  "status" "LgpdRequestStatus" NOT NULL DEFAULT 'PENDING',
  "scope" JSONB,
  "download_url" TEXT,
  "download_expires_at" TIMESTAMPTZ,
  "rejection_reason" TEXT,
  "processed_at" TIMESTAMPTZ,
  "processed_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "lgpd_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lgpd_requests_tenant_id_status_idx" ON "lgpd_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "lgpd_requests_tenant_id_created_at_idx" ON "lgpd_requests"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lgpd_requests_requested_by_user_id_idx" ON "lgpd_requests"("requested_by_user_id");

-- AddForeignKey
ALTER TABLE "lgpd_requests" ADD CONSTRAINT "lgpd_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lgpd_requests" ADD CONSTRAINT "lgpd_requests_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lgpd_requests" ADD CONSTRAINT "lgpd_requests_processed_by_id_fkey"
  FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
