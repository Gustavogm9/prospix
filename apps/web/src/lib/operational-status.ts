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

const SETTINGS_INTEGRATIONS_HREF = '/configuracoes?tab=integracoes';

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
      bannerDetail: `Estado: ${currentStateLabel} ha ${durationLabel}. Acao: ${requiredAction}`,
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
      bannerDetail: `Estado: ${currentStateLabel} ha ${durationLabel}. Acao: ${requiredAction}`,
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
    return {
      connectionStatus,
      indicatorLabel: 'IA em cuidado',
      indicatorTone: tone === 'green' ? 'blue' : tone,
      showBanner: true,
      bannerTone: tone === 'green' ? 'blue' : tone,
      bannerTitle: 'IA em cuidado',
      bannerBody: aiActivity?.summary || currentStateSummary,
      bannerDetail: `Estado: ${currentStateLabel} ha ${durationLabel}. Acao: ${requiredAction}`,
      actionHref: SETTINGS_INTEGRATIONS_HREF,
      actionLabel: 'Ver diagnostico',
      conversationTitle: 'IA conduzindo com cuidado',
      conversationBody: 'A IA pode responder, mas novas prospeccoes podem ser reduzidas ou adiadas para proteger o numero.',
      conversationBadgeLabel: 'IA em cuidado',
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
      bannerDetail: `Estado: ${currentStateLabel} ha ${durationLabel}.`,
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
    bannerDetail: `Estado: ${currentStateLabel} ha ${durationLabel}.`,
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
