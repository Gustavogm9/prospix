'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Input,
  toast,
} from '@prospix/ui';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Inbox,
  Loader2,
  PlayCircle,
  PlugZap,
  QrCode,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { adminNextApi } from '@/lib/admin-api-fetch';

type Recipient = {
  id: string;
  label: string;
  whatsapp: string;
  active: boolean;
  report_enabled: boolean;
  disconnect_alerts_enabled: boolean;
  notes: string | null;
  created_at: string;
};

type Schedule = {
  id: string;
  name: string;
  recipient_id: string;
  active: boolean;
  interval_minutes: number;
  window_minutes: number;
  tenant_ids: string[] | null;
  include_numbers: boolean;
  include_recent_messages: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  admin_monitoring_recipients?: {
    id: string;
    label: string;
    whatsapp: string;
    active: boolean;
  } | null;
};

type ReportRun = {
  id: string;
  schedule_id: string | null;
  recipient_id: string;
  channel_id: string | null;
  status: string;
  period_start: string;
  period_end: string;
  ai_summary: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

type DisconnectDelivery = {
  id: string;
  tenant_id: string;
  recipient_id: string;
  channel_id: string | null;
  status: string;
  reason_code: string;
  external_state: string | null;
  ai_summary: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  tenants?: { id: string; name: string; slug: string } | null;
  admin_monitoring_recipients?: { id: string; label: string; whatsapp: string } | null;
};

type AiActivityAlertDelivery = {
  id: string;
  tenant_id: string;
  recipient_id: string;
  channel_id: string | null;
  incident_key: string;
  status: string;
  activity_state: string;
  severity: string;
  ai_summary: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  tenants?: { id: string; name: string; slug: string } | null;
  admin_monitoring_recipients?: { id: string; label: string; whatsapp: string } | null;
};

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type ChannelStatus = 'UNKNOWN' | 'PENDING_QR' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | string;

type ChannelEvent = {
  id: string;
  channel_id: string;
  event_type: string;
  connection_status: ChannelStatus | null;
  external_state: string | null;
  error: string | null;
  created_at: string;
};

type DispatcherRun = {
  id: string;
  mode: string;
  source: string;
  status: string;
  claimed_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

type GuardianCurrentState = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  status: string;
  label: string;
  impactLevel: 'INFO' | 'OBSERVATION' | 'ATTENTION' | 'CRITICAL' | string;
  operationState: 'ACTIVE' | 'THROTTLED' | 'BLOCKED' | 'REQUIRES_ACTION' | string;
  operationLabel: string;
  externalState: string | null;
  reasonCode: string | null;
  stateSource: string | null;
  enteredAt: string | null;
  durationSeconds: number | null;
  allowSend: boolean;
  allowNewActive: boolean;
  summary: string;
  lastCheckedAt: string | null;
  updatedAt: string | null;
};

type GuardianTransition = {
  tenantId: string;
  tenantName: string;
  previousStatus: string | null;
  status: string;
  externalState: string | null;
  reasonCode: string | null;
  impactLevel: string | null;
  operationState: string | null;
  operationLabel: string;
  operatorSummary: string | null;
  allowSend: boolean | null;
  allowNewActive: boolean | null;
  enteredAt: string;
  exitedAt: string | null;
  durationSeconds: number | null;
};

type AiActivityTenant = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string | null;
  state: 'OK' | 'WATCH' | 'STALLED' | 'BLOCKED' | 'OFF_HOURS';
  label: string;
  severity: 'INFO' | 'OBSERVATION' | 'ATTENTION' | 'CRITICAL';
  summary: string;
  requiredAction: string;
  isOperatingWindow: boolean;
  operatingWindowLabel: string;
  leadsCreatedToday: number;
  contactableBacklog: number;
  firstTouchEligibility?: {
    eligible: number;
    totalEvaluated: number;
    byReason: Record<string, number>;
    topBlockingReason: string | null;
    topBlockingReasonLabel: string | null;
    topBlockingReasonCount: number;
  };
  oldestContactableLeadAt: string | null;
  duePending: number;
  oldestDuePendingAt: string | null;
  unansweredConversations: number;
  oldestUnansweredInboundAt: string | null;
  outboundToday: number;
  outboundLast60m: number;
  inboundToday: number;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  guardianStatus: string | null;
  guardianOperationState: string | null;
  workerSnapshot?: {
    activePending: number;
    duePending: number;
    blockedOrFailedLast24h: number;
    nextScheduledFor: string | null;
    oldestDueAt: string | null;
    oldestDueAgeSeconds: number | null;
    sentToday: number;
    sentLast60m: number;
    latestAiMessageAt: string | null;
    guardianStatus: string | null;
    guardianExternalState: string | null;
    guardianReasonCode: string | null;
    guardianOperationState: string | null;
    guardianBlockingSend: boolean;
    guardianBlockSummary: string | null;
    firstTouchEligible: number;
    firstTouchEvaluated: number;
    latestQueue: {
      status: string | null;
      messageType: string | null;
      failedReason: string | null;
      validationReasonCode: string | null;
      finalGuardianDecision: string | null;
    } | null;
  } | null;
};

type WorkerDueQueueDiagnostic = {
  pendingOutboundId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  conversationId: string | null;
  leadId: string | null;
  leadName: string | null;
  leadSource: string | null;
  leadStatus: string | null;
  campaignName: string | null;
  campaignStatus: string | null;
  messageType: string | null;
  scheduledFor: string;
  dueAgeSeconds: number | null;
  attempts: number;
  validationStatus: string | null;
  validationReasonCode: string | null;
  finalGuardianDecision: string | null;
  conversationStatus: string | null;
  aiHandling: boolean | null;
  guardianStatus: string | null;
  guardianExternalState: string | null;
  guardianReasonCode: string | null;
  blockingReason: string;
  blockerKind: string;
  blocksSend: boolean;
  operatorSummary: string;
  recommendedAction: string;
};

type WebhookProcessingHealth = {
  total24h: number;
  processed24h: number;
  skipped24h: number;
  failed24h: number;
  staleProcessing: number;
  duplicateAttempts24h: number;
  failedOrStale24h: number;
  latestEventAt: string | null;
  latestFailedAt: string | null;
  generatedAt: string | null;
};

type WebhookProcessingFailure = {
  id: string;
  tenantId: string | null;
  tenantName: string;
  status: string;
  skipReason: string | null;
  errorMessage: string | null;
  attempts: number;
  acceptedAt: string | null;
  processingStartedAt: string | null;
  processedAt: string | null;
  failedAt: string | null;
  lastSeenAt: string | null;
  updatedAt: string | null;
  processingAgeSeconds: number | null;
  operatorSummary: string | null;
  recommendedAction: string | null;
};

type Dashboard = {
  channel: {
    configured: boolean;
    connected: boolean;
    channelId: string | null;
    label: string | null;
    source: string;
    instanceName: string | null;
    baseUrlConfigured: boolean;
    apiKeyConfigured: boolean;
    connectionStatus: ChannelStatus;
    externalState: string | null;
    lastQrRequestedAt: string | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
    reason: string | null;
    dispatcherReachable?: boolean;
    dispatcherError?: string | null;
  };
  summary: {
    recipients: number;
    activeRecipients: number;
    activeSchedules: number;
    overdueSchedules: number;
    failedReports24h: number;
    disconnectAlerts24h: number;
    guardianAttentionStates?: number;
    aiActivityIssues?: number;
    aiActivityAlerts24h?: number;
    dueQueueItems?: number;
    webhookProcessingFailures24h?: number;
    webhookProcessingStale?: number;
    webhookProcessingDuplicates24h?: number;
    webhookProcessingIssues?: number;
  };
  scheduler: {
    lastRunAt: string | null;
    lastCompletedAt: string | null;
    lastStatus: string | null;
    lastSource: string | null;
    lastError: string | null;
    lastClaimedCount: number | null;
    lastSentCount: number | null;
    lastFailedCount: number | null;
    overdueSchedules: number;
    nextDueAt: string | null;
  };
  recipients: Recipient[];
  schedules: Schedule[];
  reportRuns: ReportRun[];
  disconnectDeliveries: DisconnectDelivery[];
  channelEvents: ChannelEvent[];
  dispatcherRuns: DispatcherRun[];
  tenants: Tenant[];
  guardianStates?: {
    available: boolean;
    schemaVersion: string;
    statusError: string | null;
    transitionLogAvailable: boolean;
    transitionLogError: string | null;
    current: GuardianCurrentState[];
    recentTransitions: GuardianTransition[];
  };
  aiActivity?: {
    generatedAt: string;
    operatingWindow: {
      isOpen: boolean;
      label: string;
      dayStartAt: string;
      operatingStartAt: string;
      operatingEndAt: string;
    };
    summary: {
      totalTenants: number;
      ok: number;
      watch: number;
      stalled: number;
      blocked: number;
      offHours: number;
    };
    tenants: AiActivityTenant[];
    evidenceErrors: string[];
  };
  aiActivityAlertDeliveries?: {
    available: boolean;
    error: string | null;
    rows: AiActivityAlertDelivery[];
  };
  workerDueQueueDiagnostics?: {
    available: boolean;
    error: string | null;
    rows: WorkerDueQueueDiagnostic[];
  };
  webhookProcessing?: {
    available: boolean;
    error: string | null;
    health: WebhookProcessingHealth | null;
    rows: WebhookProcessingFailure[];
  };
};

const STATUS_STYLE: Record<string, string> = {
  SENT: 'bg-success-soft text-success-text border-success/30',
  SUCCEEDED: 'bg-success-soft text-success-text border-success/30',
  COMPLETED_WITH_FAILURES: 'bg-amber-50 text-amber-800 border-amber-300',
  RUNNING: 'bg-blue-50 text-blue-700 border-blue-200',
  PENDING: 'bg-amber-50 text-amber-800 border-amber-300',
  FAILED: 'bg-red-50 text-red-700 border-red-200',
  SKIPPED: 'bg-surface-sunken text-text-secondary border-border',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'n/d';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'n/d';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClass(status: string): string {
  return STATUS_STYLE[status] || 'bg-surface-sunken text-text-secondary border-border';
}

function isScheduleOverdue(schedule: Schedule): boolean {
  if (!schedule.active) return false;
  const nextRunAt = new Date(schedule.next_run_at).getTime();
  return Number.isFinite(nextRunAt) && nextRunAt <= Date.now();
}

function channelStatusLabel(status: ChannelStatus | null | undefined): string {
  switch (status) {
    case 'CONNECTED':
      return 'Conectado';
    case 'PENDING_QR':
      return 'Aguardando QR';
    case 'DISCONNECTED':
      return 'Desconectado';
    case 'ERROR':
      return 'Erro';
    default:
      return 'Pendente';
  }
}

function channelStatusClass(status: ChannelStatus | null | undefined): string {
  switch (status) {
    case 'CONNECTED':
      return 'bg-success-soft text-success-text border-success/30';
    case 'PENDING_QR':
      return 'bg-amber-50 text-amber-800 border-amber-300';
    case 'DISCONNECTED':
    case 'ERROR':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-surface-sunken text-text-secondary border-border';
  }
}

function formatDuration(seconds: number | null | undefined): string {
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

function guardianImpactClass(impact: string | null | undefined): string {
  if (impact === 'CRITICAL') return 'bg-red-50 text-red-700 border-red-200';
  if (impact === 'ATTENTION') return 'bg-amber-50 text-amber-800 border-amber-300';
  if (impact === 'OBSERVATION') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-success-soft text-success-text border-success/30';
}

function aiActivityClass(severity: string | null | undefined): string {
  if (severity === 'CRITICAL') return 'bg-red-50 text-red-700 border-red-200';
  if (severity === 'ATTENTION') return 'bg-amber-50 text-amber-800 border-amber-300';
  if (severity === 'OBSERVATION') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-success-soft text-success-text border-success/30';
}

function workerQueueLabel(row: AiActivityTenant): string {
  const worker = row.workerSnapshot;
  if (!worker) return 'sem leitura';
  if (worker.duePending > 0 && worker.guardianBlockingSend) return 'aguardando reconexao';
  if (worker.duePending > 0) return 'fila atrasada';
  if (worker.activePending > 0) return 'em espera';
  if (worker.sentLast60m > 0) return 'enviando';
  return 'sem fila';
}

function messageTypeLabel(messageType: string | null | undefined): string {
  if (messageType === 'OUTBOUND_START') return 'Primeiro contato';
  if (messageType === 'COMMERCIAL_FOLLOWUP') return 'Follow-up';
  if (messageType === 'REACTIVE_REPLY') return 'Resposta ao lead';
  if (messageType === 'CHAT_CONTINUATION') return 'Continuidade';
  if (messageType === 'LOOKUP_REPLY') return 'Resposta com pesquisa';
  return 'Mensagem da IA';
}

function blockerKindLabel(kind: string | null | undefined): string {
  if (kind === 'CONNECTION') return 'Conexao';
  if (kind === 'GUARDIAN') return 'Guardian';
  if (kind === 'CONVERSATION') return 'Conversa';
  if (kind === 'LEAD') return 'Lead';
  if (kind === 'WORKER') return 'Worker';
  return 'Diagnostico';
}

function blockerKindClass(row: WorkerDueQueueDiagnostic): string {
  if (row.blocksSend && row.blockerKind === 'CONNECTION')
    return 'bg-red-50 text-red-700 border-red-200';
  if (row.blocksSend) return 'bg-amber-50 text-amber-800 border-amber-300';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function webhookProcessingStatusLabel(row: WebhookProcessingFailure): string {
  const status = String(row.status || '').toUpperCase();
  if (status === 'FAILED') return 'Falhou ao registrar';
  if (status === 'PROCESSING') return 'Aberta em processamento';
  if (status === 'SKIPPED') return 'Ignorada corretamente';
  if (status === 'PROCESSED') return 'Registrada';
  return 'Precisa de revisao';
}

function webhookProcessingStatusClass(row: WebhookProcessingFailure): string {
  const status = String(row.status || '').toUpperCase();
  if (status === 'FAILED') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'PROCESSING') return 'bg-amber-50 text-amber-800 border-amber-300';
  if (row.attempts > 1) return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-surface-sunken text-text-secondary border-border';
}

function webhookIssueTime(row: WebhookProcessingFailure): string | null {
  return row.failedAt || row.updatedAt || row.acceptedAt;
}

function webhookHealthText(health: WebhookProcessingHealth | null | undefined): string {
  if (!health) return 'Diagnostico indisponivel.';
  if (health.failedOrStale24h > 0) {
    return `${countLabel(health.failedOrStale24h, 'entrada precisa', 'entradas precisam')} de revisao agora.`;
  }
  if (health.total24h === 0) return 'Nenhuma entrada recebida nas ultimas 24h.';
  return 'Entradas recebidas sem falhas ativas.';
}

function canExecuteWebhookReprocess(row: WebhookProcessingFailure): boolean {
  const status = String(row.status || '').toUpperCase();
  return status === 'FAILED' || status === 'PROCESSING';
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatToken(value: string | null | undefined): string {
  return value ? value.replaceAll('_', ' ') : '-';
}

function qrImageSrc(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('http')) return value;
  return `data:image/png;base64,${value}`;
}

export default function AdminMonitoringPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [createRecipientOpen, setCreateRecipientOpen] = useState(false);
  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);
  const [channelQr, setChannelQr] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState({
    label: 'Canal administrativo',
    instanceName: 'prospix_admin_monitoring',
    baseUrl: '',
  });

  const [recipientForm, setRecipientForm] = useState({
    label: '',
    whatsapp: '',
    reportEnabled: true,
    disconnectAlertsEnabled: true,
    notes: '',
  });

  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    recipientId: '',
    intervalMinutes: 60,
    windowMinutes: 60,
    tenantScope: 'all',
    tenantId: '',
    includeNumbers: true,
    includeRecentMessages: true,
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await adminNextApi.get('/api/admin/monitoring');
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao carregar.');
      setData(response.data as Dashboard);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar monitoramento.';
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const currentChannel = data?.channel;
    if (!currentChannel) return;
    setChannelForm((form) => ({
      ...form,
      label: currentChannel.label || form.label,
      instanceName: currentChannel.instanceName || form.instanceName,
    }));
  }, [data?.channel]);

  const activeRecipients = useMemo(
    () => (data?.recipients || []).filter((recipient) => recipient.active),
    [data?.recipients],
  );

  const connectChannel = async () => {
    if (!channelForm.instanceName.trim()) {
      toast.error('Instancia obrigatoria', 'Informe o nome da instancia administrativa.');
      return;
    }

    setBusyKey('channel:connect');
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'connect_channel',
        ...channelForm,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao gerar QR Code.');
      setChannelQr(response.data.qrcode || null);
      toast.success(response.data.qrcode ? 'QR Code gerado' : 'Canal solicitado');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao gerar QR Code.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const refreshChannel = async (requestQr = false) => {
    setBusyKey(requestQr ? 'channel:qr' : 'channel:refresh');
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'refresh_channel',
        requestQr,
      });
      if (!response.data?.ok)
        throw new Error(response.data?.message || 'Falha ao atualizar canal.');
      if (response.data.qrcode) setChannelQr(response.data.qrcode);
      if (!requestQr && response.data.channel?.connected) setChannelQr(null);
      toast.success(requestQr && response.data.qrcode ? 'QR Code atualizado' : 'Status atualizado');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao atualizar canal.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const disconnectChannel = async () => {
    if (!confirm('Desconectar o canal administrativo de envio?')) return;
    setBusyKey('channel:disconnect');
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'disconnect_channel',
      });
      if (!response.data?.ok)
        throw new Error(response.data?.message || 'Falha ao desconectar canal.');
      setChannelQr(null);
      toast.success('Canal desconectado');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao desconectar canal.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const createRecipient = async () => {
    if (!recipientForm.label.trim() || !recipientForm.whatsapp.trim()) {
      toast.error('Campos obrigatorios', 'Informe nome e WhatsApp.');
      return;
    }

    setBusyKey('recipient:create');
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'create_recipient',
        ...recipientForm,
      });
      if (!response.data?.ok)
        throw new Error(response.data?.message || 'Falha ao salvar destinatario.');
      toast.success('Destinatario salvo');
      setCreateRecipientOpen(false);
      setRecipientForm({
        label: '',
        whatsapp: '',
        reportEnabled: true,
        disconnectAlertsEnabled: true,
        notes: '',
      });
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao salvar.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const createSchedule = async () => {
    if (!scheduleForm.name.trim() || !scheduleForm.recipientId) {
      toast.error('Campos obrigatorios', 'Informe nome e destinatario.');
      return;
    }

    setBusyKey('schedule:create');
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'create_schedule',
        name: scheduleForm.name,
        recipientId: scheduleForm.recipientId,
        intervalMinutes: scheduleForm.intervalMinutes,
        windowMinutes: scheduleForm.windowMinutes,
        tenantIds:
          scheduleForm.tenantScope === 'one' && scheduleForm.tenantId
            ? [scheduleForm.tenantId]
            : null,
        includeNumbers: scheduleForm.includeNumbers,
        includeRecentMessages: scheduleForm.includeRecentMessages,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao criar agenda.');
      toast.success('Agenda criada');
      setCreateScheduleOpen(false);
      setScheduleForm({
        name: '',
        recipientId: '',
        intervalMinutes: 60,
        windowMinutes: 60,
        tenantScope: 'all',
        tenantId: '',
        includeNumbers: true,
        includeRecentMessages: true,
      });
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao criar agenda.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const patchItem = async (
    type: 'recipient' | 'schedule',
    id: string,
    patch: Record<string, unknown>,
  ) => {
    setBusyKey(`${type}:${id}`);
    try {
      const response = await adminNextApi.patch('/api/admin/monitoring', { type, id, ...patch });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao atualizar.');
      toast.success('Atualizado');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao atualizar.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const deleteItem = async (type: 'recipient' | 'schedule', id: string) => {
    if (!confirm(type === 'recipient' ? 'Excluir destinatario?' : 'Excluir agenda?')) return;
    setBusyKey(`${type}:delete:${id}`);
    try {
      const response = await adminNextApi.delete(`/api/admin/monitoring?type=${type}&id=${id}`);
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao excluir.');
      toast.success('Excluido');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao excluir.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const sendTest = async (recipientId: string) => {
    setBusyKey(`test:${recipientId}`);
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'send_test',
        recipientId,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha no teste.');
      const result = response.data?.result?.result;
      if (result?.ok === false) throw new Error(result.error || 'Envio recusado pelo canal.');
      toast.success('Teste enviado');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha no teste.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const runScheduleNow = async (scheduleId: string) => {
    setBusyKey(`run:${scheduleId}`);
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'run_schedule_now',
        scheduleId,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao executar.');
      toast.success('Execucao solicitada');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao executar.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const reprocessWebhookEvent = async (row: WebhookProcessingFailure, dryRun: boolean) => {
    const reason = dryRun
      ? `Validacao operacional solicitada pelo painel para ${row.tenantName}.`
      : window.prompt('Informe o motivo do reprocessamento desta entrada do WhatsApp:')?.trim() ||
        '';

    if (!reason || reason.length < 10) {
      toast.error('Motivo obrigatorio', 'Informe um motivo claro com pelo menos 10 caracteres.');
      return;
    }

    const key = dryRun ? `webhook:dry:${row.id}` : `webhook:run:${row.id}`;
    setBusyKey(key);
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'webhook_reprocess',
        processingEventId: row.id,
        dryRun,
        reason,
      });
      if (!response.data?.ok)
        throw new Error(response.data?.message || 'Falha ao processar entrada.');
      const result = response.data.result || {};
      if (dryRun) {
        toast.success(
          result.replayable ? 'Entrada elegivel' : 'Entrada nao elegivel',
          result.reason || 'Validacao concluida.',
        );
      } else {
        toast.success(
          'Reprocessamento aceito',
          'A entrada foi reenviada para processamento seguro.',
        );
      }
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao processar entrada.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const channel = data?.channel;
  const scheduler = data?.scheduler;
  const qrSrc = qrImageSrc(channelQr);
  const channelConnected = channel?.connectionStatus === 'CONNECTED';
  const channelBusy = busyKey?.startsWith('channel:') || false;
  const guardianStates = data?.guardianStates;
  const guardianCurrent = guardianStates?.current || [];
  const guardianTransitions = guardianStates?.recentTransitions || [];
  const aiActivity = data?.aiActivity;
  const aiActivityRows = aiActivity?.tenants || [];
  const aiActivityAlertDeliveries = data?.aiActivityAlertDeliveries;
  const workerDueQueueDiagnostics = data?.workerDueQueueDiagnostics;
  const workerDueRows = workerDueQueueDiagnostics?.rows || [];
  const webhookProcessing = data?.webhookProcessing;
  const webhookHealth = webhookProcessing?.health || null;
  const webhookRows = webhookProcessing?.rows || [];

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-2xl font-bold tracking-tight text-text">
            <Radio className="h-5 w-5 text-primary" aria-hidden />
            Monitoramento ativo
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Relatorios programados, alertas de desconexao e trilha auditavel de entregas
            administrativas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={load}
            disabled={isLoading}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-xs text-text hover:bg-surface-sunken"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
            Atualizar
          </Button>
          <Button
            onClick={() => setCreateRecipientOpen((open) => !open)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-xs text-text hover:bg-surface-sunken"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden />
            Destinatario
          </Button>
          <Button
            onClick={() => setCreateScheduleOpen((open) => !open)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            Nova agenda
          </Button>
        </div>
      </div>

      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div>
              <CardTitle className="flex items-center gap-2 font-heading text-base font-bold text-text">
                {channelConnected ? (
                  <Wifi className="h-4 w-4 text-success-text" aria-hidden />
                ) : (
                  <WifiOff className="h-4 w-4 text-red-600" aria-hidden />
                )}
                Canal de envio administrativo
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-text-secondary">
                Remetente proprio para relatorios e alertas operacionais.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={`border px-2 py-0.5 text-[10px] ${channelStatusClass(channel?.connectionStatus)}`}
              >
                {channelStatusLabel(channel?.connectionStatus)}
              </Badge>
              <Button
                onClick={() => refreshChannel(false)}
                disabled={!channel?.channelId || channelBusy}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-xs text-text hover:bg-surface-sunken"
              >
                {busyKey === 'channel:refresh' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Status
              </Button>
              <Button
                onClick={connectChannel}
                disabled={channelBusy || channelConnected}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover"
              >
                {busyKey === 'channel:connect' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <QrCode className="h-3.5 w-3.5" />
                )}
                Gerar QR
              </Button>
              <Button
                onClick={disconnectChannel}
                disabled={!channel?.channelId || channelBusy}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-red-100 bg-white px-3 text-xs text-red-700 hover:bg-red-50"
              >
                {busyKey === 'channel:disconnect' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlugZap className="h-3.5 w-3.5" />
                )}
                Desconectar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_260px]">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Nome">
                  <Input
                    value={channelForm.label}
                    onChange={(event) =>
                      setChannelForm((form) => ({ ...form, label: event.target.value }))
                    }
                    className="h-9 text-xs"
                    disabled={channelBusy}
                  />
                </Field>
                <Field label="Instancia Evolution">
                  <Input
                    value={channelForm.instanceName}
                    onChange={(event) =>
                      setChannelForm((form) => ({ ...form, instanceName: event.target.value }))
                    }
                    className="h-9 font-mono text-xs"
                    disabled={channelBusy || channelConnected}
                  />
                </Field>
                <Field label="Base URL Evolution">
                  <Input
                    value={channelForm.baseUrl}
                    onChange={(event) =>
                      setChannelForm((form) => ({ ...form, baseUrl: event.target.value }))
                    }
                    placeholder="padrao do ambiente"
                    className="h-9 font-mono text-xs"
                    disabled={channelBusy || channelConnected}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3 xl:grid-cols-6">
                <StatusCell label="Instancia ativa" value={channel?.instanceName || 'n/d'} mono />
                <StatusCell label="Ultima checagem" value={formatDate(channel?.lastCheckedAt)} />
                <StatusCell label="Estado externo" value={channel?.externalState || 'n/d'} mono />
                <StatusCell
                  label="Chave Evolution"
                  value={channel?.apiKeyConfigured ? 'configurada' : 'ausente'}
                />
                <StatusCell label="Scheduler" value={scheduler?.lastStatus || 'sem run'} />
                <StatusCell label="Ultimo check" value={formatDate(scheduler?.lastRunAt)} />
              </div>

              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                <StatusCell
                  label="Agendas vencidas"
                  value={String(scheduler?.overdueSchedules ?? 0)}
                />
                <StatusCell
                  label="Ultimo claim"
                  value={
                    scheduler?.lastClaimedCount == null ? 'n/d' : String(scheduler.lastClaimedCount)
                  }
                />
                <StatusCell label="Proxima agenda" value={formatDate(scheduler?.nextDueAt)} />
              </div>

              {(channel?.lastError ||
                channel?.dispatcherReachable === false ||
                scheduler?.lastError) && (
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {channel?.lastError ||
                    channel?.dispatcherError ||
                    scheduler?.lastError ||
                    'Dispatcher indisponivel.'}
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-border">
                <div className="min-w-[620px]">
                  <div className="grid grid-cols-[150px_120px_1fr_110px] gap-3 bg-surface-sunken px-3 py-2 text-[10px] uppercase tracking-wider text-text-secondary">
                    <span>Evento</span>
                    <span>Status</span>
                    <span>Estado/erro</span>
                    <span>Quando</span>
                  </div>
                  {(data?.channelEvents || []).slice(0, 4).map((event) => (
                    <div
                      key={event.id}
                      className="border-border/60 grid grid-cols-[150px_120px_1fr_110px] gap-3 border-t px-3 py-2 text-xs"
                    >
                      <span className="truncate font-mono text-text">{event.event_type}</span>
                      <span className="truncate text-text-secondary">
                        {channelStatusLabel(event.connection_status || 'UNKNOWN')}
                      </span>
                      <span className="truncate text-text-secondary">
                        {event.error || event.external_state || '-'}
                      </span>
                      <span className="text-text-secondary">{formatDate(event.created_at)}</span>
                    </div>
                  ))}
                  {(data?.channelEvents || []).length === 0 && (
                    <div className="border-border/60 border-t px-3 py-4 text-center text-xs text-text-secondary">
                      Nenhum evento do canal registrado.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-border bg-surface-sunken p-4">
              {qrSrc ? (
                <>
                  <img
                    src={qrSrc}
                    alt="QR Code do canal administrativo"
                    className="h-[220px] w-[220px] rounded border border-border bg-white object-contain shadow-sm"
                  />
                  <span className="mt-3 text-[10px] text-text-secondary">
                    Aguardando leitura no WhatsApp.
                  </span>
                </>
              ) : (
                <div className="flex h-[220px] w-[220px] flex-col items-center justify-center rounded border border-dashed border-border bg-white text-text-secondary">
                  <QrCode className="mb-2 h-8 w-8" aria-hidden />
                  <span className="text-xs">
                    {channelConnected ? 'Canal conectado' : 'QR Code indisponivel'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card className="border-border bg-white shadow-sm">
          <CardContent className="pb-3 pt-4">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
              Canal
            </span>
            <div className="mt-2 flex items-center gap-2">
              {channelConnected ? (
                <CheckCircle2 className="h-4 w-4 text-success-text" />
              ) : (
                <XCircle className="h-4 w-4 text-error-text" />
              )}
              <span className="text-sm font-semibold text-text">
                {channelStatusLabel(channel?.connectionStatus)}
              </span>
            </div>
            <p className="mt-1 truncate text-[10px] text-text-secondary">
              {channel?.instanceName || channel?.source || 'n/d'}
            </p>
            {channel?.dispatcherReachable === false && (
              <p className="mt-1 truncate text-[10px] text-red-600">dispatcher indisponivel</p>
            )}
          </CardContent>
        </Card>
        <MetricCard label="Destinatarios ativos" value={data?.summary.activeRecipients ?? 0} />
        <MetricCard label="Agendas ativas" value={data?.summary.activeSchedules ?? 0} />
        <MetricCard
          label="Agendas vencidas"
          value={data?.summary.overdueSchedules ?? 0}
          tone={(data?.summary.overdueSchedules ?? 0) > 0 ? 'red' : 'normal'}
        />
        <MetricCard
          label="Falhas recentes"
          value={data?.summary.failedReports24h ?? 0}
          tone={(data?.summary.failedReports24h ?? 0) > 0 ? 'red' : 'normal'}
        />
        <MetricCard label="Alertas recentes" value={data?.summary.disconnectAlerts24h ?? 0} />
        <MetricCard
          label="IA em atencao"
          value={data?.summary.aiActivityIssues ?? 0}
          tone={(data?.summary.aiActivityIssues ?? 0) > 0 ? 'red' : 'normal'}
        />
        <MetricCard
          label="Alertas IA"
          value={data?.summary.aiActivityAlerts24h ?? 0}
          tone={(data?.summary.aiActivityAlerts24h ?? 0) > 0 ? 'red' : 'normal'}
        />
        <MetricCard
          label="Fila IA vencida"
          value={data?.summary.dueQueueItems ?? 0}
          tone={(data?.summary.dueQueueItems ?? 0) > 0 ? 'red' : 'normal'}
        />
        <MetricCard
          label="Entradas com falha"
          value={data?.summary.webhookProcessingFailures24h ?? 0}
          tone={(data?.summary.webhookProcessingFailures24h ?? 0) > 0 ? 'red' : 'normal'}
        />
        <MetricCard
          label="Entradas abertas"
          value={data?.summary.webhookProcessingStale ?? 0}
          tone={(data?.summary.webhookProcessingStale ?? 0) > 0 ? 'red' : 'normal'}
        />
        <MetricCard
          label="Reenvios seguros"
          value={data?.summary.webhookProcessingDuplicates24h ?? 0}
        />
      </div>

      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div>
              <CardTitle className="flex items-center gap-2 font-heading text-base font-bold text-text">
                <Inbox className="h-4 w-4 text-primary" aria-hidden />
                Entrada de mensagens do WhatsApp
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-text-secondary">
                Confirma se as mensagens recebidas pela Evolution entraram no Prospix sem travar ou
                duplicar conversas.
              </CardDescription>
            </div>
            <Badge
              className={`border px-2 py-0.5 text-[10px] ${(webhookHealth?.failedOrStale24h ?? 0) > 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-success/30 bg-success-soft text-success-text'}`}
            >
              {webhookProcessing?.available !== false
                ? webhookHealthText(webhookHealth)
                : 'diagnostico indisponivel'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {webhookProcessing?.error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
              <span>Diagnostico pendente no banco: {webhookProcessing.error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3 xl:grid-cols-6">
            <StatusCell label="Recebidas 24h" value={String(webhookHealth?.total24h ?? 0)} />
            <StatusCell label="Registradas" value={String(webhookHealth?.processed24h ?? 0)} />
            <StatusCell label="Ignoradas" value={String(webhookHealth?.skipped24h ?? 0)} />
            <StatusCell label="Falhas" value={String(webhookHealth?.failed24h ?? 0)} />
            <StatusCell label="Abertas" value={String(webhookHealth?.staleProcessing ?? 0)} />
            <StatusCell label="Ultima entrada" value={formatDate(webhookHealth?.latestEventAt)} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="py-2 pr-3">Conta</th>
                  <th className="py-2 pr-3">Situacao</th>
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Tentativas</th>
                  <th className="py-2 pr-3">Resumo</th>
                  <th className="py-2 pr-3">Acao</th>
                  <th className="py-2 pr-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {webhookRows.map((row) => (
                  <tr key={row.id} className="border-border/50 border-b align-top">
                    <td className="min-w-[220px] py-3 pr-3">
                      <div className="font-semibold text-text">{row.tenantName}</div>
                      <div className="text-[10px] text-text-secondary">
                        {row.tenantId ? 'Conta identificada' : 'Sem conta associada'}
                      </div>
                    </td>
                    <td className="min-w-[160px] py-3 pr-3">
                      <Badge
                        className={`border px-1.5 py-0 text-[9px] ${webhookProcessingStatusClass(row)}`}
                      >
                        {webhookProcessingStatusLabel(row)}
                      </Badge>
                      {row.skipReason && (
                        <div className="mt-1 text-[10px] text-text-secondary">
                          {formatToken(row.skipReason)}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-text-secondary">
                      {formatDate(webhookIssueTime(row))}
                      {row.processingAgeSeconds != null && (
                        <div className="text-[10px]">
                          {formatDuration(row.processingAgeSeconds)}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-text-secondary">
                      {countLabel(row.attempts, 'tentativa', 'tentativas')}
                    </td>
                    <td className="min-w-[300px] max-w-[460px] py-3 pr-3 text-text-secondary">
                      {row.operatorSummary ||
                        row.errorMessage ||
                        'Entrada registrada para acompanhamento.'}
                    </td>
                    <td className="min-w-[300px] max-w-[460px] py-3 pr-3 text-text-secondary">
                      {row.recommendedAction || 'Acompanhar na proxima leitura.'}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex items-center justify-end gap-2">
                        <ActionButton
                          title="Validar"
                          busy={busyKey === `webhook:dry:${row.id}`}
                          onClick={() => reprocessWebhookEvent(row, true)}
                          icon={CheckCircle2}
                        />
                        {canExecuteWebhookReprocess(row) && (
                          <ActionButton
                            title="Reprocessar"
                            busy={busyKey === `webhook:run:${row.id}`}
                            onClick={() => reprocessWebhookEvent(row, false)}
                            icon={RotateCcw}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {webhookRows.length === 0 && (
                  <EmptyRow columns={7} label="Nenhuma falha de entrada encontrada." />
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div>
              <CardTitle className="font-heading text-base font-bold text-text">
                Fila vencida da IA
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-text-secondary">
                Mostra mensagens prontas que ja passaram do horario e o motivo operacional de nao
                terem avancado.
              </CardDescription>
            </div>
            <Badge
              className={`border px-2 py-0.5 text-[10px] ${workerDueQueueDiagnostics?.available !== false ? 'border-success/30 bg-success-soft text-success-text' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
            >
              {workerDueQueueDiagnostics?.available !== false
                ? countLabel(workerDueRows.length, 'item', 'itens')
                : 'diagnostico indisponivel'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {workerDueQueueDiagnostics?.error && (
            <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Diagnostico pendente no banco: {workerDueQueueDiagnostics.error}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="py-2 pr-3">Tenant</th>
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Mensagem</th>
                  <th className="py-2 pr-3">Atraso</th>
                  <th className="py-2 pr-3">Motivo</th>
                  <th className="py-2 pr-3">Acao</th>
                </tr>
              </thead>
              <tbody>
                {workerDueRows.map((row) => (
                  <tr key={row.pendingOutboundId} className="border-border/50 border-b align-top">
                    <td className="min-w-[210px] py-3 pr-3">
                      <div className="font-semibold text-text">{row.tenantName}</div>
                      <div className="text-[10px] text-text-secondary">
                        {row.tenantSlug || row.tenantId}
                      </div>
                    </td>
                    <td className="min-w-[190px] py-3 pr-3">
                      <div className="font-semibold text-text">
                        {row.leadName || 'Lead sem nome'}
                      </div>
                      <div className="text-[10px] text-text-secondary">
                        {row.campaignName || row.leadSource || 'sem campanha registrada'}
                      </div>
                    </td>
                    <td className="min-w-[130px] py-3 pr-3">
                      <div className="font-semibold text-text">
                        {messageTypeLabel(row.messageType)}
                      </div>
                      <div className="text-[10px] text-text-secondary">
                        agendada {formatDate(row.scheduledFor)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3">
                      <div className="font-semibold text-text">
                        {formatDuration(row.dueAgeSeconds)}
                      </div>
                      <div className="text-[10px] text-text-secondary">
                        {countLabel(row.attempts, 'tentativa', 'tentativas')}
                      </div>
                    </td>
                    <td className="min-w-[280px] max-w-[420px] py-3 pr-3">
                      <Badge className={`border px-1.5 py-0 text-[9px] ${blockerKindClass(row)}`}>
                        {blockerKindLabel(row.blockerKind)}
                      </Badge>
                      <p className="mt-1 leading-relaxed text-text-secondary">
                        {row.operatorSummary}
                      </p>
                    </td>
                    <td className="min-w-[280px] max-w-[420px] py-3 pr-3 text-text-secondary">
                      {row.recommendedAction}
                    </td>
                  </tr>
                ))}
                {workerDueRows.length === 0 && (
                  <EmptyRow columns={6} label="Nenhuma mensagem vencida na fila da IA." />
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div>
              <CardTitle className="font-heading text-base font-bold text-text">
                Atividade operacional da IA
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-text-secondary">
                Verifica se a IA esta iniciando contatos, respondendo conversas e esvaziando a fila
                dentro da tolerancia.
              </CardDescription>
            </div>
            <Badge
              className={`border px-2 py-0.5 text-[10px] ${aiActivity?.operatingWindow.isOpen ? 'border-success/30 bg-success-soft text-success-text' : 'border-border bg-surface-sunken text-text-secondary'}`}
            >
              {aiActivity?.operatingWindow.label || 'janela nao calculada'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(aiActivity?.evidenceErrors || []).length > 0 && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Coleta parcial: {aiActivity?.evidenceErrors.slice(0, 2).join(' | ')}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="py-2 pr-3">Tenant</th>
                  <th className="py-2 pr-3">Estado IA</th>
                  <th className="py-2 pr-3">Prospeccao</th>
                  <th className="py-2 pr-3">Conversas</th>
                  <th className="py-2 pr-3">Envios</th>
                  <th className="py-2 pr-3">Resumo</th>
                  <th className="py-2 pr-3">Ultimo sinal</th>
                </tr>
              </thead>
              <tbody>
                {aiActivityRows.map((row) => (
                  <tr key={row.tenantId} className="border-border/50 border-b align-top">
                    <td className="min-w-[220px] py-3 pr-3">
                      <div className="font-semibold text-text">{row.tenantName}</div>
                      <div className="text-[10px] text-text-secondary">{row.tenantSlug}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge
                        className={`border px-1.5 py-0 text-[9px] ${aiActivityClass(row.severity)}`}
                      >
                        {row.label}
                      </Badge>
                      <div className="mt-1 text-[10px] text-text-secondary">
                        {formatToken(row.guardianStatus)}
                      </div>
                    </td>
                    <td className="min-w-[150px] py-3 pr-3 text-text-secondary">
                      <div>
                        Leads hoje:{' '}
                        <span className="font-semibold text-text">{row.leadsCreatedToday}</span>
                      </div>
                      <div>
                        Elegiveis agora:{' '}
                        <span className="font-semibold text-text">{row.contactableBacklog}</span>
                      </div>
                      {row.firstTouchEligibility && (
                        <>
                          <div className="text-[10px]">
                            Avaliados:{' '}
                            <span className="font-semibold text-text">
                              {row.firstTouchEligibility.totalEvaluated}
                            </span>
                          </div>
                          {row.firstTouchEligibility.topBlockingReasonLabel && (
                            <div className="text-[10px]">
                              Bloqueio:{' '}
                              <span className="font-semibold text-text">
                                {row.firstTouchEligibility.topBlockingReasonLabel}
                              </span>{' '}
                              ({row.firstTouchEligibility.topBlockingReasonCount})
                            </div>
                          )}
                        </>
                      )}
                      <div className="text-[10px]">
                        Mais antigo: {formatDate(row.oldestContactableLeadAt)}
                      </div>
                    </td>
                    <td className="min-w-[150px] py-3 pr-3 text-text-secondary">
                      <div>
                        Sem resposta:{' '}
                        <span className="font-semibold text-text">
                          {row.unansweredConversations}
                        </span>
                      </div>
                      <div>
                        Entradas hoje:{' '}
                        <span className="font-semibold text-text">{row.inboundToday}</span>
                      </div>
                      <div className="text-[10px]">
                        Mais antiga: {formatDate(row.oldestUnansweredInboundAt)}
                      </div>
                    </td>
                    <td className="min-w-[150px] py-3 pr-3 text-text-secondary">
                      <div>
                        Hoje: <span className="font-semibold text-text">{row.outboundToday}</span>
                      </div>
                      <div>
                        Ultima hora:{' '}
                        <span className="font-semibold text-text">{row.outboundLast60m}</span>
                      </div>
                      <div>
                        Fila vencida:{' '}
                        <span className="font-semibold text-text">{row.duePending}</span>
                      </div>
                      {row.workerSnapshot && (
                        <>
                          <div className="text-[10px]">
                            Fila atual:{' '}
                            <span className="font-semibold text-text">
                              {row.workerSnapshot.activePending}
                            </span>
                          </div>
                          <div className="text-[10px]">
                            Situacao:{' '}
                            <span className="font-semibold text-text">{workerQueueLabel(row)}</span>
                          </div>
                          <div className="text-[10px]">
                            Bloqueios/falhas 24h:{' '}
                            <span className="font-semibold text-text">
                              {row.workerSnapshot.blockedOrFailedLast24h}
                            </span>
                          </div>
                        </>
                      )}
                    </td>
                    <td className="min-w-[300px] max-w-[460px] py-3 pr-3 text-text-secondary">
                      <div>{row.summary}</div>
                      <div className="mt-1 text-[10px]">Acao: {row.requiredAction}</div>
                      {row.workerSnapshot?.guardianBlockSummary && (
                        <div className="mt-1 text-[10px]">
                          Conexao: {row.workerSnapshot.guardianBlockSummary}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-text-secondary">
                      <div>IA: {formatDate(row.lastOutboundAt)}</div>
                      <div>Lead: {formatDate(row.lastInboundAt)}</div>
                    </td>
                  </tr>
                ))}
                {aiActivityRows.length === 0 && (
                  <EmptyRow columns={7} label="Nenhuma evidencia de atividade coletada." />
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div>
              <CardTitle className="font-heading text-base font-bold text-text">
                Estado dos WhatsApps dos usuarios
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-text-secondary">
                Mostra se a IA pode responder, iniciar conversas e ha quanto tempo cada numero esta
                no estado atual.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={`border px-2 py-0.5 text-[10px] ${guardianStates?.available ? 'border-success/30 bg-success-soft text-success-text' : 'border-red-200 bg-red-50 text-red-700'}`}
              >
                {guardianStates?.available ? 'Status disponivel' : 'Status indisponivel'}
              </Badge>
              <Badge
                className={`border px-2 py-0.5 text-[10px] ${guardianStates?.transitionLogAvailable ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
              >
                {guardianStates?.transitionLogAvailable ? 'Historico ativo' : 'Historico pendente'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {guardianStates?.statusError && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              Falha ao ler status do Guardian: {guardianStates.statusError}
            </div>
          )}
          {guardianStates?.transitionLogError && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Historico de mudancas ainda nao esta ativo no banco:{' '}
              {guardianStates.transitionLogError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="py-2 pr-3">Tenant</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Tempo</th>
                  <th className="py-2 pr-3">Operacao</th>
                  <th className="py-2 pr-3">IA</th>
                  <th className="py-2 pr-3">Resumo</th>
                  <th className="py-2 pr-3">Checagem</th>
                </tr>
              </thead>
              <tbody>
                {guardianCurrent.map((state) => (
                  <tr key={state.tenantId} className="border-border/50 border-b align-top">
                    <td className="min-w-[220px] py-3 pr-3">
                      <div className="font-semibold text-text">{state.tenantName}</div>
                      <div className="text-[10px] text-text-secondary">{state.tenantSlug}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge
                        className={`border px-1.5 py-0 text-[9px] ${guardianImpactClass(state.impactLevel)}`}
                      >
                        {state.label}
                      </Badge>
                      <div className="mt-1 text-[10px] text-text-secondary">
                        {formatToken(state.externalState)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-text-secondary">
                      {formatDuration(state.durationSeconds)}
                      <div className="text-[10px]">{formatDate(state.enteredAt)}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-text">{state.operationLabel}</div>
                      <div className="text-[10px] text-text-secondary">
                        {formatToken(state.reasonCode)}
                      </div>
                    </td>
                    <td className="min-w-[150px] py-3 pr-3">
                      <div
                        className={
                          state.allowSend
                            ? 'font-semibold text-success-text'
                            : 'font-semibold text-red-700'
                        }
                      >
                        Responder: {state.allowSend ? 'sim' : 'nao'}
                      </div>
                      <div
                        className={
                          state.allowNewActive
                            ? 'font-semibold text-success-text'
                            : 'font-semibold text-amber-800'
                        }
                      >
                        Prospec. nova: {state.allowNewActive ? 'sim' : 'cuidado'}
                      </div>
                    </td>
                    <td className="min-w-[280px] max-w-[420px] py-3 pr-3 text-text-secondary">
                      {state.summary}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-text-secondary">
                      {formatDate(state.lastCheckedAt || state.updatedAt)}
                    </td>
                  </tr>
                ))}
                {guardianCurrent.length === 0 && (
                  <EmptyRow columns={7} label="Nenhum status Guardian encontrado." />
                )}
              </tbody>
            </table>
          </div>

          {guardianTransitions.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <div className="min-w-[780px]">
                <div className="grid grid-cols-[220px_160px_130px_1fr_120px] gap-3 bg-surface-sunken px-3 py-2 text-[10px] uppercase tracking-wider text-text-secondary">
                  <span>Tenant</span>
                  <span>Mudanca</span>
                  <span>Tempo</span>
                  <span>Resumo</span>
                  <span>Quando</span>
                </div>
                {guardianTransitions.slice(0, 8).map((transition, index) => (
                  <div
                    key={`${transition.tenantId}-${transition.enteredAt}-${index}`}
                    className="border-border/60 grid grid-cols-[220px_160px_130px_1fr_120px] gap-3 border-t px-3 py-2 text-xs"
                  >
                    <span className="truncate font-semibold text-text">
                      {transition.tenantName}
                    </span>
                    <span className="truncate text-text-secondary">
                      {formatToken(transition.previousStatus)} para {formatToken(transition.status)}
                    </span>
                    <span className="text-text-secondary">
                      {transition.exitedAt
                        ? formatDuration(transition.durationSeconds)
                        : 'estado atual'}
                    </span>
                    <span className="truncate text-text-secondary">
                      {transition.operatorSummary || transition.operationLabel || '-'}
                    </span>
                    <span className="text-text-secondary">{formatDate(transition.enteredAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {createRecipientOpen && (
        <Card className="border-primary/30 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="font-heading text-base font-bold text-text">
              Cadastrar destinatario
            </CardTitle>
            <CardDescription className="text-xs text-text-secondary">
              Numero em E.164; exemplo +5517999999999.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Nome">
                <Input
                  value={recipientForm.label}
                  onChange={(event) =>
                    setRecipientForm((form) => ({ ...form, label: event.target.value }))
                  }
                  className="h-9 text-xs"
                />
              </Field>
              <Field label="WhatsApp">
                <Input
                  value={recipientForm.whatsapp}
                  onChange={(event) =>
                    setRecipientForm((form) => ({ ...form, whatsapp: event.target.value }))
                  }
                  placeholder="+5517999999999"
                  className="h-9 font-mono text-xs"
                />
              </Field>
              <Field label="Notas">
                <Input
                  value={recipientForm.notes}
                  onChange={(event) =>
                    setRecipientForm((form) => ({ ...form, notes: event.target.value }))
                  }
                  className="h-9 text-xs"
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
              <CheckboxLabel
                checked={recipientForm.reportEnabled}
                onChange={(checked) =>
                  setRecipientForm((form) => ({ ...form, reportEnabled: checked }))
                }
                label="Receber relatorios"
              />
              <CheckboxLabel
                checked={recipientForm.disconnectAlertsEnabled}
                onChange={(checked) =>
                  setRecipientForm((form) => ({ ...form, disconnectAlertsEnabled: checked }))
                }
                label="Receber quedas"
              />
              <Button
                onClick={createRecipient}
                disabled={busyKey === 'recipient:create'}
                className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs text-white hover:bg-primary-hover"
              >
                {busyKey === 'recipient:create' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Salvar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {createScheduleOpen && (
        <Card className="border-primary/30 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="font-heading text-base font-bold text-text">
              Criar agenda
            </CardTitle>
            <CardDescription className="text-xs text-text-secondary">
              A primeira execucao fica programada para o fim do intervalo informado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <Field label="Nome">
                <Input
                  value={scheduleForm.name}
                  onChange={(event) =>
                    setScheduleForm((form) => ({ ...form, name: event.target.value }))
                  }
                  className="h-9 text-xs"
                />
              </Field>
              <Field label="Destinatario">
                <select
                  value={scheduleForm.recipientId}
                  onChange={(event) =>
                    setScheduleForm((form) => ({ ...form, recipientId: event.target.value }))
                  }
                  className="focus:border-primary/50 h-9 w-full rounded-lg border border-border bg-white px-3 text-xs text-text focus:outline-none"
                >
                  <option value="">Selecione</option>
                  {activeRecipients.map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>
                      {recipient.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Intervalo min">
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={scheduleForm.intervalMinutes}
                  onChange={(event) =>
                    setScheduleForm((form) => ({
                      ...form,
                      intervalMinutes: Number(event.target.value),
                    }))
                  }
                  className="h-9 text-xs"
                />
              </Field>
              <Field label="Janela min">
                <Input
                  type="number"
                  min={5}
                  max={10080}
                  value={scheduleForm.windowMinutes}
                  onChange={(event) =>
                    setScheduleForm((form) => ({
                      ...form,
                      windowMinutes: Number(event.target.value),
                    }))
                  }
                  className="h-9 text-xs"
                />
              </Field>
              <Field label="Escopo">
                <select
                  value={scheduleForm.tenantScope}
                  onChange={(event) =>
                    setScheduleForm((form) => ({
                      ...form,
                      tenantScope: event.target.value,
                      tenantId: '',
                    }))
                  }
                  className="focus:border-primary/50 h-9 w-full rounded-lg border border-border bg-white px-3 text-xs text-text focus:outline-none"
                >
                  <option value="all">Todos</option>
                  <option value="one">Um tenant</option>
                </select>
              </Field>
            </div>
            {scheduleForm.tenantScope === 'one' && (
              <Field label="Tenant">
                <select
                  value={scheduleForm.tenantId}
                  onChange={(event) =>
                    setScheduleForm((form) => ({ ...form, tenantId: event.target.value }))
                  }
                  className="focus:border-primary/50 h-9 w-full rounded-lg border border-border bg-white px-3 text-xs text-text focus:outline-none"
                >
                  <option value="">Selecione</option>
                  {(data?.tenants || []).map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
              <CheckboxLabel
                checked={scheduleForm.includeNumbers}
                onChange={(checked) =>
                  setScheduleForm((form) => ({ ...form, includeNumbers: checked }))
                }
                label="Mostrar numeros"
              />
              <CheckboxLabel
                checked={scheduleForm.includeRecentMessages}
                onChange={(checked) =>
                  setScheduleForm((form) => ({ ...form, includeRecentMessages: checked }))
                }
                label="Mostrar mensagens recentes"
              />
              <Button
                onClick={createSchedule}
                disabled={busyKey === 'schedule:create'}
                className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs text-white hover:bg-primary-hover"
              >
                {busyKey === 'schedule:create' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Clock3 className="h-3.5 w-3.5" />
                )}
                Salvar agenda
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && !data ? (
        <Card className="border-border bg-white shadow-sm">
          <CardContent className="flex items-center justify-center py-10 text-sm text-text-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando monitoramento...
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-heading text-base font-bold text-text">
                Destinatarios
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-secondary">
                    <tr>
                      <th className="py-2 pr-3">Nome</th>
                      <th className="py-2 pr-3">WhatsApp</th>
                      <th className="py-2 pr-3">Relatorio</th>
                      <th className="py-2 pr-3">Quedas</th>
                      <th className="py-2 pr-3 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recipients || []).map((recipient) => (
                      <tr key={recipient.id} className="border-border/50 border-b">
                        <td className="py-3 pr-3 font-semibold text-text">{recipient.label}</td>
                        <td className="py-3 pr-3 font-mono text-text-secondary">
                          {recipient.whatsapp}
                        </td>
                        <td className="py-3 pr-3">
                          <BooleanBadge value={recipient.report_enabled} />
                        </td>
                        <td className="py-3 pr-3">
                          <BooleanBadge value={recipient.disconnect_alerts_enabled} />
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex items-center justify-end gap-2">
                            <ActionButton
                              title="Teste"
                              busy={busyKey === `test:${recipient.id}`}
                              onClick={() => sendTest(recipient.id)}
                              icon={Send}
                            />
                            <ActionButton
                              title={recipient.active ? 'Pausar' : 'Ativar'}
                              busy={busyKey === `recipient:${recipient.id}`}
                              onClick={() =>
                                patchItem('recipient', recipient.id, { active: !recipient.active })
                              }
                              icon={recipient.active ? XCircle : CheckCircle2}
                            />
                            <ActionButton
                              title="Excluir"
                              busy={busyKey === `recipient:delete:${recipient.id}`}
                              onClick={() => deleteItem('recipient', recipient.id)}
                              icon={Trash2}
                              danger
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(data?.recipients || []).length === 0 && (
                      <EmptyRow columns={5} label="Nenhum destinatario cadastrado." />
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-heading text-base font-bold text-text">Agendas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-secondary">
                    <tr>
                      <th className="py-2 pr-3">Nome</th>
                      <th className="py-2 pr-3">Destinatario</th>
                      <th className="py-2 pr-3">Intervalo</th>
                      <th className="py-2 pr-3">Proxima</th>
                      <th className="py-2 pr-3">Ultimo erro</th>
                      <th className="py-2 pr-3 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.schedules || []).map((schedule) => (
                      <tr key={schedule.id} className="border-border/50 border-b">
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-text">{schedule.name}</div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-secondary">
                            <span>
                              {schedule.active ? 'Ativa' : 'Pausada'} - janela{' '}
                              {schedule.window_minutes}min
                            </span>
                            {isScheduleOverdue(schedule) && (
                              <Badge className="border border-red-200 bg-red-50 px-1.5 py-0 text-[9px] text-red-700">
                                vencida
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-text-secondary">
                          {schedule.admin_monitoring_recipients?.label || schedule.recipient_id}
                        </td>
                        <td className="py-3 pr-3 font-mono text-text-secondary">
                          {schedule.interval_minutes}min
                        </td>
                        <td
                          className={`py-3 pr-3 ${isScheduleOverdue(schedule) ? 'font-semibold text-red-700' : 'text-text-secondary'}`}
                        >
                          {formatDate(schedule.next_run_at)}
                        </td>
                        <td className="max-w-[260px] truncate py-3 pr-3 text-text-secondary">
                          {schedule.last_error || '-'}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="flex items-center justify-end gap-2">
                            <ActionButton
                              title="Executar"
                              busy={busyKey === `run:${schedule.id}`}
                              onClick={() => runScheduleNow(schedule.id)}
                              icon={PlayCircle}
                            />
                            <ActionButton
                              title={schedule.active ? 'Pausar' : 'Ativar'}
                              busy={busyKey === `schedule:${schedule.id}`}
                              onClick={() =>
                                patchItem('schedule', schedule.id, { active: !schedule.active })
                              }
                              icon={schedule.active ? XCircle : CheckCircle2}
                            />
                            <ActionButton
                              title="Excluir"
                              busy={busyKey === `schedule:delete:${schedule.id}`}
                              onClick={() => deleteItem('schedule', schedule.id)}
                              icon={Trash2}
                              danger
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(data?.schedules || []).length === 0 && (
                      <EmptyRow columns={6} label="Nenhuma agenda cadastrada." />
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="border-border bg-white shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="font-heading text-base font-bold text-text">
                  Ultimos relatorios
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.reportRuns || []).map((run) => (
                  <div key={run.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Badge className={`border px-1.5 py-0 text-[9px] ${statusClass(run.status)}`}>
                        {run.status}
                      </Badge>
                      <span className="text-[10px] text-text-secondary">
                        {formatDate(run.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-text">
                      {run.ai_summary || run.error || 'Sem resumo registrado.'}
                    </p>
                  </div>
                ))}
                {(data?.reportRuns || []).length === 0 && (
                  <p className="py-4 text-xs text-text-secondary">Nenhum relatorio executado.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-white shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="font-heading text-base font-bold text-text">
                  Alertas de desconexao
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.disconnectDeliveries || []).map((delivery) => (
                  <div key={delivery.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          className={`border px-1.5 py-0 text-[9px] ${statusClass(delivery.status)}`}
                        >
                          {delivery.status}
                        </Badge>
                        <span className="truncate text-xs font-semibold text-text">
                          {delivery.tenants?.name || delivery.tenant_id}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-secondary">
                        {formatDate(delivery.sent_at || delivery.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-text-secondary">
                      {delivery.reason_code} / {delivery.external_state || 'sem estado'}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-text">
                      {delivery.ai_summary || delivery.error || 'Sem resumo registrado.'}
                    </p>
                  </div>
                ))}
                {(data?.disconnectDeliveries || []).length === 0 && (
                  <p className="py-4 text-xs text-text-secondary">
                    Nenhum alerta de desconexao entregue.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-white shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="font-heading text-base font-bold text-text">
                  Alertas de atividade da IA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {aiActivityAlertDeliveries?.error && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Historico pendente no banco: {aiActivityAlertDeliveries.error}
                  </p>
                )}
                {(aiActivityAlertDeliveries?.rows || []).map((delivery) => (
                  <div key={delivery.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          className={`border px-1.5 py-0 text-[9px] ${statusClass(delivery.status)}`}
                        >
                          {delivery.status}
                        </Badge>
                        <span className="truncate text-xs font-semibold text-text">
                          {delivery.tenants?.name || delivery.tenant_id}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-secondary">
                        {formatDate(delivery.sent_at || delivery.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-text-secondary">
                      {delivery.activity_state} / {delivery.severity}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-text">
                      {delivery.ai_summary || delivery.error || 'Sem resumo registrado.'}
                    </p>
                  </div>
                ))}
                {(aiActivityAlertDeliveries?.rows || []).length === 0 && (
                  <p className="py-4 text-xs text-text-secondary">
                    Nenhum alerta de atividade da IA entregue.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-white shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="font-heading text-base font-bold text-text">
                  Execucoes do scheduler
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.dispatcherRuns || []).map((run) => (
                  <div key={run.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Badge className={`border px-1.5 py-0 text-[9px] ${statusClass(run.status)}`}>
                        {run.status}
                      </Badge>
                      <span className="text-[10px] text-text-secondary">
                        {formatDate(run.started_at)}
                      </span>
                    </div>
                    <p className="mt-2 truncate font-mono text-[10px] text-text-secondary">
                      {run.source}
                    </p>
                    <p className="mt-1 text-xs text-text">
                      claim {run.claimed_count} / enviados {run.sent_count} / falhas{' '}
                      {run.failed_count} / pulados {run.skipped_count}
                    </p>
                    {run.error && (
                      <p className="mt-1 line-clamp-2 text-xs text-red-700">{run.error}</p>
                    )}
                  </div>
                ))}
                {(data?.dispatcherRuns || []).length === 0 && (
                  <p className="py-4 text-xs text-text-secondary">
                    Nenhum check do scheduler registrado.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: number;
  tone?: 'normal' | 'red';
}) {
  return (
    <Card className={`bg-white shadow-sm ${tone === 'red' ? 'border-red-300' : 'border-border'}`}>
      <CardContent className="pb-3 pt-4">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
          {label}
        </span>
        <span
          className={`font-heading font-mono text-2xl font-bold ${tone === 'red' ? 'text-error-text' : 'text-text'}`}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-white px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
        {label}
      </span>
      <span
        className={`mt-1 block truncate text-xs text-text ${mono ? 'font-mono' : 'font-semibold'}`}
      >
        {value}
      </span>
    </div>
  );
}

function CheckboxLabel({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="focus:ring-primary/30 h-4 w-4 rounded border-border text-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function BooleanBadge({ value }: { value: boolean }) {
  return (
    <Badge
      className={`border px-1.5 py-0 text-[9px] ${value ? 'border-success/30 bg-success-soft text-success-text' : 'border-border bg-surface-sunken text-text-secondary'}`}
    >
      {value ? 'ON' : 'OFF'}
    </Badge>
  );
}

function ActionButton({
  title,
  busy,
  onClick,
  icon: Icon,
  danger = false,
}: {
  title: string;
  busy: boolean;
  onClick: () => void;
  icon: LucideIcon;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={busy}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
        danger
          ? 'border-red-100 text-red-600 hover:bg-red-50'
          : 'border-border text-text-secondary hover:bg-surface-sunken hover:text-text'
      }`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
    </button>
  );
}

function EmptyRow({ columns, label }: { columns: number; label: string }) {
  return (
    <tr>
      <td colSpan={columns} className="py-8 text-center text-xs text-text-secondary">
        {label}
      </td>
    </tr>
  );
}
