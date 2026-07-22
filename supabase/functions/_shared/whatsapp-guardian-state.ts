export type GuardianStatus = "COLD" | "RECOVERY" | "NORMAL" | "HIGH_LOAD" | "COOLDOWN" | "PAUSED" | "SUSPENDED" | string;

type SupabaseLike = {
  from: (table: string) => any;
};

type TransitionParams = {
  supabase: SupabaseLike;
  tenantId: string;
  previousStatus: GuardianStatus | null | undefined;
  nextStatus: GuardianStatus;
  externalState: string | null;
  reasonCode: string | null;
  source: string;
  enteredAt: string;
  connectionEventId?: string | null;
  previousEnteredAt?: string | null;
  metadata?: Record<string, unknown>;
};

export function isFutureTimestamp(value: string | null | undefined, nowMs = Date.now()): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > nowMs;
}

export function isRecentConnectedAtWithoutQuarantine(
  guardianStatus: any,
  quarantineMinutes: number,
  nowMs = Date.now(),
): boolean {
  if (guardianStatus?.quarantined_until || !guardianStatus?.connected_at) return false;
  const connectedAtMs = new Date(guardianStatus.connected_at).getTime();
  if (!Number.isFinite(connectedAtMs)) return false;
  return nowMs - connectedAtMs < quarantineMinutes * 60 * 1000;
}

export function shouldMoveColdToRecovery(params: {
  guardianStatus: any;
  externalState: string | null | undefined;
  quarantineMinutes: number;
  nowMs?: number;
}): boolean {
  const nowMs = params.nowMs ?? Date.now();
  const guardianStatus = params.guardianStatus;
  const current = String(guardianStatus?.status || "").toUpperCase();
  const normalizedExternalState = String(params.externalState || guardianStatus?.external_state || "").toLowerCase();
  if (current !== "COLD" || normalizedExternalState !== "open") return false;
  if (guardianStatus?.last_disconnect_reason_code) return false;
  if (isFutureTimestamp(guardianStatus?.quarantined_until, nowMs)) return false;
  if (isFutureTimestamp(guardianStatus?.circuit_open_until, nowMs)) return false;
  if (isRecentConnectedAtWithoutQuarantine(guardianStatus, params.quarantineMinutes, nowMs)) return false;
  return true;
}

export function shouldPromoteRecoveryToNormal(params: {
  guardianStatus: any;
  externalState: string | null | undefined;
  minDurationMinutes: number;
  minSuccessfulSends: number;
  successfulSends: number;
  criticalEvents: number;
  duePending: number;
  nowMs?: number;
}): boolean {
  const nowMs = params.nowMs ?? Date.now();
  const guardianStatus = params.guardianStatus;
  const current = String(guardianStatus?.status || "").toUpperCase();
  const normalizedExternalState = String(params.externalState || guardianStatus?.external_state || "").toLowerCase();
  const enteredAtMs = new Date(guardianStatus?.state_entered_at || guardianStatus?.updated_at || "").getTime();
  const minDurationMs = Math.max(0, params.minDurationMinutes) * 60 * 1000;

  if (current !== "RECOVERY" || normalizedExternalState !== "open") return false;
  if (!Number.isFinite(enteredAtMs) || nowMs - enteredAtMs < minDurationMs) return false;
  if (isFutureTimestamp(guardianStatus?.circuit_open_until, nowMs)) return false;
  if (params.successfulSends < Math.max(0, params.minSuccessfulSends)) return false;
  if (params.criticalEvents > 0) return false;
  if (params.duePending > 0) return false;
  return true;
}

export function shouldPromoteColdToNormal(params: {
  guardianStatus: any;
  externalState: string | null | undefined;
  quarantineMinutes: number;
  nowMs?: number;
}): boolean {
  return shouldMoveColdToRecovery(params);
}

export function describeGuardianState(
  status: GuardianStatus,
  externalState: string | null,
  reasonCode: string | null,
  guardianStatus?: any,
) {
  const normalized = String(status || "NORMAL").toUpperCase();
  const external = String(externalState || "").toLowerCase();
  const quarantined = isFutureTimestamp(guardianStatus?.quarantined_until);

  if (normalized === "SUSPENDED") {
    return {
      impactLevel: "CRITICAL",
      operationState: "REQUIRES_ACTION",
      allowSend: false,
      allowNewActive: false,
      operatorSummary: "Numero desconectado ou sem autorizacao. A IA nao envia ate reconectar o WhatsApp.",
    };
  }

  if (normalized === "PAUSED") {
    return {
      impactLevel: "ATTENTION",
      operationState: "BLOCKED",
      allowSend: false,
      allowNewActive: false,
      operatorSummary: external === "connecting"
        ? "WhatsApp conectando. A IA aguarda a conexao estabilizar antes de enviar."
        : "Conexao instavel ou fechada. A IA pausa envios para evitar falhas.",
    };
  }

  if (normalized === "COLD") {
    return {
      impactLevel: "OBSERVATION",
      operationState: "THROTTLED",
      allowSend: true,
      allowNewActive: !quarantined,
      operatorSummary: quarantined
        ? "WhatsApp conectado em observacao. Respostas podem seguir, mas novas prospeccoes aguardam o fim da quarentena."
        : "WhatsApp conectado em observacao. A IA pode operar com ritmo reduzido para proteger o numero.",
    };
  }

  if (normalized === "RECOVERY") {
    return {
      impactLevel: "OBSERVATION",
      operationState: "THROTTLED",
      allowSend: true,
      allowNewActive: true,
      operatorSummary: "Retomada segura apos reconexao. A IA realinha a fila e libera apenas contatos seletivos com ritmo controlado.",
    };
  }

  if (normalized === "HIGH_LOAD") {
    return {
      impactLevel: "OBSERVATION",
      operationState: "THROTTLED",
      allowSend: true,
      allowNewActive: false,
      operatorSummary: "Volume alto. A IA prioriza respostas e reduz novas prospeccoes ate a carga normalizar.",
    };
  }

  if (normalized === "COOLDOWN") {
    return {
      impactLevel: "ATTENTION",
      operationState: "THROTTLED",
      allowSend: true,
      allowNewActive: false,
      operatorSummary: "Numero em resfriamento operacional. A IA envia com intervalo maior e nao inicia novas prospeccoes.",
    };
  }

  return {
    impactLevel: "INFO",
    operationState: "ACTIVE",
    allowSend: true,
    allowNewActive: true,
    operatorSummary: reasonCode === "WA_COLD_PROMOTED_TO_NORMAL" || reasonCode === "WA_RECOVERY_PROMOTED_TO_NORMAL"
      ? "Observacao encerrada. A IA pode operar dentro das regras normais de campanha e cadencia."
      : "WhatsApp operacional. A IA pode responder e iniciar conversas dentro das regras configuradas.",
  };
}

export function buildGuardianStatePatch(params: {
  previousStatus: GuardianStatus | null | undefined;
  nextStatus: GuardianStatus;
  reasonCode: string | null;
  source: string;
  nowIso: string;
  previousStateEnteredAt?: string | null;
}) {
  const statusChanged = params.previousStatus !== params.nextStatus;
  return {
    state_entered_at: statusChanged || !params.previousStateEnteredAt
      ? params.nowIso
      : params.previousStateEnteredAt,
    state_reason_code: statusChanged ? params.reasonCode : undefined,
    state_source: statusChanged ? params.source : undefined,
  };
}

export async function recordGuardianStateTransition(params: TransitionParams): Promise<void> {
  if (params.previousStatus === params.nextStatus) return;

  try {
    const enteredAtMs = new Date(params.enteredAt).getTime();
    const { data: openTransitions } = await params.supabase
      .from("whatsapp_guardian_state_transitions")
      .select("id, entered_at")
      .eq("tenant_id", params.tenantId)
      .is("exited_at", null)
      .order("entered_at", { ascending: false })
      .limit(5);

    for (const transition of openTransitions || []) {
      const previousEnteredAtMs = new Date(transition.entered_at).getTime();
      const durationSeconds = Number.isFinite(previousEnteredAtMs) && Number.isFinite(enteredAtMs)
        ? Math.max(0, Math.floor((enteredAtMs - previousEnteredAtMs) / 1000))
        : null;

      await params.supabase
        .from("whatsapp_guardian_state_transitions")
        .update({
          exited_at: params.enteredAt,
          duration_seconds: durationSeconds,
        })
        .eq("id", transition.id);
    }

    const profile = describeGuardianState(
      params.nextStatus,
      params.externalState,
      params.reasonCode,
      { quarantined_until: params.metadata?.quarantined_until },
    );

    await params.supabase.from("whatsapp_guardian_state_transitions").insert({
      tenant_id: params.tenantId,
      connection_event_id: params.connectionEventId || null,
      previous_status: params.previousStatus || null,
      status: params.nextStatus,
      external_state: params.externalState,
      reason_code: params.reasonCode || "STATE_CHANGED",
      source: params.source,
      impact_level: profile.impactLevel,
      operation_state: profile.operationState,
      operator_summary: profile.operatorSummary,
      allow_send: profile.allowSend,
      allow_new_active: profile.allowNewActive,
      entered_at: params.enteredAt,
      metadata: params.metadata || {},
    });
  } catch (err) {
    console.warn("[whatsapp-guardian-state] transition log failed:", err);
  }
}
