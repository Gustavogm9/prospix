-- SQL para agendar a Edge Function process-followups a cada 15 minutos
-- (Para rodar no SQL Editor do Supabase)

select
  cron.schedule(
    'process-followups-job',
    '*/15 * * * *',
    $$
    select
      net.http_post(
          url:='https://yvbyplzfqfrlfujathii.supabase.co/functions/v1/process-followups',
          headers:='{"Content-Type": "application/json", "x-local-dev": "true"}'::jsonb
      ) as request_id;
    $$
  );
