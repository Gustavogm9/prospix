-- Canonical due-queue diagnostics for AI worker execution.
-- Read-only observability: classifies already-due pending_outbound rows without
-- changing queue, conversations, leads, Guardian state, or sending behavior.

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
  classified.guardian_status,
  classified.guardian_external_state,
  classified.guardian_reason_code,
  classified.circuit_open_until,
  classified.rank_in_tenant,
  classified.blocking_reason,
  CASE
    WHEN classified.blocking_reason IN ('WHATSAPP_DISCONNECTED', 'WHATSAPP_PAUSED', 'CIRCUIT_BREAKER_OPEN') THEN 'CONNECTION'
    WHEN classified.blocking_reason IN ('GUARDIAN_BLOCKED', 'GUARDIAN_DELAYED', 'LEGACY_WITHOUT_GUARDIAN_EVIDENCE') THEN 'GUARDIAN'
    WHEN classified.blocking_reason IN ('CONVERSATION_MISSING', 'CONVERSATION_NOT_ACTIVE', 'AI_HANDLING_DISABLED', 'CONVERSATION_LOCKED') THEN 'CONVERSATION'
    WHEN classified.blocking_reason = 'LEAD_REMOVED' THEN 'LEAD'
    ELSE 'WORKER'
  END AS blocker_kind,
  classified.blocking_reason <> 'READY_FOR_WORKER' AS blocks_send,
  CASE
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

COMMENT ON VIEW public.ai_worker_due_queue_diagnostics IS
  'Due pending_outbound diagnostics with the likely operational reason a ready AI message has not advanced yet.';

GRANT SELECT ON public.ai_worker_due_queue_diagnostics TO authenticated;
GRANT SELECT ON public.ai_worker_due_queue_diagnostics TO service_role;
