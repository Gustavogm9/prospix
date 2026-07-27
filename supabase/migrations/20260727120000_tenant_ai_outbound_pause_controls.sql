-- Tenant-level administrative pause for every AI outbound channel.
-- This is an operational kill switch: when paused, no first-touch, reactive
-- reply, follow-up, referral request, or already-claimed queue item may be sent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_ai_outbound_controls (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  paused BOOLEAN NOT NULL DEFAULT false,
  paused_at TIMESTAMP WITH TIME ZONE NULL,
  paused_by TEXT NULL,
  pause_reason TEXT NULL,
  resumed_at TIMESTAMP WITH TIME ZONE NULL,
  resumed_by TEXT NULL,
  resume_reason TEXT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT tenant_ai_outbound_controls_pause_reason_required CHECK (
    paused = false
    OR (
      paused_at IS NOT NULL
      AND pause_reason IS NOT NULL
      AND BTRIM(pause_reason) <> ''
    )
  )
);

CREATE INDEX IF NOT EXISTS tenant_ai_outbound_controls_paused_idx
  ON public.tenant_ai_outbound_controls (paused, updated_at DESC)
  WHERE paused = true;

CREATE TABLE IF NOT EXISTS public.tenant_ai_outbound_control_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('PAUSE', 'RESUME')),
  actor_user_id TEXT NULL,
  reason TEXT NULL,
  previous_paused BOOLEAN NULL,
  new_paused BOOLEAN NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_ai_outbound_control_events_tenant_created_idx
  ON public.tenant_ai_outbound_control_events (tenant_id, created_at DESC);

ALTER TABLE public.tenant_ai_outbound_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_ai_outbound_control_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_ai_outbound_controls_select ON public.tenant_ai_outbound_controls;
CREATE POLICY tenant_ai_outbound_controls_select
  ON public.tenant_ai_outbound_controls
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS tenant_ai_outbound_control_events_select ON public.tenant_ai_outbound_control_events;
CREATE POLICY tenant_ai_outbound_control_events_select
  ON public.tenant_ai_outbound_control_events
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.current_user_role() = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS tenant_ai_outbound_controls_service_role_all ON public.tenant_ai_outbound_controls;
CREATE POLICY tenant_ai_outbound_controls_service_role_all
  ON public.tenant_ai_outbound_controls
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS tenant_ai_outbound_control_events_service_role_all ON public.tenant_ai_outbound_control_events;
CREATE POLICY tenant_ai_outbound_control_events_service_role_all
  ON public.tenant_ai_outbound_control_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.tenant_ai_outbound_controls TO authenticated;
GRANT SELECT ON public.tenant_ai_outbound_control_events TO authenticated;
GRANT ALL ON public.tenant_ai_outbound_controls TO service_role;
GRANT ALL ON public.tenant_ai_outbound_control_events TO service_role;

CREATE OR REPLACE FUNCTION public.is_tenant_ai_outbound_paused(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT controls.paused
      FROM public.tenant_ai_outbound_controls controls
      WHERE controls.tenant_id = p_tenant_id
      LIMIT 1
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_tenant_ai_outbound_paused(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tenant_ai_outbound_paused(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_ai_outbound_paused(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.set_tenant_ai_outbound_pause(
  p_tenant_id UUID,
  p_paused BOOLEAN,
  p_actor_user_id TEXT,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.tenant_ai_outbound_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := statement_timestamp();
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_previous public.tenant_ai_outbound_controls%ROWTYPE;
  v_updated public.tenant_ai_outbound_controls%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_paused IS NULL THEN
    RAISE EXCEPTION 'paused is required' USING ERRCODE = '22023';
  END IF;

  IF p_paused = true AND v_reason IS NULL THEN
    RAISE EXCEPTION 'pause reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_previous
  FROM public.tenant_ai_outbound_controls
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF FOUND AND v_previous.paused IS NOT DISTINCT FROM p_paused THEN
    RETURN v_previous;
  END IF;

  IF p_paused THEN
    INSERT INTO public.tenant_ai_outbound_controls (
      tenant_id,
      paused,
      paused_at,
      paused_by,
      pause_reason,
      resumed_at,
      resumed_by,
      resume_reason,
      updated_at
    )
    VALUES (
      p_tenant_id,
      true,
      v_now,
      p_actor_user_id,
      v_reason,
      NULL,
      NULL,
      NULL,
      v_now
    )
    ON CONFLICT (tenant_id) DO UPDATE
    SET
      paused = true,
      paused_at = EXCLUDED.paused_at,
      paused_by = EXCLUDED.paused_by,
      pause_reason = EXCLUDED.pause_reason,
      resumed_at = NULL,
      resumed_by = NULL,
      resume_reason = NULL,
      updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_updated;
  ELSE
    INSERT INTO public.tenant_ai_outbound_controls (
      tenant_id,
      paused,
      resumed_at,
      resumed_by,
      resume_reason,
      updated_at
    )
    VALUES (
      p_tenant_id,
      false,
      v_now,
      p_actor_user_id,
      v_reason,
      v_now
    )
    ON CONFLICT (tenant_id) DO UPDATE
    SET
      paused = false,
      resumed_at = EXCLUDED.resumed_at,
      resumed_by = EXCLUDED.resumed_by,
      resume_reason = EXCLUDED.resume_reason,
      updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_updated;
  END IF;

  INSERT INTO public.tenant_ai_outbound_control_events (
    tenant_id,
    action,
    actor_user_id,
    reason,
    previous_paused,
    new_paused,
    metadata
  )
  VALUES (
    p_tenant_id,
    CASE WHEN p_paused THEN 'PAUSE' ELSE 'RESUME' END,
    p_actor_user_id,
    v_reason,
    CASE WHEN v_previous.tenant_id IS NULL THEN NULL ELSE v_previous.paused END,
    p_paused,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_ai_outbound_pause(UUID, BOOLEAN, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_ai_outbound_pause(UUID, BOOLEAN, TEXT, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_due_pending_outbound(
  p_tenant_id UUID,
  p_owner TEXT,
  p_limit INTEGER DEFAULT 1,
  p_claim_ttl_seconds INTEGER DEFAULT 1800,
  p_excluded_conversation_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS SETOF public.pending_outbound
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := statement_timestamp();
  v_owner TEXT := COALESCE(NULLIF(BTRIM(p_owner), ''), 'unknown-worker');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
  v_claim_ttl_seconds INTEGER := LEAST(GREATEST(COALESCE(p_claim_ttl_seconds, 1800), 30), 3600);
  v_claim_expires_at TIMESTAMP WITH TIME ZONE := v_now + make_interval(secs => v_claim_ttl_seconds);
BEGIN
  IF public.is_tenant_ai_outbound_paused(p_tenant_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT pending.id
    FROM public.pending_outbound pending
    WHERE pending.tenant_id = p_tenant_id
      AND pending.sent_at IS NULL
      AND pending.failed_at IS NULL
      AND pending.scheduled_for <= v_now
      AND pending.attempts < 3
      AND (
        pending.processing_expires_at IS NULL
        OR pending.processing_expires_at <= v_now
        OR pending.processing_owner = v_owner
      )
      AND (
        COALESCE(array_length(p_excluded_conversation_ids, 1), 0) = 0
        OR NOT pending.conversation_id = ANY(p_excluded_conversation_ids)
      )
    ORDER BY pending.priority ASC, pending.scheduled_for ASC, pending.created_at ASC, pending.id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.pending_outbound pending
  SET
    processing_owner = v_owner,
    processing_started_at = v_now,
    processing_expires_at = v_claim_expires_at
  FROM candidates
  WHERE pending.id = candidates.id
  RETURNING pending.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_pending_outbound(UUID, TEXT, INTEGER, INTEGER, UUID[]) TO service_role;

CREATE OR REPLACE VIEW public.ai_worker_due_queue_diagnostics AS
WITH due_queue AS (
  SELECT
    pending.id AS pending_outbound_id,
    pending.tenant_id,
    tenants.name AS tenant_name,
    tenants.slug AS tenant_slug,
    pending.conversation_id,
    conversations.lead_id,
    leads.name AS lead_name,
    leads.source::TEXT AS lead_source,
    leads.status::TEXT AS lead_status,
    leads.deleted_at AS lead_deleted_at,
    campaigns.name AS campaign_name,
    campaigns.status::TEXT AS campaign_status,
    pending.message_type::TEXT AS message_type,
    pending.created_at,
    pending.scheduled_for,
    FLOOR(EXTRACT(EPOCH FROM (now() - pending.scheduled_for)))::INTEGER AS due_age_seconds,
    pending.attempts,
    pending.validation_status::TEXT AS validation_status,
    pending.validation_reason_code,
    pending.final_guardian_decision::TEXT AS final_guardian_decision,
    pending.failed_reason,
    conversations.status::TEXT AS conversation_status,
    conversations.ai_handling,
    conversations.conversation_lock_until,
    controls.paused AS tenant_ai_paused,
    controls.paused_at AS tenant_ai_paused_at,
    controls.pause_reason AS tenant_ai_pause_reason,
    guardian.status::TEXT AS guardian_status,
    guardian.external_state AS guardian_external_state,
    COALESCE(guardian.state_reason_code, guardian.last_disconnect_reason_code) AS guardian_reason_code,
    guardian.circuit_open_until,
    ROW_NUMBER() OVER (
      PARTITION BY pending.tenant_id
      ORDER BY pending.scheduled_for ASC, pending.created_at ASC, pending.id ASC
    ) AS rank_in_tenant
  FROM public.pending_outbound pending
  LEFT JOIN public.tenants tenants
    ON tenants.id = pending.tenant_id
  LEFT JOIN public.conversations conversations
    ON conversations.id = pending.conversation_id
   AND conversations.tenant_id = pending.tenant_id
  LEFT JOIN public.leads leads
    ON leads.id = conversations.lead_id
   AND leads.tenant_id = pending.tenant_id
  LEFT JOIN public.campaigns campaigns
    ON campaigns.id = leads.campaign_id
   AND campaigns.tenant_id = pending.tenant_id
  LEFT JOIN public.tenant_ai_outbound_controls controls
    ON controls.tenant_id = pending.tenant_id
  LEFT JOIN public.whatsapp_guardian_status guardian
    ON guardian.tenant_id = pending.tenant_id
  WHERE pending.sent_at IS NULL
    AND pending.failed_at IS NULL
    AND pending.scheduled_for <= now()
),
classified AS (
  SELECT
    due_queue.*,
    CASE
      WHEN COALESCE(due_queue.tenant_ai_paused, false) = true THEN 'TENANT_AI_PAUSED'
      WHEN due_queue.guardian_status = 'SUSPENDED' THEN 'WHATSAPP_DISCONNECTED'
      WHEN due_queue.guardian_status = 'PAUSED' THEN 'WHATSAPP_PAUSED'
      WHEN due_queue.circuit_open_until IS NOT NULL
        AND due_queue.circuit_open_until > now() THEN 'CIRCUIT_BREAKER_OPEN'
      WHEN due_queue.validation_status IN ('BLOCKED', 'EXPIRED') THEN 'GUARDIAN_BLOCKED'
      WHEN due_queue.validation_status = 'DELAYED' THEN 'GUARDIAN_DELAYED'
      WHEN due_queue.conversation_id IS NULL THEN 'CONVERSATION_MISSING'
      WHEN due_queue.conversation_status IS DISTINCT FROM 'ACTIVE' THEN 'CONVERSATION_NOT_ACTIVE'
      WHEN due_queue.ai_handling IS DISTINCT FROM true THEN 'AI_HANDLING_DISABLED'
      WHEN due_queue.conversation_lock_until IS NOT NULL
        AND due_queue.conversation_lock_until > now() THEN 'CONVERSATION_LOCKED'
      WHEN due_queue.lead_deleted_at IS NOT NULL THEN 'LEAD_REMOVED'
      WHEN due_queue.validation_status IS NULL THEN 'LEGACY_WITHOUT_GUARDIAN_EVIDENCE'
      ELSE 'READY_FOR_WORKER'
    END AS blocking_reason
  FROM due_queue
)
SELECT
  classified.pending_outbound_id,
  classified.tenant_id,
  classified.tenant_name,
  classified.tenant_slug,
  classified.conversation_id,
  classified.lead_id,
  classified.lead_name,
  classified.lead_source,
  classified.lead_status,
  classified.campaign_name,
  classified.campaign_status,
  classified.message_type,
  classified.created_at,
  classified.scheduled_for,
  classified.due_age_seconds,
  classified.attempts,
  classified.validation_status,
  classified.validation_reason_code,
  classified.final_guardian_decision,
  classified.failed_reason,
  classified.conversation_status,
  classified.ai_handling,
  classified.conversation_lock_until,
  classified.tenant_ai_paused,
  classified.tenant_ai_paused_at,
  classified.tenant_ai_pause_reason,
  classified.guardian_status,
  classified.guardian_external_state,
  classified.guardian_reason_code,
  classified.circuit_open_until,
  classified.rank_in_tenant,
  classified.blocking_reason,
  CASE
    WHEN classified.blocking_reason = 'TENANT_AI_PAUSED' THEN 'TENANT_CONTROL'
    WHEN classified.blocking_reason IN ('WHATSAPP_DISCONNECTED', 'WHATSAPP_PAUSED', 'CIRCUIT_BREAKER_OPEN') THEN 'CONNECTION'
    WHEN classified.blocking_reason IN ('GUARDIAN_BLOCKED', 'GUARDIAN_DELAYED', 'LEGACY_WITHOUT_GUARDIAN_EVIDENCE') THEN 'GUARDIAN'
    WHEN classified.blocking_reason IN ('CONVERSATION_MISSING', 'CONVERSATION_NOT_ACTIVE', 'AI_HANDLING_DISABLED', 'CONVERSATION_LOCKED') THEN 'CONVERSATION'
    WHEN classified.blocking_reason = 'LEAD_REMOVED' THEN 'LEAD'
    ELSE 'WORKER'
  END AS blocker_kind,
  classified.blocking_reason <> 'READY_FOR_WORKER' AS blocks_send,
  CASE
    WHEN classified.blocking_reason = 'TENANT_AI_PAUSED'
      THEN 'Envio da IA pausado por um administrador para esta conta. A IA salva entradas, mas nao inicia, responde, segue follow-up nem envia indicacoes automaticamente.'
    WHEN classified.blocking_reason = 'WHATSAPP_DISCONNECTED'
      THEN 'Mensagem pronta, mas o WhatsApp esta desconectado ou sem autorizacao. A IA nao envia ate o numero ser reconectado.'
    WHEN classified.blocking_reason = 'WHATSAPP_PAUSED'
      THEN 'Mensagem pronta, mas a conexao esta instavel ou conectando. A IA pausou envios para evitar falhas.'
    WHEN classified.blocking_reason = 'CIRCUIT_BREAKER_OPEN'
      THEN 'Mensagem pronta, mas o circuito de seguranca esta aberto temporariamente por falhas recentes.'
    WHEN classified.blocking_reason = 'GUARDIAN_BLOCKED'
      THEN 'Mensagem impedida pela validacao do Guardian antes do envio.'
    WHEN classified.blocking_reason = 'GUARDIAN_DELAYED'
      THEN 'Mensagem em espera por regra de cadencia, aquecimento ou seguranca do Guardian.'
    WHEN classified.blocking_reason = 'CONVERSATION_MISSING'
      THEN 'Mensagem sem conversa vinculada. O worker nao tem contexto seguro para enviar.'
    WHEN classified.blocking_reason = 'CONVERSATION_NOT_ACTIVE'
      THEN 'Mensagem vinculada a uma conversa que nao esta ativa. O atendimento automatico nao deve continuar.'
    WHEN classified.blocking_reason = 'AI_HANDLING_DISABLED'
      THEN 'Mensagem vinculada a uma conversa em que a IA esta desligada.'
    WHEN classified.blocking_reason = 'CONVERSATION_LOCKED'
      THEN 'Mensagem aguardando o intervalo de seguranca da conversa terminar.'
    WHEN classified.blocking_reason = 'LEAD_REMOVED'
      THEN 'Mensagem vinculada a lead removido. O envio nao deve seguir.'
    WHEN classified.blocking_reason = 'LEGACY_WITHOUT_GUARDIAN_EVIDENCE'
      THEN 'Mensagem antiga sem evidencias completas do Guardian. Precisa de revalidacao antes do envio.'
    ELSE 'Mensagem vencida e sem bloqueio explicito. Deve ser processada pelo proximo ciclo do worker de envio.'
  END AS operator_summary,
  CASE
    WHEN classified.blocking_reason = 'TENANT_AI_PAUSED'
      THEN 'Retomar a IA no painel admin somente quando a conta puder voltar a enviar mensagens automáticas.'
    WHEN classified.blocking_reason = 'WHATSAPP_DISCONNECTED'
      THEN 'Reconectar o WhatsApp do usuario pelo QR Code. A fila pode seguir apos o Guardian registrar conexao aberta.'
    WHEN classified.blocking_reason = 'WHATSAPP_PAUSED'
      THEN 'Aguardar a conexao estabilizar ou reconectar o numero se continuar fechado.'
    WHEN classified.blocking_reason = 'CIRCUIT_BREAKER_OPEN'
      THEN 'Aguardar o fim do bloqueio temporario e verificar se as proximas tentativas normalizam.'
    WHEN classified.blocking_reason = 'GUARDIAN_BLOCKED'
      THEN 'Revisar a mensagem, a campanha e o motivo do Guardian antes de tentar novo envio.'
    WHEN classified.blocking_reason = 'GUARDIAN_DELAYED'
      THEN 'Aguardar a proxima janela segura definida pelo Guardian.'
    WHEN classified.blocking_reason = 'CONVERSATION_MISSING'
      THEN 'Recriar o vinculo da conversa ou cancelar esta pendencia.'
    WHEN classified.blocking_reason = 'CONVERSATION_NOT_ACTIVE'
      THEN 'Validar se a conversa deve ser reaberta por um operador humano.'
    WHEN classified.blocking_reason = 'AI_HANDLING_DISABLED'
      THEN 'Reativar IA na conversa somente se o atendimento automatico for apropriado.'
    WHEN classified.blocking_reason = 'CONVERSATION_LOCKED'
      THEN 'Aguardar o fim do intervalo de seguranca da conversa.'
    WHEN classified.blocking_reason = 'LEAD_REMOVED'
      THEN 'Cancelar a pendencia associada ao lead removido.'
    WHEN classified.blocking_reason = 'LEGACY_WITHOUT_GUARDIAN_EVIDENCE'
      THEN 'Revalidar a pendencia pelo fluxo atual do Guardian antes de enviar.'
    ELSE 'Verificar a proxima execucao do worker send-messages e os logs da Edge Function se permanecer vencida.'
  END AS recommended_action
FROM classified;

COMMENT ON TABLE public.tenant_ai_outbound_controls IS
  'Administrative tenant-level control that pauses or resumes every AI outbound channel without mutating campaigns or conversations.';
COMMENT ON TABLE public.tenant_ai_outbound_control_events IS
  'Append-only operational history for tenant-level AI outbound pause/resume actions.';
COMMENT ON FUNCTION public.is_tenant_ai_outbound_paused(UUID) IS
  'Returns true when the tenant-level AI outbound kill switch is active.';
COMMENT ON FUNCTION public.set_tenant_ai_outbound_pause(UUID, BOOLEAN, TEXT, TEXT, JSONB) IS
  'Atomically changes tenant-level AI outbound pause state and records the operational event.';
COMMENT ON VIEW public.ai_worker_due_queue_diagnostics IS
  'Due pending_outbound diagnostics with the likely operational reason a ready AI message has not advanced yet, including tenant-level AI pause.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_ai_outbound_controls;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
