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
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_anon_key' LIMIT 1),
      'Content-Type',
      'application/json'
    ),
    body := '{"batch_size": 50}'::jsonb
  );
  $$
);
