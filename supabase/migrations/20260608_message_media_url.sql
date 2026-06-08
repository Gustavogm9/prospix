-- Migration to add media support for messages

ALTER TABLE "public"."pending_outbound" ADD COLUMN IF NOT EXISTS "media_url" text;
ALTER TABLE "public"."pending_outbound" ADD COLUMN IF NOT EXISTS "media_type" text;

ALTER TABLE "public"."messages" ADD COLUMN IF NOT EXISTS "media_url" text;
ALTER TABLE "public"."messages" ADD COLUMN IF NOT EXISTS "media_type" text;
