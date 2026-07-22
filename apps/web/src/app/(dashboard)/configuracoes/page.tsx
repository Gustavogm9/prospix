'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Input, Badge, toast } from '@prospix/ui';
import { Settings as SettingsIcon, Shield, CreditCard, Key, Calendar, Phone, Loader2, CheckCircle2, AlertCircle, RefreshCw, FileText, ExternalLink, Bell } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { profileQueries, billingQueries } from '@/lib/queries';
import { apiFetch } from '@/lib/api-fetch';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { z } from 'zod';
import PrivacyTab from './settings/PrivacyTab';
import AIContextPage from './contexto/page';

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome completo (mínimo 2 caracteres).').max(120, 'Nome muito longo (máximo 120).'),
  email: z.string().trim().toLowerCase().email('E-mail inválido. Use o formato exemplo@dominio.com.'),
  susep: z
    .string()
    .trim()
    .max(40, 'SUSEP muito longo.')
    .optional()
    .or(z.literal('')),
});

type ProfileErrors = Partial<Record<'name' | 'email' | 'susep', string>>;

type CredentialState = {
  aiProvider: 'GUILDS_SHARED' | 'TENANT_OWN';
  keys: {
    openai: { configured: boolean };
    anthropic: { configured: boolean };
    googleAi: { configured: boolean };
    googleMaps: { configured: boolean };
    evolution: { configured: boolean };
    tavily?: { configured: boolean };
    firecrawl?: { configured: boolean };
  };
  whatsapp: {
    baseUrlConfigured: boolean;
    instanceConfigured: boolean;
    webhookConfigured: boolean;
  };
  google: {
    calendarConnected: boolean;
    calendarId: string | null;
    oauthScope: string | null;
  };
  updatedAt: string | null;
};

type WhatsAppGuardianTrace = {
  status: {
    status: string | null;
    externalState: string | null;
    externalCheckedAt: string | null;
    lastDisconnectReasonCode: string | null;
    quarantinedUntil: string | null;
    circuitOpenUntil: string | null;
    lastGlobalSendAt: string | null;
    stateEnteredAt?: string | null;
    stateReasonCode?: string | null;
    stateSource?: string | null;
    updatedAt: string | null;
  } | null;
  currentState?: {
    status: string;
    label: string;
    impactLevel: 'INFO' | 'OBSERVATION' | 'ATTENTION' | 'CRITICAL';
    operationState: 'ACTIVE' | 'THROTTLED' | 'BLOCKED' | 'REQUIRES_ACTION';
    enteredAt: string | null;
    durationSeconds: number | null;
    allowSend: boolean;
    allowNewActive: boolean;
    summary: string;
  } | null;
  recentTransitions?: Array<{
    previousStatus: string | null;
    status: string;
    externalState: string | null;
    reasonCode: string;
    impactLevel: string;
    operationState: string;
    operatorSummary: string;
    allowSend: boolean | null;
    allowNewActive: boolean | null;
    enteredAt: string;
    exitedAt: string | null;
    durationSeconds: number | null;
  }>;
  events24h: Array<{
    eventType: string | null;
    reasonCode: string | null;
    externalState: string | null;
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  recentEvents: Array<{
    eventType: string | null;
    reasonCode: string | null;
    externalState: string | null;
    createdAt: string;
  }>;
  pendingOutbound: {
    activePending: number;
    missingGuardianEvidence: number;
  };
  dueQueueDiagnostics?: {
    totalDue: number;
    items: Array<{
      pendingOutboundId: string;
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
    }>;
  };
  workerSnapshot?: {
    generatedAt: string;
    tenantId: string;
    tenantName: string | null;
    tenantStatus: string | null;
    activePending: number;
    duePending: number;
    approvedPending: number;
    delayedPending: number;
    blockedOrFailedLast24h: number;
    nextScheduledFor: string | null;
    oldestDueAt: string | null;
    oldestDueAgeSeconds: number | null;
    sentToday: number;
    sentLast60m: number;
    latestAiMessageAt: string | null;
    latestInboundAt: string | null;
    latestRetryQueuedAt: string | null;
    guardianStatus: string | null;
    guardianExternalState: string | null;
    guardianReasonCode: string | null;
    guardianOperationState: string | null;
    guardianBlockingSend: boolean;
    guardianBlockSummary: string | null;
    firstTouchEligible: number;
    firstTouchEvaluated: number;
    latestQueue: {
      id: string | null;
      messageType: string | null;
      status: string | null;
      createdAt: string | null;
      scheduledFor: string | null;
      sentAt: string | null;
      failedAt: string | null;
      failedReason: string | null;
      validationStatus: string | null;
      validationReasonCode: string | null;
      finalGuardianDecision: string | null;
    } | null;
  } | null;
  aiActivity: {
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
    duePending: number;
    unansweredConversations: number;
    outboundToday: number;
    outboundLast60m: number;
    inboundToday: number;
    lastOutboundAt: string | null;
    lastInboundAt: string | null;
  } | null;
};

const emptyCredentialState: CredentialState = {
  aiProvider: 'GUILDS_SHARED',
  keys: {
    openai: { configured: false },
    anthropic: { configured: false },
    googleAi: { configured: false },
    googleMaps: { configured: false },
    evolution: { configured: false },
  },
  whatsapp: {
    baseUrlConfigured: false,
    instanceConfigured: false,
    webhookConfigured: false,
  },
  google: {
    calendarConnected: false,
    calendarId: null,
    oauthScope: null,
  },
  updatedAt: null,
};

type BillingInvoice = {
  id: string;
  periodMonth: string;
  mrrCents: number;
  excessCents: number;
  totalCents: number;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'REFUNDED' | 'WAIVED';
  paidAt: string | null;
  dueAt: string;
  invoiceUrl?: string | null;
  paymentMethod?: string | null;
  externalInvoiceId?: string | null;
};

type TenantBillingData = {
  tenant: {
    id?: string;
    name?: string;
    plan?: string;
    planName: string;
    mrrCents: number;
    status: string;
  };
  usage: {
    periodMonth: string;
    llmTokensInput: number;
    llmTokensOutput: number;
    llmCostCents: number;
    whatsappMessagesSent: number;
    whatsappCostCents: number;
    googleMapsCalls: number;
    googleMapsCostCents: number;
    conversationsStarted: number;
    meetingsScheduled: number;
  };
  currentInvoice: BillingInvoice | null;
  invoices: BillingInvoice[];
};

type TabKey = 'perfil' | 'integracoes' | 'agenda' | 'credenciais' | 'financeiro' | 'privacidade' | 'contexto';

const TAB_KEYS: TabKey[] = ['perfil', 'contexto', 'integracoes', 'agenda', 'credenciais', 'financeiro', 'privacidade'];

type WhatsAppStatusSyncState = {
  mode: 'starting' | 'live' | 'polling' | 'error';
  lastRefreshAt: string | null;
  error: string | null;
};

const WHATSAPP_STATUS_VISIBLE_POLL_MS = 3000;
const WHATSAPP_STATUS_HIDDEN_POLL_MS = 15000;
const WHATSAPP_REALTIME_REFRESH_DELAY_MS = 350;

import { BrainCircuit } from 'lucide-react';

const tabConfig: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'perfil', label: 'Meu Perfil', icon: SettingsIcon },
  { key: 'contexto', label: 'Contexto IA', icon: BrainCircuit },
  { key: 'integracoes', label: 'Conexões', icon: Shield },
  { key: 'agenda', label: 'Agenda', icon: Calendar },
  { key: 'credenciais', label: 'Credenciais & APIs', icon: Key },
  { key: 'financeiro', label: 'Faturamento', icon: CreditCard },
  { key: 'privacidade', label: 'Privacidade & Dados', icon: FileText },
];

const firstTouchReasonLabels: Record<string, string> = {
  ELIGIBLE: 'Elegivel',
  DELETED: 'Lead removido',
  LEAD_NOT_ENRICHED: 'Lead ainda nao enriquecido',
  ALREADY_CONTACTED: 'Lead ja contatado',
  ALREADY_SENT: 'Primeiro contato ja enviado',
  FIRST_TOUCH_PENDING: 'Primeiro contato ja esta na fila',
  FIRST_TOUCH_FAILED: 'Primeiro contato falhou anteriormente',
  FIRST_TOUCH_RETRY_COOLDOWN: 'Aguardando nova tentativa segura',
  FIRST_TOUCH_RETRY_LIMIT_REACHED: 'Limite de novas tentativas atingido',
  PREVIOUSLY_GUARDIAN_BLOCKED: 'Bloqueado anteriormente pelo Guardian',
  FIRST_TOUCH_ALREADY_MARKED: 'Lead ja marcado como tentado',
  MISSING_WHATSAPP: 'Sem WhatsApp',
  INVALID_MOBILE: 'WhatsApp invalido ou nao movel',
  OPTED_OUT: 'Lead pediu para nao receber contato',
  MISSING_CAMPAIGN: 'Sem campanha vinculada',
  CAMPAIGN_INACTIVE_OR_MISSING: 'Campanha ausente ou inativa',
  OUTSIDE_CAMPAIGN_WINDOW: 'Fora do horario da campanha',
  DAILY_LIMIT_REACHED: 'Limite diario atingido',
  SCRIPT_INACTIVE_OR_MISSING: 'Roteiro ausente ou inativo',
  SCRIPT_NOT_APPROACH: 'Roteiro nao e de abordagem',
  MISSING_ACTIVE_SCRIPT: 'Sem roteiro ativo compativel',
  SCRIPT_PROFESSION_MISMATCH: 'Roteiro incompativel com a campanha',
  MISSING_ACTIVE_VARIATION: 'Roteiro sem variacao ativa',
  COMMERCIAL_NAME_FOR_INDIVIDUAL_SCRIPT: 'Nome comercial incompativel com roteiro individual',
  GUARDIAN_RELEVANCE_BLOCK: 'Bloqueado por relevancia no Guardian',
};

const isTabKey = (value: string | null): value is TabKey => Boolean(value && TAB_KEYS.includes(value as TabKey));

const firstTouchReasonLabel = (reason: string) => (
  firstTouchReasonLabels[reason] || reason.replaceAll('_', ' ').toLowerCase()
);

export default function Settings() {
  const { user, tenantId } = useAuthStore();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tab = searchParams.get('tab');
    if (isTabKey(tab)) {
      return tab;
    }
    return 'perfil';
  });

  // Profile fields state
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [susep, setSusep] = useState('');
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  // Notification toggles
  const [notifications, setNotifications] = useState([
    { label: 'Lead respondeu', desc: 'Quando um lead responde a mensagem da IA', checked: true },
    { label: 'Pediu ligação', desc: 'Quando um lead pede para falar com você', checked: true },
    { label: 'Reunião agendada', desc: 'Quando a IA agenda uma reunião', checked: true },
    { label: 'Resumo diário', desc: 'Email com resumo do dia às 18h', checked: false },
  ]);

  // Integrations states
  const [whatsappStatus, setWhatsappStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading');
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [whatsappTrace, setWhatsappTrace] = useState<WhatsAppGuardianTrace | null>(null);
  const [whatsappStatusSync, setWhatsappStatusSync] = useState<WhatsAppStatusSyncState>({
    mode: 'starting',
    lastRefreshAt: null,
    error: null,
  });
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState<number>(0);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);
  const [credentialState, setCredentialState] = useState<CredentialState>(emptyCredentialState);
  const [credentialDraft, setCredentialDraft] = useState({
    aiProvider: 'GUILDS_SHARED' as 'GUILDS_SHARED' | 'TENANT_OWN',
    openaiApiKey: '',
    anthropicApiKey: '',
    googleAiApiKey: '',
    googleMapsApiKey: '',
    evolutionApiKey: '',
    evolutionBaseUrl: '',
    tavilyApiKey: '',
    firecrawlApiKey: '',
  });
  const [isCredentialsLoading, setIsCredentialsLoading] = useState(false);
  const [isCredentialsSaving, setIsCredentialsSaving] = useState(false);
  const [billingData, setBillingData] = useState<TenantBillingData | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState<Array<{id: string; summary: string; primary?: boolean; backgroundColor?: string}>>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRealtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const diagnosticPanelRef = useRef<HTMLDivElement | null>(null);
  const canManageCredentials = user?.role !== 'ASSISTANT';

  // Agenda settings state
  const [agendaSettings, setAgendaSettings] = useState({
    availableDays: [1, 2, 3, 4, 5] as number[], // 0=Dom, 1=Seg... 6=Sab
    startHour: '08:00',
    endHour: '18:00',
    lunchStart: '12:00',
    lunchEnd: '13:30',
    defaultDuration: 30,
    bufferMinutes: 15,
  });
  const [isAgendaSaving, setIsAgendaSaving] = useState(false);

  const formatBRL = (cents: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  };

  const formatDate = (value: string) => {
    return new Date(value).toLocaleDateString('pt-BR');
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return 'Sem registro';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(date);
  };

  const formatTraceLabel = (value?: string | null) => {
    return value ? value.replaceAll('_', ' ') : 'Sem registro';
  };

  const formatDuration = (seconds?: number | null) => {
    if (seconds == null) return 'Sem registro';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
  };

  const impactClass = (impact?: string | null) => {
    if (impact === 'CRITICAL') return 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
    if (impact === 'ATTENTION') return 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]';
    if (impact === 'OBSERVATION') return 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]';
    return 'bg-[#ECFDF3] text-[#027A48] border-[#A7F3D0]';
  };

  const operationLabel = (operation?: string | null) => {
    if (operation === 'ACTIVE') return 'Operando normalmente';
    if (operation === 'THROTTLED') return 'Operando com cuidado';
    if (operation === 'BLOCKED') return 'Envios pausados';
    if (operation === 'REQUIRES_ACTION') return 'Precisa de acao';
    return formatTraceLabel(operation);
  };

  const aiActivityClass = (severity?: string | null) => {
    if (severity === 'CRITICAL') return 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
    if (severity === 'ATTENTION') return 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]';
    if (severity === 'OBSERVATION') return 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]';
    return 'bg-[#ECFDF3] text-[#027A48] border-[#A7F3D0]';
  };

  const explainAiOperation = (
    currentState: WhatsAppGuardianTrace['currentState'] | null,
    aiActivity: WhatsAppGuardianTrace['aiActivity'],
  ) => {
    if (!currentState) {
      return 'O sistema ainda nao confirmou o estado operacional do WhatsApp.';
    }

    if (currentState.operationState === 'BLOCKED' || currentState.operationState === 'REQUIRES_ACTION') {
      return 'A IA esta pausada para envios automaticos ate a conexao ou o bloqueio operacional ser resolvido.';
    }

    if (aiActivity?.state === 'STALLED') {
      return 'A IA esta conectada, mas existe atraso em fila ou resposta que precisa ser acompanhado antes de confiar no envio automatico.';
    }

    if (aiActivity?.state === 'WATCH') {
      if (aiActivity.contactableBacklog === 0 && aiActivity.firstTouchEligibility?.totalEvaluated) {
        return 'A IA pode responder conversas existentes, mas nao iniciara novos contatos porque nenhum lead atende todos os criterios atuais.';
      }
      return 'A IA esta conectada, porem em observacao porque existe uma condicao operacional que pode reduzir ou adiar novas prospeccoes.';
    }

    if (aiActivity?.state === 'OFF_HOURS') {
      return 'A IA esta fora da janela ativa de prospeccao; novas abordagens devem aguardar o horario configurado.';
    }

    return 'A IA esta liberada para responder e iniciar conversas conforme campanha, roteiro, horario, limites e Guardian.';
  };

  const syncClass = (mode: WhatsAppStatusSyncState['mode']) => {
    if (mode === 'live') return 'bg-[#ECFDF3] text-[#027A48] border-[#A7F3D0]';
    if (mode === 'error') return 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
    if (mode === 'polling') return 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]';
    return 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]';
  };

  const syncLabel = (mode: WhatsAppStatusSyncState['mode']) => {
    if (mode === 'live') return 'Ao vivo';
    if (mode === 'polling') return 'Atualizacao automatica';
    if (mode === 'error') return 'Atualizacao instavel';
    return 'Sincronizando';
  };

  const workerStatusLabel = (status?: string | null, duePending = 0, blockedByConnection = false) => {
    if (duePending > 0 && blockedByConnection) return 'Aguardando reconexao';
    if (duePending > 0) return 'Fila atrasada';
    if (status === 'FAILED') return 'Ultimo envio falhou';
    if (status === 'BLOCKED') return 'Ultimo envio bloqueado';
    if (status === 'DUE') return 'Pronto para enviar';
    if (status === 'DELAYED') return 'Aguardando seguranca';
    if (status === 'WAITING') return 'Agendado';
    if (status === 'SENT') return 'Enviou recentemente';
    return 'Sem fila ativa';
  };

  const workerStatusClass = (status?: string | null, duePending = 0, blockedByConnection = false) => {
    if (blockedByConnection) return 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
    if (status === 'FAILED' || status === 'BLOCKED') return 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
    if (duePending > 0 || status === 'DUE' || status === 'DELAYED') return 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]';
    if (status === 'WAITING') return 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]';
    return 'bg-[#ECFDF3] text-[#027A48] border-[#A7F3D0]';
  };

  const messageTypeLabel = (messageType?: string | null) => {
    if (messageType === 'OUTBOUND_START') return 'Primeiro contato';
    if (messageType === 'COMMERCIAL_FOLLOWUP') return 'Follow-up';
    if (messageType === 'REACTIVE_REPLY') return 'Resposta ao lead';
    if (messageType === 'CHAT_CONTINUATION') return 'Continuidade';
    if (messageType === 'LOOKUP_REPLY') return 'Resposta com pesquisa';
    return 'Mensagem da IA';
  };

  const blockerKindLabel = (kind?: string | null) => {
    if (kind === 'CONNECTION') return 'Conexao';
    if (kind === 'GUARDIAN') return 'Guardian';
    if (kind === 'CONVERSATION') return 'Conversa';
    if (kind === 'LEAD') return 'Lead';
    if (kind === 'WORKER') return 'Worker';
    return 'Diagnostico';
  };

  const countLabel = (count: number, singular: string, plural: string) => (
    `${count} ${count === 1 ? singular : plural}`
  );

  const buildWorkerSummary = (
    worker: NonNullable<WhatsAppGuardianTrace['workerSnapshot']>,
    aiActivity: WhatsAppGuardianTrace['aiActivity'],
    currentState: WhatsAppGuardianTrace['currentState'] | null,
  ) => {
    const blockedByConnection = Boolean(
      worker.guardianBlockingSend ||
      currentState?.operationState === 'BLOCKED' ||
      currentState?.operationState === 'REQUIRES_ACTION',
    );

    if (worker.duePending > 0) {
      if (blockedByConnection) {
        return worker.duePending === 1
          ? '1 mensagem esta pronta, mas nao sera enviada enquanto o WhatsApp estiver desconectado, pausado ou sem autorizacao.'
          : `${countLabel(worker.duePending, 'mensagem', 'mensagens')} estao prontas, mas nao serao enviadas enquanto o WhatsApp estiver desconectado, pausado ou sem autorizacao.`;
      }
      return worker.duePending === 1
        ? '1 mensagem ja deveria ter sido enviada e ainda esta na fila. Acompanhe a proxima rodada; se continuar assim, investigar execucao do envio e gateway.'
        : `${countLabel(worker.duePending, 'mensagem', 'mensagens')} ja deveriam ter sido enviadas e ainda estao na fila. Acompanhe a proxima rodada; se continuar assim, investigar execucao do envio e gateway.`;
    }
    if (worker.activePending > 0) {
      return worker.activePending === 1
        ? '1 mensagem esta na fila aguardando o horario seguro definido pela IA e pelo Guardian.'
        : `${countLabel(worker.activePending, 'mensagem', 'mensagens')} estao na fila aguardando o horario seguro definido pela IA e pelo Guardian.`;
    }
    if (worker.sentLast60m > 0) {
      return `A IA enviou ${countLabel(worker.sentLast60m, 'mensagem', 'mensagens')} na ultima hora.`;
    }
    if (aiActivity?.isOperatingWindow && worker.firstTouchEligible > 0 && worker.sentToday === 0) {
      return worker.firstTouchEligible === 1
        ? '1 lead esta pronto para primeiro contato, mas ainda nao houve envio hoje. Acompanhe a proxima rodada de envio.'
        : `${countLabel(worker.firstTouchEligible, 'lead', 'leads')} estao prontos para primeiro contato, mas ainda nao houve envio hoje. Acompanhe a proxima rodada de envio.`;
    }
    if (worker.firstTouchEligible <= 0) {
      return 'Nao ha leads prontos para primeiro contato neste momento. A IA segue disponivel para respostas e follow-ups conforme as regras.';
    }
    return 'Sem fila ativa neste momento. A IA aguarda a proxima oportunidade valida de envio.';
  };

  const fetchProfile = useCallback(async () => {
    if (!user?.id || !tenantId) return;
    setIsProfileLoading(true);
    try {
      const result = await profileQueries.get(user.id, tenantId);
      if (result.error) throw new Error(result.error.message);
      const profile = result.data;
      setName(profile?.name || '');
      setEmail(profile?.email || '');
      setSusep(profile?.susep || '');
    } catch (err: unknown) {
      console.error('Error loading profile:', err);
      const message = err instanceof Error
        ? err.message || 'Não foi possível carregar os dados do perfil.'
        : 'Não foi possível carregar os dados do perfil.';
      toast.error('Erro ao carregar perfil', message);
    } finally {
      setIsProfileLoading(false);
    }
  }, [user?.id, tenantId]);

  const handleSaveProfile = async () => {
    const parsed = profileSchema.safeParse({ name, email, susep });
    if (!parsed.success) {
      const errs: ProfileErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof ProfileErrors | undefined;
        if (field && !errs[field]) errs[field] = issue.message;
      }
      setProfileErrors(errs);
      toast.error('Corrija os campos destacados', 'Há informações inválidas no formulário.');
      return;
    }
    setProfileErrors({});
    if (!user?.id || !tenantId) return;
    setIsProfileSaving(true);
    try {
      const result = await profileQueries.update(user.id, tenantId, {
        name: parsed.data.name,
        email: parsed.data.email,
        susep: parsed.data.susep || null,
      });
      if (result.error) throw new Error(result.error.message);
      const profile = result.data;
      setName(profile?.name || name);
      setEmail(profile?.email || email);
      setSusep(profile?.susep || '');
      toast.success('Perfil salvo', 'As informações cadastrais foram atualizadas.');
    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message || 'Não foi possível salvar o perfil.'
        : 'Não foi possível salvar o perfil.';
      toast.error('Erro ao salvar perfil', message);
    } finally {
      setIsProfileSaving(false);
    }
  };

  const fetchCredentialState = useCallback(async () => {
    setIsCredentialsLoading(true);
    try {
      const res = await apiFetch('/api/integrations/credentials');
      const json = await res.json();
      const data = json?.data || emptyCredentialState;
      setCredentialState(data);
      setCredentialDraft((draft) => ({
        ...draft,
        aiProvider: data.aiProvider || 'GUILDS_SHARED',
        evolutionBaseUrl: '',
      }));

      // If Google Calendar is connected, load calendar list
      if (data.google?.calendarConnected) {
        setSelectedCalendarId(data.google.calendarId || 'primary');
        setIsLoadingCalendars(true);
        try {
          const calRes = await apiFetch('/api/integrations/calendar/calendars');
          if (calRes.ok) {
            const calJson = await calRes.json();
            setGoogleCalendars(calJson.calendars || []);
          }
        } catch (calErr) {
          console.warn('Failed to load Google Calendars:', calErr);
        } finally {
          setIsLoadingCalendars(false);
        }
      }
    } catch (err: unknown) {
      console.error('Error loading credentials:', err);
      toast.error('Erro ao carregar credenciais', 'Não foi possível carregar o estado das credenciais.');
    } finally {
      setIsCredentialsLoading(false);
    }
  }, []);

  const fetchAgendaSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/integrations/agenda');
      const json = await res.json();
      const data = json?.data;
      if (data) {
        setAgendaSettings({
          availableDays: data.availableDays || [1, 2, 3, 4, 5],
          startHour: data.startHour || '09:00',
          endHour: data.endHour || '18:00',
          lunchStart: data.lunchStart || '12:00',
          lunchEnd: data.lunchEnd || '13:30',
          defaultDuration: data.defaultDuration || 30,
          bufferMinutes: data.bufferMinutes || 15,
        });
      }
    } catch (err) {
      console.error('Error loading agenda settings:', err);
    }
  }, []);

  const fetchBilling = useCallback(async () => {
    if (!tenantId) return;
    setIsBillingLoading(true);
    try {
      const result = await billingQueries.get(tenantId);
      if (result.error) throw new Error(result.error.message);
      setBillingData(result.data || null);
    } catch (err: unknown) {
      console.error('Error loading billing:', err);
      setBillingData(null);
      const message = err instanceof Error
        ? err.message || 'Não foi possível carregar as faturas reais.'
        : 'Não foi possível carregar as faturas reais.';
      toast.error('Erro ao carregar faturamento', message);
    } finally {
      setIsBillingLoading(false);
    }
  }, [tenantId]);

  const handleSaveCredentials = async () => {
    if (!canManageCredentials) {
      toast.error('Permissão insuficiente', 'Somente proprietários podem alterar credenciais de integração.');
      return;
    }

    const payload: Record<string, string> = {
      aiProvider: credentialDraft.aiProvider,
    };

    Object.entries({
      openaiApiKey: credentialDraft.openaiApiKey,
      anthropicApiKey: credentialDraft.anthropicApiKey,
      googleAiApiKey: credentialDraft.googleAiApiKey,
      googleMapsApiKey: credentialDraft.googleMapsApiKey,
      evolutionApiKey: credentialDraft.evolutionApiKey,
      evolutionBaseUrl: credentialDraft.evolutionBaseUrl,
    }).forEach(([key, value]) => {
      if (value.trim()) {
        payload[key] = value.trim();
      }
    });

    setIsCredentialsSaving(true);
    try {
      const res = await apiFetch('/api/integrations/credentials', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Erro ao salvar credenciais');
      setCredentialState(json?.data || emptyCredentialState);
      setCredentialDraft({
        aiProvider: json?.data?.aiProvider || credentialDraft.aiProvider,
        openaiApiKey: '',
        anthropicApiKey: '',
        googleAiApiKey: '',
        googleMapsApiKey: '',
        evolutionApiKey: '',
        evolutionBaseUrl: '',
        tavilyApiKey: '',
        firecrawlApiKey: '',
      });
      toast.success('Credenciais salvas', 'As chaves foram criptografadas e vinculadas ao tenant.');
    } catch (err: unknown) {
      console.error('Error saving credentials:', err);
      const message = err instanceof Error ? err.message : 'Não foi possível salvar as credenciais.';
      toast.error('Erro ao salvar credenciais', message);
    } finally {
      setIsCredentialsSaving(false);
    }
  };

  const handleGoogleConnect = async () => {
    try {
      const res = await apiFetch('/api/integrations/google/oauth');
      const json = await res.json();
      if (json?.auth_url) {
        window.location.href = json.auth_url;
      } else {
        toast.error('Erro de Conexão', 'Erro ao obter link de autorização do Google Agenda.');
      }
    } catch (err: unknown) {
      console.error('Error connecting Google Calendar:', err);
      toast.error('Erro de Conexão', 'Erro ao conectar ao Google Agenda.');
    }
  };

  const handleDisconnectGoogle = async () => {
    try {
      const res = await apiFetch('/api/integrations/google/disconnect', { method: 'POST' });
      if (res.ok) {
        toast.success('Agenda Desconectada', 'Sua agenda do Google foi desconectada.');
        fetchCredentialState(); // Refresh state
      } else {
        toast.error('Erro', 'Não foi possível desconectar a agenda.');
      }
    } catch (err) {
      console.error('Error disconnecting Google Calendar:', err);
      toast.error('Erro de Conexão', 'Erro ao desconectar o Google Agenda.');
    }
  };
  const checkStatus = useCallback(async (silent = false) => {
    if (!silent) setWhatsappStatus('loading');
    try {
      const res = await apiFetch('/api/integrations/whatsapp/status');
      const data = await res.json();
      setWhatsappTrace(data.guardianTrace ?? null);
      if (data.status === 'connected') {
        setWhatsappStatus('connected');
        setInstanceName(data.instanceName);
        setQrCode(null);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      } else {
        setWhatsappStatus('disconnected');
        setInstanceName(data.instanceName);
      }
      setWhatsappStatusSync((current) => ({
        ...current,
        lastRefreshAt: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      console.error('Error checking WhatsApp status:', err);
      const message = err instanceof Error ? err.message : 'Falha ao atualizar status do WhatsApp.';
      setWhatsappStatusSync((current) => ({
        ...current,
        mode: silent ? current.mode : 'error',
        lastRefreshAt: new Date().toISOString(),
        error: message,
      }));
      if (!silent) setWhatsappTrace(null);
      if (!silent) setWhatsappStatus('disconnected');
    }
  }, []);

  const scheduleWhatsAppStatusRefresh = useCallback((delayMs = WHATSAPP_REALTIME_REFRESH_DELAY_MS) => {
    if (statusRefreshTimeoutRef.current) {
      clearTimeout(statusRefreshTimeoutRef.current);
    }
    statusRefreshTimeoutRef.current = setTimeout(() => {
      statusRefreshTimeoutRef.current = null;
      void checkStatus(true);
    }, delayMs);
  }, [checkStatus]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (isTabKey(requestedTab) && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    if (activeTab !== 'integracoes') return;
    if (typeof window === 'undefined' || window.location.hash !== '#diagnostico-operacional') return;

    const timer = window.setTimeout(() => {
      diagnosticPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [activeTab, whatsappTrace]);

  useEffect(() => {
    if (activeTab === 'perfil') {
      fetchProfile();
      // Fetch notification preferences from API
      apiFetch('/api/notifications/preferences')
        .then(res => res.json())
        .then(json => {
          const prefs = json?.data ?? json;
          if (Array.isArray(prefs) && prefs.length > 0) {
            const EVENT_TYPES = ['lead_replied', 'lead_callback', 'meeting_scheduled', 'daily_summary'];
            setNotifications(prev => prev.map((n, i) => {
              const pref = prefs.find((p: any) => p.eventType === EVENT_TYPES[i]);
              return pref ? { ...n, checked: pref.enabled } : n;
            }));
          }
        })
        .catch(() => { /* endpoint may not exist yet, keep defaults */ });
    }

    // Handle OAuth redirects
    const errorMsg = searchParams.get('error');
    const successMsg = searchParams.get('success');
    if (errorMsg) {
      setTimeout(() => {
        if (errorMsg === 'no_refresh_token') {
          toast.error('Erro de Permissão', 'O Google não enviou o token de atualização. Por favor, remova o acesso do Prospix na sua conta Google e tente novamente.');
        } else if (errorMsg === 'google_token_exchange_failed') {
          toast.error('Erro de Configuração', 'Falha ao trocar o código. Verifique se o GOOGLE_CLIENT_SECRET está correto na Vercel.');
        } else {
          toast.error('Erro na Conexão', `Não foi possível conectar a agenda (${errorMsg}).`);
        }
        // Clean URL
        window.history.replaceState({}, document.title, '/configuracoes?tab=integracoes');
        setActiveTab('integracoes');
      }, 500);
    } else if (successMsg === 'google_connected') {
      setTimeout(() => {
        toast.success('Agenda Conectada!', 'Sua agenda do Google foi vinculada com sucesso.');
        window.history.replaceState({}, document.title, '/configuracoes?tab=integracoes');
        setActiveTab('integracoes');
      }, 500);
    }

    if (activeTab === 'integracoes') {
      checkStatus();
      fetchCredentialState();
    }

    if (activeTab === 'credenciais') {
      fetchCredentialState();
    }

    if (activeTab === 'agenda') {
      fetchAgendaSettings();
    }

    if (activeTab === 'financeiro') {
      fetchBilling();
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [activeTab, searchParams, fetchProfile, checkStatus, fetchCredentialState, fetchBilling, fetchAgendaSettings]);

  useEffect(() => {
    if (activeTab !== 'integracoes' || !tenantId) return;

    let disposed = false;

    const stopPolling = () => {
      if (statusPollIntervalRef.current) {
        clearInterval(statusPollIntervalRef.current);
        statusPollIntervalRef.current = null;
      }
    };

    const startPolling = () => {
      stopPolling();
      const delay = document.visibilityState === 'visible'
        ? WHATSAPP_STATUS_VISIBLE_POLL_MS
        : WHATSAPP_STATUS_HIDDEN_POLL_MS;
      statusPollIntervalRef.current = setInterval(() => {
        scheduleWhatsAppStatusRefresh(0);
      }, delay);
    };

    const handleRealtimeChange = () => {
      scheduleWhatsAppStatusRefresh();
    };

    setWhatsappStatusSync((current) => ({
      ...current,
      mode: current.mode === 'live' ? 'live' : 'starting',
      error: null,
    }));

    scheduleWhatsAppStatusRefresh(0);
    startPolling();

    const tables = [
      'whatsapp_guardian_status',
      'whatsapp_connection_events',
      'whatsapp_guardian_state_transitions',
      'pending_outbound',
      'leads',
      'conversations',
      'messages',
    ];

    const channel = supabase.channel(`whatsapp-operational-status:${tenantId}`);
    for (const table of tables) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `tenant_id=eq.${tenantId}`,
        },
        handleRealtimeChange,
      );
    }

    statusRealtimeChannelRef.current = channel;
    channel.subscribe((status) => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        setWhatsappStatusSync((current) => ({
          ...current,
          mode: 'live',
          error: null,
        }));
        scheduleWhatsAppStatusRefresh(0);
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setWhatsappStatusSync((current) => ({
          ...current,
          mode: 'polling',
          error: status === 'CHANNEL_ERROR' ? 'Realtime indisponivel; usando atualizacao automatica.' : current.error,
        }));
      }
    });

    const handleVisibilityChange = () => {
      startPolling();
      if (document.visibilityState === 'visible') {
        scheduleWhatsAppStatusRefresh(0);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPolling();
      if (statusRefreshTimeoutRef.current) {
        clearTimeout(statusRefreshTimeoutRef.current);
        statusRefreshTimeoutRef.current = null;
      }
      if (statusRealtimeChannelRef.current) {
        supabase.removeChannel(statusRealtimeChannelRef.current);
        statusRealtimeChannelRef.current = null;
      }
    };
  }, [activeTab, tenantId, scheduleWhatsAppStatusRefresh]);

  useEffect(() => {
    if (qrCountdown <= 0 || !qrCode) return;
    const t = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          handleConnectWhatsapp(); // Auto-refresh QR code
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [qrCountdown, qrCode]);

  const handleConnectWhatsapp = async () => {
    setIsGeneratingQr(true);
    setQrCode(null);
    try {
      const res = await apiFetch('/api/integrations/whatsapp/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Erro ao conectar');
      setQrCode(data.qrcode);
      setQrCountdown(40); // Set 40 seconds timer
      setInstanceName(data.instanceName);
      setIsGeneratingQr(false);
      
      // Backoff incremental 3s → 5s → 10s (cap) para reduzir carga no Evolution
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      const delays = [3000, 3000, 5000, 5000, 10000];
      let attempt = 0;
      const schedule = () => {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        pollingIntervalRef.current = setTimeout(async () => {
          attempt += 1;
          await checkStatus(true);
          // checkStatus limpa pollingIntervalRef.current quando conecta · só reagenda se ainda ativo
          if (pollingIntervalRef.current) schedule();
        }, delay) as unknown as NodeJS.Timeout;
      };
      schedule();
    } catch (err: unknown) {
      console.error('Error generating WhatsApp QR code:', err);
      const message = err instanceof Error ? err.message : 'Ocorreu um erro ao conectar com o servidor da Evolution API.';
      toast.error('Erro no Gateway', message);
      setIsGeneratingQr(false);
    }
  };

  const handleDisconnectWhatsapp = async () => {
    setWhatsappStatus('loading');
    setIsConfirmingDisconnect(false);
    try {
      await apiFetch('/api/integrations/whatsapp/disconnect', { method: 'POST' });
      setWhatsappStatus('disconnected');
      setInstanceName(null);
      setQrCode(null);
      toast.success('WhatsApp Desconectado', 'WhatsApp desconectado com sucesso!');
    } catch (err) {
      console.error('Error disconnecting WhatsApp:', err);
      toast.error('Erro de Instância', 'Erro ao desconectar WhatsApp.');
      setWhatsappStatus('disconnected');
    }
  };

  const toggleNotification = async (index: number) => {
    const EVENT_TYPES = ['lead_replied', 'lead_callback', 'meeting_scheduled', 'daily_summary'];
    setNotifications((prev) =>
      prev.map((n, i) => (i === index ? { ...n, checked: !n.checked } : n))
    );
    try {
      const eventType = EVENT_TYPES[index] || `notification_${index}`;
      const newChecked = !notifications[index]?.checked;
      await apiFetch('/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          eventType,
          channels: ['PUSH', 'EMAIL'],
          enabled: newChecked,
        }),
      });
    } catch (err) {
      console.error('Failed to save notification preference', err);
    }
  };

  const renderWhatsAppTracePanel = () => {
    if (!whatsappTrace) return null;

    const status = whatsappTrace.status;
    const latestGroup = whatsappTrace.events24h[0] ?? null;
    const missingEvidence = whatsappTrace.pendingOutbound.missingGuardianEvidence;
    const currentState = whatsappTrace.currentState ?? null;
    const recentTransitions = whatsappTrace.recentTransitions ?? [];
    const aiActivity = whatsappTrace.aiActivity ?? null;
    const workerSnapshot = whatsappTrace.workerSnapshot ?? null;
    const dueQueueDiagnostics = whatsappTrace.dueQueueDiagnostics ?? { totalDue: 0, items: [] };
    const firstDueItem = dueQueueDiagnostics.items[0] ?? null;

    return (
      <div
        id="diagnostico-operacional"
        ref={diagnosticPanelRef}
        className="scroll-mt-28 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4"
      >
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#1B3A6B]" />
              <h4 className="text-[13px] font-bold text-[#0F172A]">Diagnóstico operacional</h4>
            </div>
            <p className="text-[11px] text-[#64748B] mt-1">
              Estado registrado no banco e eventos consolidados das últimas 24h.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 ${
              status?.status === 'SUSPENDED' || status?.lastDisconnectReasonCode
                ? 'bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA]'
                : 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]'
            }`}>
              {formatTraceLabel(status?.status)}
            </Badge>
            <Badge className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 border ${syncClass(whatsappStatusSync.mode)}`}>
              {syncLabel(whatsappStatusSync.mode)}
            </Badge>
          </div>
        </div>

        {currentState && (
          <div className={`mt-4 rounded-lg border bg-white p-3 ${impactClass(currentState.impactLevel)}`}>
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-[#0F172A]">{currentState.label}</span>
                  <Badge className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 border ${impactClass(currentState.impactLevel)}`}>
                    {operationLabel(currentState.operationState)}
                  </Badge>
                  <span className="text-[10px] text-[#64748B]">
                    ha {formatDuration(currentState.durationSeconds)}
                  </span>
                </div>
                <p className="text-[11px] text-[#334155] mt-1">{currentState.summary}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] shrink-0">
                <span className={`rounded-md border px-2 py-1 font-semibold ${currentState.allowSend ? 'bg-[#ECFDF3] text-[#027A48] border-[#A7F3D0]' : 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]'}`}>
                  Respostas: {currentState.allowSend ? 'liberadas' : 'pausadas'}
                </span>
                <span className={`rounded-md border px-2 py-1 font-semibold ${currentState.allowNewActive ? 'bg-[#ECFDF3] text-[#027A48] border-[#A7F3D0]' : 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]'}`}>
                  Novas conversas: {currentState.allowNewActive ? 'liberadas' : 'em cuidado'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-[10px] text-[#64748B]">
              <span>Entrou neste estado: {formatDateTime(currentState.enteredAt)}</span>
              <span>Origem: {formatTraceLabel(status?.stateSource)}</span>
              <span>Motivo: {formatTraceLabel(status?.stateReasonCode || status?.lastDisconnectReasonCode)}</span>
            </div>
            <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2">
              <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">O que significa</span>
              <p className="text-[11px] text-[#334155] mt-1 leading-relaxed">
                {explainAiOperation(currentState, aiActivity)}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 text-[10px] text-[#64748B]">
                <span>Responder conversas: {currentState.allowSend ? 'sim, liberado' : 'nao, pausado'}</span>
                <span>Iniciar novas conversas: {currentState.allowNewActive ? 'sim, liberado' : 'nao ou com restricao'}</span>
                <span>Proximo passo: {aiActivity?.requiredAction || 'acompanhar a proxima leitura'}</span>
              </div>
            </div>
          </div>
        )}

        {aiActivity && (
          <div className={`mt-3 rounded-lg border bg-white p-3 ${aiActivityClass(aiActivity.severity)}`}>
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-[#0F172A]">{aiActivity.label}</span>
                  <Badge className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 border ${aiActivityClass(aiActivity.severity)}`}>
                    {aiActivity.isOperatingWindow ? 'horario ativo' : 'fora do horario'}
                  </Badge>
                </div>
                <p className="text-[11px] text-[#334155] mt-1">{aiActivity.summary}</p>
                <p className="text-[10px] text-[#64748B] mt-1">Acao: {aiActivity.requiredAction}</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] shrink-0">
                <span className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 font-semibold text-[#334155]">Leads hoje: {aiActivity.leadsCreatedToday}</span>
                <span className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 font-semibold text-[#334155]">Elegiveis agora: {aiActivity.contactableBacklog}</span>
                <span className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 font-semibold text-[#334155]">Fila vencida: {aiActivity.duePending}</span>
                <span className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 font-semibold text-[#334155]">Sem resposta: {aiActivity.unansweredConversations}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-[10px] text-[#64748B]">
              <span>Mensagens da IA hoje: {aiActivity.outboundToday} ({aiActivity.outboundLast60m} na ultima hora)</span>
              <span>Ultimo envio IA: {formatDateTime(aiActivity.lastOutboundAt)}</span>
              <span>Ultima entrada lead: {formatDateTime(aiActivity.lastInboundAt)}</span>
            </div>
            {aiActivity.firstTouchEligibility && (
              <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] text-[#64748B]">
                  <span>Elegiveis reais: {aiActivity.firstTouchEligibility.eligible} de {aiActivity.firstTouchEligibility.totalEvaluated} avaliados</span>
                  <span>Principal bloqueio: {aiActivity.firstTouchEligibility.topBlockingReasonLabel || 'sem bloqueio dominante'}</span>
                  <span>Ocorrencias: {aiActivity.firstTouchEligibility.topBlockingReasonCount}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(aiActivity.firstTouchEligibility.byReason)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([reason, count]) => (
                      <span key={reason} className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-[10px] font-semibold text-[#334155]">
                        {firstTouchReasonLabel(reason)}: {count}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {workerSnapshot && (
          <div className="mt-3 rounded-lg border border-[#D0D5DD] bg-white p-3">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-[#0F172A]">Execucao da IA</span>
                  <Badge className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 border ${workerStatusClass(workerSnapshot.latestQueue?.status, workerSnapshot.duePending, workerSnapshot.guardianBlockingSend)}`}>
                    {workerStatusLabel(workerSnapshot.latestQueue?.status, workerSnapshot.duePending, workerSnapshot.guardianBlockingSend)}
                  </Badge>
                </div>
                <p className="text-[11px] text-[#334155] mt-1 leading-relaxed">
                  {buildWorkerSummary(workerSnapshot, aiActivity, currentState)}
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] shrink-0">
                <span className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1 font-semibold text-[#334155]">
                  Hoje: {countLabel(workerSnapshot.sentToday, 'envio', 'envios')}
                </span>
                <span className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1 font-semibold text-[#334155]">
                  Ultima hora: {workerSnapshot.sentLast60m}
                </span>
                <span className={`rounded-md border px-2 py-1 font-semibold ${workerSnapshot.duePending > 0 ? 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]' : 'bg-[#F8FAFC] text-[#334155] border-[#E5E7EB]'}`}>
                  Atrasadas: {workerSnapshot.duePending}
                </span>
                <span className={`rounded-md border px-2 py-1 font-semibold ${workerSnapshot.blockedOrFailedLast24h > 0 ? 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]' : 'bg-[#F8FAFC] text-[#334155] border-[#E5E7EB]'}`}>
                  Falhas/bloqueios: {workerSnapshot.blockedOrFailedLast24h}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Ultimo envio</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatDateTime(workerSnapshot.latestAiMessageAt)}</span>
              </div>
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Fila agora</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">
                  {workerSnapshot.activePending} em espera
                </span>
              </div>
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Proximo envio</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatDateTime(workerSnapshot.nextScheduledFor)}</span>
              </div>
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Leads prontos</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">
                  {workerSnapshot.firstTouchEligible} de {workerSnapshot.firstTouchEvaluated}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Bloqueio atual</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">
                  {workerSnapshot.guardianBlockSummary || 'Sem bloqueio de conexao'}
                </span>
              </div>
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Estado da conexao</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">
                  {formatTraceLabel(workerSnapshot.guardianStatus)} / {formatTraceLabel(workerSnapshot.guardianExternalState)}
                </span>
              </div>
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Motivo da conexao</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">
                  {formatTraceLabel(workerSnapshot.guardianReasonCode)}
                </span>
              </div>
            </div>

            {workerSnapshot.latestQueue && (
              <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] text-[#64748B]">
                  <span>Ultima acao da fila: {messageTypeLabel(workerSnapshot.latestQueue.messageType)}</span>
                  <span>Status: {workerStatusLabel(workerSnapshot.latestQueue.status, workerSnapshot.duePending, workerSnapshot.guardianBlockingSend)}</span>
                  <span>Horario: {formatDateTime(workerSnapshot.latestQueue.sentAt || workerSnapshot.latestQueue.failedAt || workerSnapshot.latestQueue.scheduledFor || workerSnapshot.latestQueue.createdAt)}</span>
                </div>
                {(workerSnapshot.latestQueue.failedReason || workerSnapshot.latestQueue.validationReasonCode || workerSnapshot.latestQueue.finalGuardianDecision) && (
                  <p className="text-[10px] text-[#64748B] mt-2">
                    Motivo registrado: {formatTraceLabel(workerSnapshot.latestQueue.failedReason || workerSnapshot.latestQueue.validationReasonCode || workerSnapshot.latestQueue.finalGuardianDecision)}
                  </p>
                )}
              </div>
            )}

            {firstDueItem && (
              <div className={`mt-3 rounded-lg border px-3 py-3 ${
                firstDueItem.blocksSend
                  ? 'border-[#FEDF89] bg-[#FFFAEB]'
                  : 'border-[#BFDBFE] bg-[#EFF6FF]'
              }`}>
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold text-[#0F172A]">Pendencia principal</span>
                      <Badge className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 border ${
                        firstDueItem.blocksSend
                          ? 'bg-[#FEF0C7] text-[#B54708] border-[#FEDF89]'
                          : 'bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]'
                      }`}>
                        {blockerKindLabel(firstDueItem.blockerKind)}
                      </Badge>
                      {dueQueueDiagnostics.totalDue > 1 && (
                        <span className="text-[10px] text-[#64748B]">
                          mais {countLabel(dueQueueDiagnostics.totalDue - 1, 'pendencia vencida', 'pendencias vencidas')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#334155] mt-1 leading-relaxed">{firstDueItem.operatorSummary}</p>
                    <p className="text-[10px] text-[#475569] mt-1 leading-relaxed">
                      Acao recomendada: {firstDueItem.recommendedAction}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] shrink-0">
                    <span className="rounded-md border border-white/70 bg-white/70 px-2 py-1 font-semibold text-[#334155]">
                      Tipo: {messageTypeLabel(firstDueItem.messageType)}
                    </span>
                    <span className="rounded-md border border-white/70 bg-white/70 px-2 py-1 font-semibold text-[#334155]">
                      Atraso: {formatDuration(firstDueItem.dueAgeSeconds)}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-[10px] text-[#64748B]">
                  <span>Lead: {firstDueItem.leadName || 'sem nome registrado'}</span>
                  <span>Campanha: {firstDueItem.campaignName || 'sem campanha registrada'}</span>
                  <span>Agendada para: {formatDateTime(firstDueItem.scheduledFor)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
            <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Estado externo</span>
            <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatTraceLabel(status?.externalState)}</span>
          </div>
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
            <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Motivo</span>
            <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatTraceLabel(status?.lastDisconnectReasonCode)}</span>
          </div>
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
            <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Circuit breaker</span>
            <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatDateTime(status?.circuitOpenUntil)}</span>
          </div>
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
            <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Fila ativa</span>
            <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">
              {whatsappTrace.pendingOutbound.activePending} pendentes
            </span>
          </div>
        </div>

        {latestGroup && (
          <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Último agrupamento</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatTraceLabel(latestGroup.eventType)}</span>
              </div>
              <div>
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Ocorrências</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{latestGroup.count}</span>
              </div>
              <div>
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Primeira</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatDateTime(latestGroup.firstSeenAt)}</span>
              </div>
              <div>
                <span className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider block">Última</span>
                <span className="text-[12px] text-[#0F172A] font-semibold mt-1 block">{formatDateTime(latestGroup.lastSeenAt)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className={`text-[11px] font-semibold ${missingEvidence > 0 ? 'text-[#B42318]' : 'text-[#027A48]'}`}>
            {missingEvidence > 0
              ? countLabel(missingEvidence, 'pendencia sem evidencia Guardian', 'pendencias sem evidencia Guardian')
              : 'Nenhuma pendência ativa sem evidência Guardian'}
          </div>
          <div className="text-[10px] text-[#64748B]">
            Última leitura da tela: {formatDateTime(whatsappStatusSync.lastRefreshAt)} · Última checagem do gateway: {formatDateTime(status?.externalCheckedAt || status?.updatedAt)}
          </div>
        </div>

        {whatsappStatusSync.error && (
          <div className="mt-3 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[11px] text-[#B54708]">
            {whatsappStatusSync.error}
          </div>
        )}

        {whatsappTrace.recentEvents.length > 0 && (
          <div className="mt-3 border-t border-[#E5E7EB] pt-3">
            <div className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider mb-2">Eventos recentes</div>
            <div className="space-y-1.5">
              {whatsappTrace.recentEvents.slice(0, 4).map((event, index) => (
                <div key={`${event.createdAt}-${index}`} className="flex flex-col md:flex-row md:items-center md:justify-between gap-1 text-[11px]">
                  <span className="text-[#0F172A] font-medium">
                    {formatTraceLabel(event.eventType)} · {formatTraceLabel(event.reasonCode)}
                  </span>
                  <span className="text-[#64748B] font-mono">{formatDateTime(event.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentTransitions.length > 0 && (
          <div className="mt-3 border-t border-[#E5E7EB] pt-3">
            <div className="text-[9px] text-[#64748B] font-bold uppercase tracking-wider mb-2">Mudancas de estado</div>
            <div className="space-y-1.5">
              {recentTransitions.slice(0, 4).map((transition, index) => (
                <div key={`${transition.enteredAt}-${index}`} className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1 text-[11px]">
                  <span className="text-[#0F172A] font-medium">
                    {formatTraceLabel(transition.previousStatus)} para {formatTraceLabel(transition.status)} - {operationLabel(transition.operationState)}
                  </span>
                  <span className="text-[#64748B]">
                    {transition.exitedAt
                      ? `${formatDuration(transition.durationSeconds)} encerrado em ${formatDateTime(transition.exitedAt)}`
                      : `estado atual desde ${formatDateTime(transition.enteredAt)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 flex flex-col h-full animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shrink-0">
        <SettingsIcon className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Configurações da sua conta e integrações.</strong> Gerencie perfil, credenciais, WhatsApp, Google Calendar e faturamento.</div>
      </div>

      {/* 2-column layout: sidebar pills + content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left sidebar pills */}
        <div className="w-full lg:w-48 shrink-0 flex lg:flex-col overflow-x-auto lg:overflow-visible gap-1">
          {tabConfig.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                data-testid={key === 'privacidade' ? 'settings-privacy-tab' : undefined}
                className={`w-full shrink-0 text-left flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                  activeTab === key
                    ? 'bg-[#1B3A6B] text-white shadow-sm'
                    : 'text-[#475569] hover:bg-[#F1F3F6]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
        </div>

        {/* Right content */}
        <div className="flex-1 w-full min-w-0 space-y-5">

          {/* ─── TAB: CONTEXTO IA ─── */}
          {activeTab === 'contexto' && (
            <AIContextPage />
          )}

          {/* ─── TAB: PERFIL ─── */}
          {activeTab === 'perfil' && (
            <>
              {/* Informações Cadastrais */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="text-[14px] font-semibold text-[#0F172A]">Informações Cadastrais</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Atualize os dados pessoais de exibição do corretor.</div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="profile-name" className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Nome Completo</label>
                      <Input
                        id="profile-name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (profileErrors.name) setProfileErrors((p) => ({ ...p, name: undefined }));
                        }}
                        aria-invalid={!!profileErrors.name}
                        aria-describedby={profileErrors.name ? 'profile-name-error' : undefined}
                        className={`bg-white text-[#0F172A] placeholder-[#64748B] text-[13px] h-10 rounded-lg ${profileErrors.name ? 'border-[#D92D20] focus:border-[#D92D20]' : 'border-[#E5E7EB] focus:border-[#1B3A6B]'}`}
                      />
                      {profileErrors.name && (
                        <p id="profile-name-error" className="text-[10px] text-[#D92D20] mt-1" role="alert">{profileErrors.name}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="profile-email" className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">E-mail de Login</label>
                      <Input
                        id="profile-email"
                        type="email"
                        value={email}
                        readOnly
                        disabled
                        className="bg-[#F8FAFC] text-[#64748B] text-[13px] h-10 rounded-lg border-[#E5E7EB] cursor-not-allowed"
                      />
                      <p className="text-[10px] text-[#94A3B8] mt-1">Este é o e-mail usado para login e não pode ser alterado por aqui.</p>
                    </div>
                    <div>
                      <label htmlFor="profile-susep" className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Registro Profissional</label>
                      <Input
                        id="profile-susep"
                        value={susep}
                        placeholder="SUSEP, OAB, CRM, CRECI… (opcional)"
                        onChange={(e) => {
                          setSusep(e.target.value);
                          if (profileErrors.susep) setProfileErrors((p) => ({ ...p, susep: undefined }));
                        }}
                        aria-invalid={!!profileErrors.susep}
                        aria-describedby={profileErrors.susep ? 'profile-susep-error' : undefined}
                        className={`bg-white text-[#0F172A] placeholder-[#64748B] text-[13px] h-10 rounded-lg ${profileErrors.susep ? 'border-[#D92D20] focus:border-[#D92D20]' : 'border-[#E5E7EB] focus:border-[#1B3A6B]'}`}
                      />
                      {profileErrors.susep && (
                        <p id="profile-susep-error" className="text-[10px] text-[#D92D20] mt-1" role="alert">{profileErrors.susep}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    disabled={isProfileLoading || isProfileSaving}
                    onClick={handleSaveProfile}
                    className="bg-[#1B3A6B] hover:bg-[#15305A] text-white font-semibold text-[13px] px-5 h-10 rounded-xl mt-2 shadow-md shadow-[#1B3A6B]/10 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isProfileSaving ? 'Salvando...' : 'Salvar Alterações'}
                  </Button>
                </div>
              </div>

              {/* Notificações */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-[#1B3A6B]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">Notificações</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Configure quais alertas você deseja receber.</div>
                </div>
                <div className="p-5 space-y-1">
                  {notifications.map((n, i) => (
                    <div key={i} className="flex items-center justify-between py-3 border-b border-[#F1F5F9] last:border-0">
                      <div>
                        <div className="text-[13px] font-medium text-[#0F172A]">{n.label}</div>
                        <div className="text-[11px] text-[#64748B]">{n.desc}</div>
                      </div>
                      <button
                        onClick={() => toggleNotification(i)}
                        className={`w-10 h-6 rounded-full transition-colors ${
                          n.checked ? 'bg-[#1B3A6B]' : 'bg-[#E5E7EB]'
                        } relative`}
                        aria-label={`Toggle ${n.label}`}
                      >
                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          n.checked ? 'right-1' : 'left-1'
                        }`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: INTEGRAÇÕES ─── */}
          {activeTab === 'integracoes' && (
            <>
              {/* Integration Status Overview */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="text-[14px] font-semibold text-[#0F172A]">Status de Conexão</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Visão geral das integrações ativas e inativas.</div>
                </div>
                <div className="p-5 space-y-4">
                  {/* WhatsApp status inline */}
                  <div className="flex items-center justify-between p-3 rounded-xl border border-[#F1F5F9] hover:bg-[#FAFBFC] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
                        <Phone className="w-5 h-5 text-[#25D366]" />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-[#0F172A]">WhatsApp Business</div>
                        <div className="text-[11px] text-[#64748B]">Envio e recebimento de mensagens</div>
                      </div>
                    </div>
                    {whatsappStatus === 'loading' ? (
                      <Loader2 className="w-4 h-4 text-[#1B3A6B] animate-spin" />
                    ) : whatsappStatus === 'connected' ? (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48]">
                        ● Conectado
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3F2] text-[#D92D20]">
                        ● Desconectado
                      </span>
                    )}
                  </div>

                  {/* Google Calendar status inline */}
                  <div className="flex items-center justify-between p-3 rounded-xl border border-[#F1F5F9] hover:bg-[#FAFBFC] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#4285F4]/10 flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-[#4285F4]" />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-[#0F172A]">Google Calendar</div>
                        <div className="text-[11px] text-[#64748B]">Sincronização de reuniões e agenda</div>
                      </div>
                    </div>
                    {credentialState.google.calendarConnected ? (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48]">
                        ● Conectado
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3F2] text-[#D92D20]">
                        ● Desconectado
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* WhatsApp Integration Detail */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-[#25D366]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">WhatsApp (Evolution API)</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Conectividade e status do gateway de envio para disparos e IA.</div>
                </div>
                <div className="p-5">
                  {/* 1. Loading State */}
                  {whatsappStatus === 'loading' && (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <Loader2 className="w-8 h-8 text-[#1B3A6B] animate-spin" />
                      <span className="text-[12px] text-[#64748B] mt-3 font-semibold">Verificando conexão da instância...</span>
                    </div>
                  )}

                  {/* 2. Connected State */}
                  {whatsappStatus === 'connected' && (
                    <div className="space-y-6">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#ECFDF3] border border-[#A7F3D0] rounded-xl p-5">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-[#D1FAE5] text-[#027A48] rounded-xl">
                            <CheckCircle2 className="w-6 h-6 animate-pulse" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2.5">
                              <h4 className="text-[14px] font-bold text-[#0F172A]">WhatsApp Ativo</h4>
                              <Badge className="bg-[#D1FAE5] text-[#027A48] border border-[#A7F3D0] text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">
                                Sincronizado
                              </Badge>
                            </div>
                            <p className="text-[12px] text-[#64748B] mt-1 font-mono">
                              Instância: <span className="text-[#027A48] font-bold">{instanceName}</span>
                            </p>
                            <p className="text-[10px] text-[#64748B] mt-0.5">
                              O bot do Prospix está monitorando ativamente este número e respondendo leads em tempo real.
                            </p>
                          </div>
                        </div>
                        
                        {!isConfirmingDisconnect ? (
                          <Button
                            onClick={() => setIsConfirmingDisconnect(true)}
                            className="bg-[#FEF3F2] hover:bg-[#D92D20] hover:text-white text-[#D92D20] text-[12px] font-semibold px-4 h-9 rounded-xl transition-all duration-300 w-full sm:w-auto border border-[#FECACA]"
                          >
                            Desconectar WhatsApp
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0 bg-white p-3 rounded-xl border border-[#E5E7EB] shadow-sm">
                            <span className="text-[12px] text-[#D92D20] font-bold">Desconectar?</span>
                            <Button
                              onClick={handleDisconnectWhatsapp}
                              className="bg-[#D92D20] hover:bg-[#B91C1C] text-white text-[10px] font-bold h-7 px-3 rounded-lg"
                            >
                              Sim
                            </Button>
                            <Button
                              onClick={() => setIsConfirmingDisconnect(false)}
                              className="bg-white border border-[#E5E7EB] text-[#64748B] text-[10px] font-bold h-7 px-3 rounded-lg"
                            >
                              Não
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Status Details */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                          <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Webhooks</span>
                          <Badge className="bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[9px] font-bold">
                            100% Configurado
                          </Badge>
                        </div>
                        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                          <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Taxa de Resposta da IA</span>
                          <span className="text-[12px] text-[#0F172A] font-semibold font-mono">
                            {whatsappStatusSync.mode === 'live' ? 'Ao vivo / fallback 3s' : 'Auto / 3s'}
                          </span>
                        </div>
                        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                          <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Status do Servidor</span>
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="w-1.5 h-1.5 bg-[#039855] rounded-full animate-ping" />
                            <span className="text-[12px] text-[#027A48] font-bold">Online</span>
                          </div>
                        </div>
                      </div>

                      {renderWhatsAppTracePanel()}

                      {/* Anti-ban Info */}
                      <div className="p-5 rounded-xl border border-[#E5E7EB] bg-white">
                        <div className="flex items-center gap-2 mb-3">
                          <Shield className="w-4 h-4 text-[#1B3A6B]" />
                          <h4 className="text-[13px] font-bold text-[#0F172A]">Proteção Anti-banimento Automática</h4>
                        </div>
                        <p className="text-[12px] text-[#64748B] mb-4 leading-relaxed">
                          Diferente de outras ferramentas, o Prospix já possui um motor antiban nativo que roda 100% no backend. Não é necessário configurar intervalos manualmente.
                        </p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Limite Diário de Envios</span>
                            <div className="text-[12px] text-[#0F172A] font-semibold">Configurado por Campanha</div>
                            <p className="text-[10px] text-[#64748B] mt-1">A IA para automaticamente ao atingir o limite definido nas suas campanhas.</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Intervalo entre Mensagens</span>
                            <div className="text-[12px] text-[#0F172A] font-semibold">45 a 90 segundos (Aleatório)</div>
                            <p className="text-[10px] text-[#64748B] mt-1">O motor sorteia um tempo diferente a cada envio para imitar comportamento humano.</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Aquecimento Gradual</span>
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="w-7 h-4 bg-[#039855] rounded-full relative shadow-inner">
                                <div className="absolute right-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow" />
                              </div>
                              <span className="text-[12px] text-[#039855] font-bold">Sempre Ativo</span>
                            </div>
                            <p className="text-[10px] text-[#64748B] mt-1">O fluxo fracionado garante que a sua instância "esquente" naturalmente.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3. Disconnected State */}
                  {whatsappStatus === 'disconnected' && (
                    <div className="space-y-5">
                      {renderWhatsAppTracePanel()}

                      {/* A. If QR Code is visible or is generating */}
                      {isGeneratingQr || qrCode ? (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-[#F8FAFC] border border-[#E5E7EB] p-6 rounded-xl">
                          {/* Left Side: Step by step instructions */}
                          <div className="lg:col-span-7 space-y-6">
                            <div>
                              <Badge className="bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[9px] uppercase font-bold tracking-wider mb-2">
                                Aguardando Leitura
                              </Badge>
                              <h4 className="text-[15px] font-bold text-[#0F172A]">Como conectar o seu WhatsApp?</h4>
                              <p className="text-[12px] text-[#64748B] mt-1">
                                Siga as instruções passo a passo para conectar o robô de IA do Prospix ao seu número.
                              </p>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  1
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Abra o WhatsApp no seu smartphone (Android ou iPhone).
                                </p>
                              </div>
                              
                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  2
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Toque no menu <span className="font-semibold text-[#0F172A]">Aparelhos Conectados</span> (ou Configurações &gt; Aparelhos Conectados).
                                </p>
                              </div>

                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  3
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Selecione <span className="font-semibold text-[#0F172A]">Conectar um Aparelho</span> e valide com sua biometria ou senha.
                                </p>
                              </div>

                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  4
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Aponte a câmera do seu celular para o QR Code ao lado para realizar o escaneamento.
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-2 text-[10px] text-[#64748B]">
                              <Loader2 className="w-3.5 h-3.5 text-[#1B3A6B] animate-spin" />
                              <span>Aguardando a confirmação do escaneamento do QR Code...</span>
                            </div>
                          </div>

                          {/* Right Side: QR Code frame */}
                          <div className="lg:col-span-5 flex flex-col items-center justify-center">
                            <div className="relative p-6 bg-white border border-[#E5E7EB] rounded-xl shadow-xl flex items-center justify-center w-[240px] h-[240px] overflow-hidden">
                              {isGeneratingQr ? (
                                <div className="flex flex-col items-center justify-center text-center">
                                  <Loader2 className="w-8 h-8 text-[#1B3A6B] animate-spin" />
                                  <span className="text-[10px] text-[#64748B] mt-2">Criando instância...</span>
                                </div>
                              ) : qrCode ? (
                                <img
                                  src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                                  alt="WhatsApp QR Code"
                                  className="w-full h-full object-contain rounded-lg"
                                />
                              ) : (
                                <div className="text-center p-4">
                                  <AlertCircle className="w-8 h-8 text-[#D92D20] mx-auto" />
                                  <span className="text-[12px] text-[#64748B] mt-2 block">Erro ao carregar QR Code</span>
                                </div>
                              )}
                            </div>
                            
                            {qrCode && (
                              <Button
                                onClick={handleConnectWhatsapp}
                                disabled={isGeneratingQr}
                                className="mt-3.5 text-[10px] font-bold h-7 px-3 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F8FAFC] text-[#64748B] disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3 h-3 mr-1.5 ${isGeneratingQr ? 'animate-spin' : ''}`} />
                                {isGeneratingQr ? 'Gerando...' : qrCountdown > 0 ? `Atualizar automático em ${qrCountdown}s` : 'Atualizar QR Code'}
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        // B. Landing View - No QR Code active
                        <div className="flex flex-col items-center justify-center text-center py-10 px-4 max-w-md mx-auto">
                          <div className="p-4 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl text-[#64748B] shadow-sm">
                            <Phone className="w-8 h-8" />
                          </div>
                          
                          <h4 className="text-[16px] font-bold text-[#0F172A] mt-5">Conecte o seu WhatsApp Comercial</h4>
                          <p className="text-[12px] text-[#64748B] mt-2 leading-relaxed">
                            Conectando seu dispositivo móvel, o Prospix poderá disparar mensagens de prospecção ativa automaticamente e qualificar todos os seus leads em tempo real através da nossa Inteligência Artificial integrada.
                          </p>
                          
                          <Button
                            onClick={handleConnectWhatsapp}
                            className="bg-[#1B3A6B] hover:bg-[#15305A] text-white font-bold text-[13px] px-6 h-10 rounded-xl mt-6 shadow-lg shadow-[#1B3A6B]/10 w-full sm:w-auto"
                          >
                            Conectar WhatsApp
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Google Calendar */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#4285F4]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">Google Agenda OAuth</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Sincronize reuniões e agendamentos com seu calendário pessoal.</div>
                </div>
                <div className="p-5">
                  {credentialState.google.calendarConnected ? (
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#ECFDF3] border border-[#A7F3D0] rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-[#059669]/10 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-[#059669]" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-[13px] font-bold text-[#0F172A]">Google Agenda Ativa</h4>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-[#059669] text-white uppercase tracking-wider">
                                Sincronizado
                              </span>
                            </div>
                            <p className="text-[11px] text-[#059669] mt-0.5">A IA do Prospix está autorizada a ler conflitos e agendar reuniões.</p>
                          </div>
                        </div>
                        <Button onClick={handleDisconnectGoogle} className="bg-[#FEF3F2] hover:bg-[#FEE4E2] text-[#D92D20] text-[12px] font-semibold px-4 h-9 rounded-xl transition-colors border border-[#FEE4E2]">
                          Desconectar Agenda
                        </Button>
                      </div>

                      {/* Calendar selector */}
                      <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl p-4">
                        <label className="block space-y-2">
                          <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Calendário para sincronização</span>
                          <select
                            value={selectedCalendarId}
                            onChange={async (e) => {
                              const newId = e.target.value;
                              setSelectedCalendarId(newId);
                              try {
                                await apiFetch('/api/integrations/credentials', {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ googleCalendarId: newId }),
                                });
                                toast.success('Calendário atualizado', 'A sincronização usará este calendário.');
                              } catch {
                                toast.error('Erro', 'Não foi possível salvar a preferência de calendário.');
                              }
                            }}
                            disabled={isLoadingCalendars}
                            className="w-full bg-white border border-[#E5E7EB] text-[12px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none disabled:opacity-60"
                          >
                            {isLoadingCalendars ? (
                              <option>Carregando calendários...</option>
                            ) : googleCalendars.length > 0 ? (
                              googleCalendars.map((cal) => (
                                <option key={cal.id} value={cal.id}>
                                  {cal.summary}{cal.primary ? ' (Principal)' : ''}
                                </option>
                              ))
                            ) : (
                              <option value="primary">Calendário principal</option>
                            )}
                          </select>
                          <p className="text-[10px] text-[#94A3B8]">A IA agendará reuniões e verificará conflitos neste calendário.</p>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#4285F4]/10 flex items-center justify-center">
                          <Calendar className="w-5 h-5 text-[#4285F4]" />
                        </div>
                        <div>
                          <h4 className="text-[13px] font-bold text-[#0F172A]">Google Calendar API</h4>
                          <p className="text-[11px] text-[#64748B] mt-0.5">Permite checar conflitos e marcar slots de 30min.</p>
                        </div>
                      </div>
                      <Button onClick={handleGoogleConnect} className="bg-[#1B3A6B] hover:bg-[#15305A] text-white text-[12px] font-semibold px-4 h-9 rounded-xl shadow-lg shadow-[#1B3A6B]/10">
                        Conectar Agenda
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: AGENDA ─── */}
          {activeTab === 'agenda' && (
            <>
              {/* Horários de Atendimento */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#1B3A6B]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">Horários de Atendimento</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Defina quando você está disponível para reuniões agendadas pela IA.</div>
                </div>
                <div className="p-5 space-y-6">
                  {/* Dias disponíveis */}
                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-2.5">Dias Disponíveis</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 1, label: 'Seg' },
                        { value: 2, label: 'Ter' },
                        { value: 3, label: 'Qua' },
                        { value: 4, label: 'Qui' },
                        { value: 5, label: 'Sex' },
                        { value: 6, label: 'Sáb' },
                        { value: 0, label: 'Dom' },
                      ].map(day => {
                        const isActive = agendaSettings.availableDays.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            onClick={() => {
                              setAgendaSettings(prev => ({
                                ...prev,
                                availableDays: isActive
                                  ? prev.availableDays.filter(d => d !== day.value)
                                  : [...prev.availableDays, day.value].sort(),
                              }));
                            }}
                            className={`h-10 w-14 rounded-xl text-[13px] font-semibold border transition-all ${
                              isActive
                                ? 'bg-[#1B3A6B] text-white border-[#1B3A6B] shadow-sm'
                                : 'bg-[#F8FAFC] text-[#94A3B8] border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#475569]'
                            }`}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Horário início/fim */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Início do expediente</label>
                      <select
                        value={agendaSettings.startHour}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, startHour: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30','10:00'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Fim do expediente</label>
                      <select
                        value={agendaSettings.endHour}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, endHour: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['15:00','16:00','17:00','17:30','18:00','18:30','19:00','19:30','20:00','21:00'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Almoço */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Início do almoço</label>
                      <select
                        value={agendaSettings.lunchStart}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, lunchStart: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['11:00','11:30','12:00','12:30','13:00'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Fim do almoço</label>
                      <select
                        value={agendaSettings.lunchEnd}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, lunchEnd: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['12:30','13:00','13:30','14:00','14:30'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Duração e Buffer */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Duração padrão da reunião</label>
                      <select
                        value={agendaSettings.defaultDuration}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, defaultDuration: Number(e.target.value) }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        <option value={15}>15 minutos</option>
                        <option value={30}>30 minutos</option>
                        <option value={45}>45 minutos</option>
                        <option value={60}>60 minutos</option>
                        <option value={90}>90 minutos</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Intervalo entre reuniões</label>
                      <select
                        value={agendaSettings.bufferMinutes}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, bufferMinutes: Number(e.target.value) }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        <option value={0}>Sem intervalo</option>
                        <option value={5}>5 minutos</option>
                        <option value={10}>10 minutos</option>
                        <option value={15}>15 minutos</option>
                        <option value={30}>30 minutos</option>
                      </select>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl p-4">
                    <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-2">Resumo da sua disponibilidade</div>
                    <div className="text-[13px] text-[#0F172A] space-y-1">
                      <p>📅 <strong>{agendaSettings.availableDays.length} dias</strong> por semana ({agendaSettings.availableDays.map(d => ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d]).join(', ')})</p>
                      <p>⏰ Horário: <strong>{agendaSettings.startHour}</strong> às <strong>{agendaSettings.endHour}</strong></p>
                      <p>🍽️ Almoço: <strong>{agendaSettings.lunchStart}</strong> às <strong>{agendaSettings.lunchEnd}</strong></p>
                      <p>📝 Reuniões de <strong>{agendaSettings.defaultDuration} min</strong> com intervalo de <strong>{agendaSettings.bufferMinutes} min</strong></p>
                    </div>
                  </div>

                  <Button
                    disabled={isAgendaSaving}
                    onClick={async () => {
                      setIsAgendaSaving(true);
                      try {
                        const res = await apiFetch('/api/integrations/agenda', {
                          method: 'PATCH',
                          body: JSON.stringify({ agendaSettings }),
                        });
                        if (!res.ok) {
                          const errData = await res.json().catch(() => ({}));
                          throw new Error(errData?.message || 'Erro ao processar requisição no servidor.');
                        }
                        toast.success('Agenda configurada', 'Seus horários de disponibilidade foram salvos.');
                      } catch (err: any) {
                        toast.error('Erro ao salvar', err?.message || 'Não foi possível salvar as configurações de agenda.');
                      } finally {
                        setIsAgendaSaving(false);
                      }
                    }}
                    className="bg-[#1B3A6B] hover:bg-[#15305A] text-white font-semibold text-[13px] px-5 h-10 rounded-xl shadow-md shadow-[#1B3A6B]/10 disabled:opacity-60"
                  >
                    {isAgendaSaving ? 'Salvando...' : 'Salvar Configurações'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: CREDENCIAIS ─── */}
          {activeTab === 'credenciais' && (
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[#1B3A6B]" />
                  <div className="text-[14px] font-semibold text-[#0F172A]">Chaves de API (Bring Your Own Key)</div>
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Insira suas chaves proprietárias para IA, enriquecimento e integrações. Os valores são armazenados criptografados.</div>
              </div>
              <div className="p-5 space-y-5">
                {/* Status badges */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Provedor IA</span>
                    <select
                      value={credentialDraft.aiProvider}
                      onChange={(e) => setCredentialDraft({ ...credentialDraft, aiProvider: e.target.value as 'GUILDS_SHARED' | 'TENANT_OWN' })}
                      disabled={!canManageCredentials || isCredentialsLoading}
                      className="w-full bg-white border border-[#E5E7EB] text-[12px] rounded-lg px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none disabled:opacity-60"
                    >
                      <option value="GUILDS_SHARED">Guilds compartilhado</option>
                      <option value="TENANT_OWN">Chaves próprias</option>
                    </select>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">OpenAI</span>
                    <Badge className={credentialState.keys.openai.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.openai.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Google Maps</span>
                    <Badge className={credentialState.keys.googleMaps.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.googleMaps.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Tavily Search</span>
                    <Badge className={credentialState.keys.tavily?.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.tavily?.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Firecrawl</span>
                    <Badge className={credentialState.keys.firecrawl?.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.firecrawl?.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                </div>

                {/* API Key inputs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">OpenAI API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.openaiApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, openaiApiKey: e.target.value })}
                        placeholder={credentialState.keys.openai.configured ? 'Nova chave para substituir a atual' : 'sk-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Anthropic API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.anthropicApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, anthropicApiKey: e.target.value })}
                        placeholder={credentialState.keys.anthropic.configured ? 'Nova chave para substituir a atual' : 'sk-ant-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Google AI / Gemini API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.googleAiApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, googleAiApiKey: e.target.value })}
                        placeholder={credentialState.keys.googleAi.configured ? 'Nova chave para substituir a atual' : 'AIza...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Google Maps API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.googleMapsApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, googleMapsApiKey: e.target.value })}
                        placeholder={credentialState.keys.googleMaps.configured ? 'Nova chave para substituir a atual' : 'AIza...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Evolution API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.evolutionApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, evolutionApiKey: e.target.value })}
                        placeholder={credentialState.keys.evolution.configured ? 'Nova chave para substituir a atual' : 'Token da Evolution API'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Tavily API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.tavilyApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, tavilyApiKey: e.target.value })}
                        placeholder={credentialState.keys.tavily?.configured ? 'Nova chave para substituir a atual' : 'tvly-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Firecrawl API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.firecrawlApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, firecrawlApiKey: e.target.value })}
                        placeholder={credentialState.keys.firecrawl?.configured ? 'Nova chave para substituir a atual' : 'fc-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Evolution Base URL</label>
                    <Input
                      value={credentialDraft.evolutionBaseUrl}
                      disabled={!canManageCredentials || isCredentialsLoading}
                      onChange={(e) => setCredentialDraft({ ...credentialDraft, evolutionBaseUrl: e.target.value })}
                      placeholder={credentialState.whatsapp.baseUrlConfigured ? 'Nova URL para substituir a atual' : 'https://evo.seudominio.com.br'}
                      className="bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 disabled:opacity-70 rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-[#EEF0F3]">
                  <p className="text-[10px] text-[#64748B] leading-relaxed">
                    {canManageCredentials
                      ? 'Após salvar, os campos ficam vazios por segurança; a tela mostra apenas o estado configurado.'
                      : 'Sua função não permite alterar credenciais do tenant.'}
                  </p>
                  <Button
                    disabled={!canManageCredentials || isCredentialsSaving || isCredentialsLoading}
                    onClick={handleSaveCredentials}
                    className="bg-[#1B3A6B] hover:bg-[#15305A] text-white text-[12px] font-semibold px-5 h-10 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isCredentialsSaving ? 'Salvando...' : 'Salvar Credenciais'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB: FINANCEIRO ─── */}
          {activeTab === 'financeiro' && (
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-[#1B3A6B]" />
                  <div className="text-[14px] font-semibold text-[#0F172A]">Assinatura Ativa (Asaas)</div>
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Acompanhe assinatura, faturas e consumo operacional do tenant.</div>
              </div>
              <div className="p-5 space-y-6">
                {isBillingLoading ? (
                  <div className="flex items-center gap-2 text-[12px] text-[#64748B] py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-[#1B3A6B]" />
                    <span>Carregando faturamento real...</span>
                  </div>
                ) : !billingData ? (
                  <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="p-3 bg-white border border-[#E5E7EB] rounded-xl text-[#64748B] w-fit">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-[#0F172A]">Faturamento não encontrado</h4>
                      <p className="text-[12px] text-[#64748B] mt-1 leading-relaxed">
                        Nenhuma fatura foi localizada para este tenant. Assim que o Asaas gerar cobranças, elas aparecerão aqui.
                      </p>
                    </div>
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider block">Plano Atual</span>
                    <h4 className="text-[14px] font-bold text-[#0F172A] mt-1">{billingData.tenant.planName}</h4>
                    <p className="text-[12px] text-[#64748B] mt-0.5">{formatBRL(billingData.tenant.mrrCents)} / mês</p>
                  </div>

                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB] space-y-2">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">Uso de IA no mês</span>
                      <span className="text-[#64748B] font-mono font-medium">
                        {(billingData.usage.llmTokensInput + billingData.usage.llmTokensOutput).toLocaleString('pt-BR')} tokens
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                      <div>
                        <p className="text-[9px] text-[#64748B] uppercase font-bold">IA</p>
                        <p className="text-[12px] text-[#0F172A] font-mono">{formatBRL(billingData.usage.llmCostCents)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-[#64748B] uppercase font-bold">WhatsApp</p>
                        <p className="text-[12px] text-[#0F172A] font-mono">{formatBRL(billingData.usage.whatsappCostCents)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-[#64748B] uppercase font-bold">Maps</p>
                        <p className="text-[12px] text-[#0F172A] font-mono">{formatBRL(billingData.usage.googleMapsCostCents)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {billingData.currentInvoice && (
                  <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider block">Fatura atual</span>
                      <p className="text-[14px] font-bold text-[#0F172A] mt-1">{formatBRL(billingData.currentInvoice.totalCents)}</p>
                      <p className="text-[12px] text-[#64748B] mt-0.5">
                        Vencimento em {formatDate(billingData.currentInvoice.dueAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={billingData.currentInvoice.status === 'PAID' ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : billingData.currentInvoice.status === 'OVERDUE' ? 'bg-[#FEF3F2] text-[#D92D20] border border-[#FECACA]' : 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]'}>
                        {billingData.currentInvoice.status === 'PAID' ? 'Pago' : billingData.currentInvoice.status === 'OVERDUE' ? 'Em atraso' : 'Pendente'}
                      </Badge>
                      {billingData.currentInvoice.invoiceUrl && (
                        <Button
                          onClick={() => window.open(billingData.currentInvoice!.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                          className="bg-[#1B3A6B] hover:bg-[#15305A] text-white text-[10px] font-bold h-8 px-3 rounded-lg flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Abrir fatura
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">Histórico de Cobrança (Faturas Asaas)</span>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[10px] text-[#64748B] uppercase font-bold tracking-wider text-left">
                          <th className="py-2.5">Data de Vencimento</th>
                          <th className="py-2.5">Valor</th>
                          <th className="py-2.5">Status</th>
                          <th className="py-2.5 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {billingData.invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td className="py-3 font-medium text-[#64748B]">{formatDate(inv.dueAt)}</td>
                            <td className="py-3 font-mono font-medium text-[#0F172A]">{formatBRL(inv.totalCents)}</td>
                            <td className="py-3">
                              <Badge className={inv.status === 'PAID' ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : inv.status === 'OVERDUE' ? 'bg-[#FEF3F2] text-[#D92D20] border border-[#FECACA]' : 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]'}>
                                {inv.status === 'PAID' ? 'Pago' : inv.status === 'OVERDUE' ? 'Em atraso' : inv.status === 'WAIVED' ? 'Isenta' : inv.status === 'REFUNDED' ? 'Estornada' : 'Pendente'}
                              </Badge>
                            </td>
                            <td className="py-3 text-right">
                              {inv.invoiceUrl && (
                                <Button
                                  onClick={() => window.open(inv.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                                  className="bg-[#F8FAFC] hover:bg-[#E5E7EB] text-[#0F172A] border border-[#E5E7EB] text-[10px] font-bold h-7 px-2.5 rounded-lg flex items-center gap-1.5 ml-auto"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Abrir</span>
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {billingData.invoices.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-[12px] text-[#64748B]">
                              Nenhuma fatura real encontrada para este tenant.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                </>
                )}
              </div>
            </div>
          )}

          {/* ─── TAB: PRIVACIDADE ─── */}
          {activeTab === 'privacidade' && (
            <PrivacyTab />
          )}
        </div>
      </div>
    </div>
  );
}
