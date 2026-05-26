-- Feature flags + operational alerts (admin ops center)

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable feature_flags
CREATE TABLE "feature_flags" (
  "id" UUID NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "tenant_id" UUID,
  "enabled" BOOLEAN NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_flags_key_tenant_id_key" ON "feature_flags"("key", "tenant_id");
CREATE INDEX "feature_flags_key_idx" ON "feature_flags"("key");
CREATE INDEX "feature_flags_tenant_id_idx" ON "feature_flags"("tenant_id");

ALTER TABLE "feature_flags"
  ADD CONSTRAINT "feature_flags_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable operational_alerts
CREATE TABLE "operational_alerts" (
  "id" UUID NOT NULL,
  "type" VARCHAR(120) NOT NULL,
  "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
  "tenant_id" UUID,
  "title" VARCHAR(255) NOT NULL,
  "message" TEXT NOT NULL,
  "context" JSONB,
  "dedup_key" VARCHAR(255),
  "ack_by_id" UUID,
  "ack_at" TIMESTAMPTZ,
  "resolved_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_alerts_dedup_key_key" ON "operational_alerts"("dedup_key");
CREATE INDEX "operational_alerts_severity_resolved_at_idx" ON "operational_alerts"("severity", "resolved_at");
CREATE INDEX "operational_alerts_tenant_id_created_at_idx" ON "operational_alerts"("tenant_id", "created_at" DESC);
CREATE INDEX "operational_alerts_type_idx" ON "operational_alerts"("type");

ALTER TABLE "operational_alerts"
  ADD CONSTRAINT "operational_alerts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operational_alerts"
  ADD CONSTRAINT "operational_alerts_ack_by_id_fkey"
  FOREIGN KEY ("ack_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
