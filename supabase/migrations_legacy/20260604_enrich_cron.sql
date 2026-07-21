-- Migration: Enable pg_cron + pg_net and schedule enrich-leads
-- Requires: pg_cron and pg_net extensions enabled via Supabase Dashboard

-- Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Remove old job if exists (idempotent re-run)
SELECT cron.unschedule('enrich-leads')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enrich-leads');

-- Schedule: every 15 min from 11:00 to 23:00 UTC (= 08:00 to 20:00 BRT)
SELECT cron.schedule(
  'enrich-leads',
  '*/15 11-23 * * *',
  $$
  SELECT net.http_post(
    url := 'https://yvbyplzfqfrlfujathii.supabase.co/functions/v1/enrich-leads',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2YnlwbHpmcWZybGZ1amF0aGlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM2MDU3NSwiZXhwIjoyMDk0OTM2NTc1fQ.EELrhswIWep6vB_HSxmrdD1BhhNVLR8QFuFJs2x6dCs", "Content-Type": "application/json"}'::jsonb,
    body := '{"batch_size": 50}'::jsonb
  );
  $$
);
