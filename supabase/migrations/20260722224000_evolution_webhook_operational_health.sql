-- Operator-facing health views for Evolution messages.upsert processing.
-- Additive only. The raw webhook payload remains restricted to the ledger table;
-- these views expose only counts, hashes and sanitized operational text.

BEGIN;

CREATE OR REPLACE VIEW public.evolution_webhook_operational_health AS
SELECT
  count(*) FILTER (
    WHERE accepted_at >= now() - interval '24 hours'
  )::INTEGER AS total_24h,
  count(*) FILTER (
    WHERE status = 'PROCESSED'
      AND accepted_at >= now() - interval '24 hours'
  )::INTEGER AS processed_24h,
  count(*) FILTER (
    WHERE status = 'SKIPPED'
      AND accepted_at >= now() - interval '24 hours'
  )::INTEGER AS skipped_24h,
  count(*) FILTER (
    WHERE status = 'FAILED'
      AND COALESCE(failed_at, updated_at, accepted_at) >= now() - interval '24 hours'
  )::INTEGER AS failed_24h,
  count(*) FILTER (
    WHERE status = 'PROCESSING'
      AND processing_started_at <= now() - interval '5 minutes'
  )::INTEGER AS stale_processing,
  count(*) FILTER (
    WHERE attempts > 1
      AND last_seen_at >= now() - interval '24 hours'
  )::INTEGER AS duplicate_attempts_24h,
  (
    count(*) FILTER (
      WHERE status = 'FAILED'
        AND COALESCE(failed_at, updated_at, accepted_at) >= now() - interval '24 hours'
    )
    + count(*) FILTER (
      WHERE status = 'PROCESSING'
        AND processing_started_at <= now() - interval '5 minutes'
    )
  )::INTEGER AS failed_or_stale_24h,
  max(accepted_at) AS latest_event_at,
  max(failed_at) AS latest_failed_at,
  now() AS generated_at
FROM public.evolution_webhook_processing_events;

CREATE OR REPLACE VIEW public.evolution_webhook_operational_failures AS
SELECT
  events.id,
  events.event_name,
  events.instance_name,
  events.whatsapp_message_id_hash,
  events.remote_jid_hash,
  events.from_me,
  events.tenant_id,
  COALESCE(tenants.name, tenants.slug, 'Conta nao identificada') AS tenant_name,
  events.lead_id,
  events.conversation_id,
  events.message_id,
  events.status,
  events.skip_reason,
  left(COALESCE(events.error_message, ''), 500) AS error_message,
  events.attempts,
  events.accepted_at,
  events.processing_started_at,
  events.processed_at,
  events.failed_at,
  events.last_seen_at,
  events.updated_at,
  CASE
    WHEN events.status = 'PROCESSING' THEN
      GREATEST(0, floor(extract(epoch FROM now() - events.processing_started_at)))::INTEGER
    ELSE NULL
  END AS processing_age_seconds,
  CASE
    WHEN events.status = 'FAILED' THEN
      'Uma mensagem recebida pelo WhatsApp foi aceita pelo webhook, mas falhou antes de entrar completamente no sistema.'
    WHEN events.status = 'PROCESSING'
      AND events.processing_started_at <= now() - interval '5 minutes' THEN
      'Uma mensagem recebida pelo WhatsApp ficou aberta em processamento por mais de 5 minutos.'
    WHEN events.attempts > 1 THEN
      'A Evolution reenviou o mesmo evento; o sistema reconheceu a repeticao e manteve uma unica trilha auditavel.'
    ELSE
      'Evento registrado para acompanhamento operacional.'
  END AS operator_summary,
  CASE
    WHEN events.status = 'FAILED' THEN
      'Confirmar se a conversa recebeu a mensagem. Se nao recebeu, reprocessar pelo payload auditado apos revisar o erro.'
    WHEN events.status = 'PROCESSING'
      AND events.processing_started_at <= now() - interval '5 minutes' THEN
      'Verificar logs da Edge Function webhook-evolution e confirmar se houve timeout ou interrupcao apos o aceite.'
    WHEN events.attempts > 1 THEN
      'Nenhuma acao imediata se a mensagem aparece uma unica vez na conversa.'
    ELSE
      'Acompanhar na proxima leitura.'
  END AS recommended_action
FROM public.evolution_webhook_processing_events events
LEFT JOIN public.tenants tenants ON tenants.id = events.tenant_id
WHERE (
    events.status = 'FAILED'
    AND COALESCE(events.failed_at, events.updated_at, events.accepted_at) >= now() - interval '7 days'
  )
  OR (
    events.status = 'PROCESSING'
    AND events.processing_started_at <= now() - interval '5 minutes'
  )
  OR (
    events.attempts > 1
    AND events.last_seen_at >= now() - interval '24 hours'
  );

REVOKE ALL ON public.evolution_webhook_operational_health FROM PUBLIC;
REVOKE ALL ON public.evolution_webhook_operational_health FROM anon;
REVOKE ALL ON public.evolution_webhook_operational_health FROM authenticated;
GRANT SELECT ON public.evolution_webhook_operational_health TO service_role;

REVOKE ALL ON public.evolution_webhook_operational_failures FROM PUBLIC;
REVOKE ALL ON public.evolution_webhook_operational_failures FROM anon;
REVOKE ALL ON public.evolution_webhook_operational_failures FROM authenticated;
GRANT SELECT ON public.evolution_webhook_operational_failures TO service_role;

COMMENT ON VIEW public.evolution_webhook_operational_health IS
  'Service-role operational summary for Evolution messages.upsert processing health. Does not expose raw payload.';

COMMENT ON VIEW public.evolution_webhook_operational_failures IS
  'Service-role operational list of failed, stale or duplicated Evolution messages.upsert processing events. Does not expose raw payload or full WhatsApp identifiers.';

COMMIT;
