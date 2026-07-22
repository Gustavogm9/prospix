'use client';

export type OperationalSeverity = 'INFO' | 'OBSERVATION' | 'ATTENTION' | 'CRITICAL';
export type OperationalTone = 'neutral' | 'green' | 'blue' | 'amber' | 'red';

export type OperationalCurrentState = {
  status: string;
  label: string;
  impactLevel: OperationalSeverity;
  operationState: 'ACTIVE' | 'THROTTLED' | 'BLOCKED' | 'REQUIRES_ACTION' | string;
  enteredAt: string | null;
  durationSeconds: number | null;
  allowSend: boolean;
  allowNewActive: boolean;
  summary: string;
};

export type OperationalAiActivity = {
  state: 'OK' | 'WATCH' | 'STALLED' | 'BLOCKED' | 'OFF_HOURS';
  label: string;
  severity: OperationalSeverity;
  summary: string;
  requiredAction: string;
  isOperatingWindow: boolean;
  operatingWindowLabel: string;
  contactableBacklog?: number;
  firstTouchEligibility?: {
    eligible: number;
    totalEvaluated: number;
    byReason: Record<string, number>;
    topBlockingReason: string | null;
    topBlockingReasonLabel: string | null;
    topBlockingReasonCount: number;
  };
  duePending?: number;
  unansweredConversations?: number;
  outboundToday?: number;
  outboundLast60m?: number;
  lastOutboundAt?: string | null;
  lastInboundAt?: string | null;
};

export type OperationalGuardianTrace = {
  currentState?: OperationalCurrentState | null;
  aiActivity?: OperationalAiActivity | null;
  workerSnapshot?: {
    activePending?: number;
    duePending?: number;
    sentToday?: number;
    sentLast60m?: number;
    latestAiMessageAt?: string | null;
    nextScheduledFor?: string | null;
    guardianBlockingSend?: boolean;
    guardianBlockSummary?: string | null;
    guardianStatus?: string | null;
    guardianReasonCode?: string | null;
    firstTouchEligible?: number;
    firstTouchEvaluated?: number;
    blockedOrFailedLast24h?: number;
    latestQueue?: {
      status?: string | null;
      messageType?: string | null;
      failedReason?: string | null;
      validationReasonCode?: string | null;
      finalGuardianDecision?: string | null;
    } | null;
  } | null;
  status?: {
    status?: string | null;
    stateReasonCode?: string | null;
    lastDisconnectReasonCode?: string | null;
    updatedAt?: string | null;
  } | null;
};

export type OperationalStatusResponse = {
  status?: string | null;
  reason?: string | null;
  configured?: boolean;
  instanceName?: string | null;
  guardianTrace?: OperationalGuardianTrace | null;
};

export type OperationalStatusView = {
  connectionStatus: 'connected' | 'disconnected' | 'unknown';
  indicatorLabel: string;
  indicatorTone: OperationalTone;
  showBanner: boolean;
  bannerTone: OperationalTone;
  bannerTitle: string;
  bannerBody: string;
  bannerDetail: string;
  actionHref: string;
  actionLabel: string;
  conversationTitle: string;
  conversationBody: string;
  conversationBadgeLabel: string;
  conversationTone: OperationalTone;
  currentStateLabel: string;
  currentStateSummary: string;
  durationLabel: string;
  requiredAction: string;
  canSend: boolean;
  canStartNewConversations: boolean;
};

const SETTINGS_INTEGRATIONS_HREF = '/configuracoes?tab=integracoes#diagnostico-operacional';

function firstTouchEligibilityDetail(aiActivity?: OperationalAiActivity | null): string | null {
  const eligibility = aiActivity?.firstTouchEligibility;
  if (!eligibility || eligibility.totalEvaluated <= 0) return null;

  const reason = eligibility.topBlockingReasonLabel || 'sem bloqueio dominante';
  if (eligibility.eligible <= 0) {
    return `Elegibilidade: 0 de ${eligibility.totalEvaluated} leads podem receber primeiro contato agora. Principal bloqueio: ${reason} (${eligibility.topBlockingReasonCount}).`;
  }

  return `Elegibilidade: ${eligibility.eligible} de ${eligibility.totalEvaluated} leads podem receber primeiro contato agora.`;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function workerExecutionDetail(trace?: OperationalGuardianTrace | null): string | null {
  const worker = trace?.workerSnapshot;
  if (!worker) return null;

  const duePending = Number(worker.duePending ?? 0);
  const activePending = Number(worker.activePending ?? 0);
  const sentToday = Number(worker.sentToday ?? 0);
  const sentLast60m = Number(worker.sentLast60m ?? 0);
  const firstTouchEligible = Number(worker.firstTouchEligible ?? 0);
  const firstTouchEvaluated = Number(worker.firstTouchEvaluated ?? 0);
  const blockedByConnection = Boolean(
    worker.guardianBlockingSend ||
    trace?.currentState?.operationState === 'BLOCKED' ||
    trace?.currentState?.operationState === 'REQUIRES_ACTION',
  );

  if (duePending > 0) {
    if (blockedByConnection) {
      return duePending === 1
        ? 'Execucao: 1 mensagem pronta aguarda reconexao do WhatsApp.'
        : `Execucao: ${countLabel(duePending, 'mensagem', 'mensagens')} prontas aguardam reconexao do WhatsApp.`;
    }
    return duePending === 1
      ? 'Execucao: 1 mensagem pronta ainda aguarda envio.'
      : `Execucao: ${countLabel(duePending, 'mensagem', 'mensagens')} prontas ainda aguardam envio.`;
  }
  if (activePending > 0) {
    return activePending === 1
      ? 'Execucao: 1 mensagem aguarda horario seguro na fila.'
      : `Execucao: ${countLabel(activePending, 'mensagem', 'mensagens')} aguardam horario seguro na fila.`;
  }
  if (sentLast60m > 0) {
    return `Execucao: ${countLabel(sentLast60m, 'mensagem', 'mensagens')} enviadas na ultima hora.`;
  }
  if (trace?.aiActivity?.isOperatingWindow && firstTouchEligible > 0 && sentToday === 0) {
    return firstTouchEligible === 1
      ? `Execucao: 1 de ${firstTouchEvaluated} lead esta pronto, mas ainda sem envio hoje.`
      : `Execucao: ${firstTouchEligible} de ${firstTouchEvaluated} leads estao prontos, mas ainda sem envio hoje.`;
  }
  return null;
}

function compactDetail(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null) return 'sem registro';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function toneFromSeverity(severity?: string | null): OperationalTone {
  if (severity === 'CRITICAL') return 'red';
  if (severity === 'ATTENTION') return 'amber';
  if (severity === 'OBSERVATION') return 'blue';
  return 'green';
}

function normalizeStatus(value?: string | null): 'connected' | 'disconnected' | 'unknown' {
  if (value === 'connected') return 'connected';
  if (value === 'disconnected') return 'disconnected';
  return 'unknown';
}

export function buildOperationalStatusView(
  response: OperationalStatusResponse | null,
  error: string | null = null,
): OperationalStatusView {
  const connectionStatus = normalizeStatus(response?.status);
  const trace = response?.guardianTrace ?? null;
  const currentState = trace?.currentState ?? null;
  const aiActivity = trace?.aiActivity ?? null;
  const durationLabel = formatDuration(currentState?.durationSeconds);
  const currentStateLabel = currentState?.label || 'Status nao confirmado';
  const currentStateSummary = currentState?.summary || 'Ainda nao ha diagnostico operacional confirmado para este tenant.';
  const requiredAction = aiActivity?.requiredAction || 'Acompanhar o proximo ciclo de envio.';
  const eligibilityDetail = firstTouchEligibilityDetail(aiActivity);
  const executionDetail = workerExecutionDetail(trace);

  if (error) {
    return {
      connectionStatus: 'unknown',
      indicatorLabel: 'Status indisponivel',
      indicatorTone: 'neutral',
      showBanner: false,
      bannerTone: 'neutral',
      bannerTitle: 'Status indisponivel',
      bannerBody: 'Nao foi possivel confirmar o estado operacional neste momento.',
      bannerDetail: error,
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Ver conexoes',
      conversationTitle: 'IA com status nao confirmado',
      conversationBody: 'O painel nao conseguiu confirmar agora se a IA esta enviando mensagens.',
      conversationBadgeLabel: 'IA sem status',
      conversationTone: 'neutral',
      currentStateLabel,
      currentStateSummary,
      durationLabel,
      requiredAction,
      canSend: false,
      canStartNewConversations: false,
    };
  }

  if (connectionStatus === 'disconnected') {
    const removed = response?.reason === 'device_removed';
    return {
      connectionStatus,
      indicatorLabel: 'WhatsApp desconectado',
      indicatorTone: 'red',
      showBanner: true,
      bannerTone: 'red',
      bannerTitle: 'WhatsApp desconectado',
      bannerBody: removed
        ? 'O aparelho removeu a conexao. A IA esta pausada ate o numero ser reconectado.'
        : 'A IA esta pausada porque o WhatsApp nao esta conectado.',
      bannerDetail: `Estado: ${currentStateLabel} ha ${durationLabel}. Acao: reconectar o WhatsApp.`,
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Reconectar',
      conversationTitle: 'IA pausada',
      conversationBody: 'Esta conversa esta marcada para IA, mas a IA nao consegue enviar enquanto o WhatsApp estiver desconectado.',
      conversationBadgeLabel: 'IA pausada',
      conversationTone: 'red',
      currentStateLabel,
      currentStateSummary,
      durationLabel,
      requiredAction: 'Reconectar o WhatsApp antes de esperar novos envios.',
      canSend: false,
      canStartNewConversations: false,
    };
  }

  if (connectionStatus === 'unknown') {
    return {
      connectionStatus,
      indicatorLabel: 'WhatsApp...',
      indicatorTone: 'neutral',
      showBanner: false,
      bannerTone: 'neutral',
      bannerTitle: 'Checando WhatsApp',
      bannerBody: 'O status operacional ainda esta sendo carregado.',
      bannerDetail: '',
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Ver conexoes',
      conversationTitle: 'IA com status carregando',
      conversationBody: 'O painel ainda esta confirmando se a IA pode enviar mensagens agora.',
      conversationBadgeLabel: 'IA checando',
      conversationTone: 'neutral',
      currentStateLabel,
      currentStateSummary,
      durationLabel,
      requiredAction,
      canSend: false,
      canStartNewConversations: false,
    };
  }

  const operationState = String(currentState?.operationState || 'ACTIVE').toUpperCase();
  const activityState = aiActivity?.state || 'OK';

  if (operationState === 'REQUIRES_ACTION' || operationState === 'BLOCKED' || activityState === 'BLOCKED') {
    return {
      connectionStatus,
      indicatorLabel: 'IA pausada',
      indicatorTone: 'red',
      showBanner: true,
      bannerTone: 'red',
      bannerTitle: 'IA pausada',
      bannerBody: currentStateSummary,
      bannerDetail: compactDetail([`Estado: ${currentStateLabel} ha ${durationLabel}.`, eligibilityDetail, executionDetail, `Acao: ${requiredAction}`]),
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Ver status',
      conversationTitle: 'IA pausada',
      conversationBody: 'A conversa esta com IA ativa no cadastro, mas os envios automaticos estao pausados pelo estado operacional.',
      conversationBadgeLabel: 'IA pausada',
      conversationTone: 'red',
      currentStateLabel,
      currentStateSummary,
      durationLabel,
      requiredAction,
      canSend: false,
      canStartNewConversations: false,
    };
  }

  if (activityState === 'STALLED') {
    return {
      connectionStatus,
      indicatorLabel: 'IA com atraso',
      indicatorTone: 'amber',
      showBanner: true,
      bannerTone: 'amber',
      bannerTitle: 'IA com atraso operacional',
      bannerBody: aiActivity?.summary || 'Existe fila ou conversa aguardando acao fora da tolerancia.',
      bannerDetail: compactDetail([`Estado: ${currentStateLabel} ha ${durationLabel}.`, eligibilityDetail, executionDetail, `Acao: ${requiredAction}`]),
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Ver diagnostico',
      conversationTitle: 'IA com atraso',
      conversationBody: 'A IA pode estar apta a enviar, mas ha atraso operacional registrado. Acompanhe antes de depender do envio automatico.',
      conversationBadgeLabel: 'IA com atraso',
      conversationTone: 'amber',
      currentStateLabel,
      currentStateSummary,
      durationLabel,
      requiredAction,
      canSend: Boolean(currentState?.allowSend ?? true),
      canStartNewConversations: false,
    };
  }

  if (operationState === 'THROTTLED' || activityState === 'WATCH') {
    const tone = toneFromSeverity(aiActivity?.severity || currentState?.impactLevel);
    const isNoEligibleLead = aiActivity?.label === 'Sem lead elegivel';
    const isRecovery = String(currentState?.status || '').toUpperCase() === 'RECOVERY';
    return {
      connectionStatus,
      indicatorLabel: isRecovery ? 'Retomada segura' : 'IA em cuidado',
      indicatorTone: tone === 'green' ? 'blue' : tone,
      showBanner: true,
      bannerTone: tone === 'green' ? 'blue' : tone,
      bannerTitle: isRecovery ? 'Retomada segura' : 'IA em cuidado',
      bannerBody: aiActivity?.summary || currentStateSummary,
      bannerDetail: compactDetail([
        isRecovery
          ? 'Significa que o WhatsApp reconectou e a IA esta realinhando a fila antes de voltar ao ritmo normal.'
          : 'Significa que a IA nao esta desconectada, mas ha uma condicao operacional que impede ou reduz novas acoes automaticas.',
        `Estado: ${currentStateLabel} ha ${durationLabel}.`,
        eligibilityDetail,
        executionDetail,
        `Acao: ${requiredAction}`,
      ]),
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Ver diagnostico',
      conversationTitle: isRecovery ? 'IA em retomada segura' : 'IA conduzindo com cuidado',
      conversationBody: isNoEligibleLead
        ? 'A IA pode responder conversas existentes, mas nao iniciara novos contatos enquanto nao houver lead elegivel pelas regras atuais.'
        : isRecovery
          ? 'A IA pode responder conversas existentes e retomar apenas contatos recuperaveis, com cadencia reduzida ate normalizar.'
        : 'A IA pode responder, mas novas prospeccoes podem ser reduzidas ou adiadas ate a condicao operacional normalizar.',
      conversationBadgeLabel: isRecovery ? 'Retomada segura' : 'IA em cuidado',
      conversationTone: tone === 'green' ? 'blue' : tone,
      currentStateLabel,
      currentStateSummary,
      durationLabel,
      requiredAction,
      canSend: Boolean(currentState?.allowSend ?? true),
      canStartNewConversations: Boolean(currentState?.allowNewActive ?? false),
    };
  }

  if (activityState === 'OFF_HOURS') {
    return {
      connectionStatus,
      indicatorLabel: 'Fora do horario',
      indicatorTone: 'neutral',
      showBanner: false,
      bannerTone: 'neutral',
      bannerTitle: 'Fora do horario ativo',
      bannerBody: aiActivity?.summary || 'Fora do periodo esperado para novas prospeccoes.',
      bannerDetail: compactDetail([`Estado: ${currentStateLabel} ha ${durationLabel}.`, executionDetail]),
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Ver diagnostico',
      conversationTitle: 'IA fora do horario ativo',
      conversationBody: 'A conversa segue com IA, mas novas acoes automaticas podem aguardar a janela operacional.',
      conversationBadgeLabel: 'IA fora do horario',
      conversationTone: 'neutral',
      currentStateLabel,
      currentStateSummary,
      durationLabel,
      requiredAction,
      canSend: Boolean(currentState?.allowSend ?? true),
      canStartNewConversations: false,
    };
  }

  return {
    connectionStatus,
    indicatorLabel: 'WhatsApp conectado',
    indicatorTone: 'green',
    showBanner: false,
    bannerTone: 'green',
    bannerTitle: 'IA operacional',
    bannerBody: 'A IA pode responder e iniciar conversas dentro das regras configuradas.',
    bannerDetail: compactDetail([`Estado: ${currentStateLabel} ha ${durationLabel}.`, executionDetail]),
    actionHref: SETTINGS_INTEGRATIONS_HREF,
    actionLabel: 'Ver status',
    conversationTitle: 'IA conduzindo conversa',
    conversationBody: 'A IA esta apta a responder no WhatsApp dentro das regras configuradas.',
    conversationBadgeLabel: 'IA respondendo',
    conversationTone: 'green',
    currentStateLabel,
    currentStateSummary,
    durationLabel,
    requiredAction: 'Nenhuma acao imediata.',
    canSend: Boolean(currentState?.allowSend ?? true),
    canStartNewConversations: Boolean(currentState?.allowNewActive ?? true),
  };
}
