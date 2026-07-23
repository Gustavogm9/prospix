type AdminCountMap = Record<string, number | null | undefined>;

type AdminTenant = {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
};

type AdminGuardianStatus = {
  tenant_id?: string | null;
  tenant_name?: string | null;
  status?: string | null;
  external_state?: string | null;
  last_disconnect_reason_code?: string | null;
  updated_at?: string | null;
  quarantined_until?: string | null;
  circuit_open_until?: string | null;
};

type AdminRecentMessage = {
  created_at?: string | null;
  direction?: string | null;
  sender?: string | null;
  delivery_status?: string | null;
  lead_name?: string | null;
  lead_whatsapp?: string | null;
  content_preview?: string | null;
};

type AdminAiActivityTenant = {
  tenant_id?: string | null;
  tenant_name?: string | null;
  state?: string | null;
  summary?: string | null;
  action?: string | null;
  contactable_backlog?: number | null;
  due_pending?: number | null;
  unanswered_conversations?: number | null;
  outbound_today?: number | null;
  outbound_last_60m?: number | null;
  inbound_today?: number | null;
  guardian_status?: string | null;
  active_pending?: number | null;
  blocked_or_failed_last24h?: number | null;
  first_touch_evaluated?: number | null;
  oldest_due_age_minutes?: number | null;
  next_scheduled_for?: string | null;
  latest_ai_message_at?: string | null;
  worker_status?: string | null;
  worker_message_type?: string | null;
  worker_failed_reason?: string | null;
  worker_validation_reason_code?: string | null;
  worker_final_guardian_decision?: string | null;
  guardian_external_state?: string | null;
  guardian_reason_code?: string | null;
  guardian_blocking_send?: boolean | null;
  guardian_block_summary?: string | null;
};

type AdminAiActivity = {
  operatingWindow?: {
    isOpen?: boolean | null;
    label?: string | null;
  };
  summary?: Record<string, number | null | undefined>;
  tenants?: AdminAiActivityTenant[];
  errors?: string[];
};

type AdminWebhookProcessingIssue = {
  tenant_id?: string | null;
  tenant_name?: string | null;
  status?: string | null;
  skip_reason?: string | null;
  error_message?: string | null;
  attempts?: number | null;
  accepted_at?: string | null;
  failed_at?: string | null;
  updated_at?: string | null;
  processing_age_seconds?: number | null;
  operator_summary?: string | null;
  recommended_action?: string | null;
};

type AdminWebhookProcessing = {
  issues?: AdminWebhookProcessingIssue[];
  errors?: string[];
};

type AdminConnectionLog = {
  created_at?: string | null;
  event_type?: string | null;
  external_state?: string | null;
  reason_code?: string | null;
  raw_error_redacted?: unknown;
  local_status_before?: string | null;
  local_status_after?: string | null;
  pending_due_count?: number | null;
};

type AdminQueueImpact = {
  activePending?: number | null;
  duePending?: number | null;
  oldestDueAt?: string | null;
  nextScheduledFor?: string | null;
  sample?: AdminQueueItem[];
};

type AdminQueueItem = {
  scheduled_for?: string | null;
  message_type?: string | null;
  attempts?: number | null;
  lead_name?: string | null;
  lead_whatsapp?: string | null;
};

type ReportScheduleView = {
  name?: string | null;
};

type ReportMetricsView = {
  period?: {
    start?: string | null;
    end?: string | null;
  };
  tenantScope?: string | null;
  tenants?: AdminTenant[];
  counts?: AdminCountMap;
  guardianStatus?: AdminGuardianStatus[];
  aiActivity?: AdminAiActivity;
  webhookProcessing?: AdminWebhookProcessing;
  recentMessages?: AdminRecentMessage[];
  errors?: string[];
};

type DisconnectMessageInput = {
  tenant?: AdminTenant | null;
  event?: AdminConnectionLog | null;
  reasonCode?: string | null;
  externalState?: string | null;
  source?: string | null;
  pendingDueCount?: number | null;
  recentMessages?: AdminRecentMessage[];
  connectionLogs?: AdminConnectionLog[];
  queueImpact?: AdminQueueImpact | null;
};

type RecoveryStructuralAlertInput = {
  tenant?: AdminTenant | null;
  reasonCode?: string | null;
  structuralReason?: string | null;
  details?: string | null;
  source?: string | null;
  createdAt?: string | null;
  pendingDueCount?: number | null;
  recentOutboundMessages?: AdminRecentMessage[];
  queueImpact?: AdminQueueImpact | null;
};

type AiActivityAlertInput = {
  tenant?: AdminTenant | null;
  activity: AdminAiActivityTenant;
  source?: string | null;
  createdAt?: string | null;
};

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const UUID_TEST_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const INTERNAL_CODE_PATTERN = /\b(?:WA|SEND|ADMIN|NO|RECIPIENT|CONNECTION|PRE_SEND)_[A-Z0-9_]+\b/g;

function cleanText(value: unknown, max = 600): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(UUID_PATTERN, 'id oculto')
    .trim()
    .slice(0, max);
}

function sanitizePreview(value: unknown, max = 140): string {
  return cleanText(value, max).replace(INTERNAL_CODE_PATTERN, 'codigo interno');
}

export function formatBrtMinute(value: string | Date | null | undefined): string {
  if (!value) return 'desconhecido';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'desconhecido';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBrtHour(value: string | Date | null | undefined): string {
  if (!value) return 'desconhecido';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'desconhecido';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function countOf(counts: AdminCountMap, key: string): number {
  const value = Number(counts?.[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function friendlyTenantName(tenant: AdminTenant | AdminGuardianStatus | null | undefined): string {
  const name = cleanText(
    (tenant as AdminTenant)?.name || (tenant as AdminGuardianStatus)?.tenant_name,
    120,
  );
  if (name && !UUID_TEST_PATTERN.test(name)) return name;
  const slug = cleanText((tenant as AdminTenant)?.slug, 120);
  if (slug && !UUID_TEST_PATTERN.test(slug)) return slug;
  return 'tenant desconhecido';
}

function formatPhone(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return `+${digits}`;
}

function leadLabel(message: AdminRecentMessage): string {
  const name = cleanText(message.lead_name, 80);
  const phone = formatPhone(message.lead_whatsapp);
  if (name && phone) return `${name} (${phone})`;
  if (name) return name;
  if (phone) return phone;
  return 'lead sem identificacao';
}

function messageAction(message: AdminRecentMessage): string {
  return String(message.direction || '').toUpperCase() === 'OUTBOUND'
    ? 'IA enviou para'
    : 'Lead respondeu';
}

function deliveryStatusText(value: string | null | undefined): string {
  const normalized = String(value || '').toUpperCase();
  if (!normalized) return '';
  if (normalized === 'SENT') return 'enviada';
  if (normalized === 'DELIVERED') return 'entregue';
  if (normalized === 'READ') return 'lida';
  if (normalized === 'FAILED') return 'falhou';
  if (normalized === 'PENDING') return 'pendente';
  return cleanText(normalized.toLowerCase(), 40);
}

function formatRecentMessage(message: AdminRecentMessage): string {
  const preview = sanitizePreview(message.content_preview || '(sem texto)', 120) || '(sem texto)';
  const delivery = deliveryStatusText(message.delivery_status);
  const suffix = delivery ? ` (${delivery})` : '';
  return `- ${formatBrtHour(message.created_at)}: ${messageAction(message)} ${leadLabel(message)}${suffix}: ${preview}`;
}

function guardianDisplayName(
  row: AdminGuardianStatus,
  tenantById: Map<string, AdminTenant>,
): string {
  const directName = friendlyTenantName(row);
  if (directName !== 'tenant desconhecido') return directName;
  const tenant = row.tenant_id ? tenantById.get(row.tenant_id) : null;
  return friendlyTenantName(tenant);
}

function classifyGuardian(row: AdminGuardianStatus) {
  const status = String(row.status || '').toUpperCase();
  const externalState = String(row.external_state || '').toLowerCase();
  const hasOpenCircuit = Boolean(
    row.circuit_open_until && new Date(row.circuit_open_until).getTime() > Date.now(),
  );

  if (status === 'SUSPENDED' || hasOpenCircuit) {
    return { level: 'critical', text: 'critica: desconectada ou sem autorizacao' };
  }
  if (status === 'PAUSED' && ['close', 'closed'].includes(externalState)) {
    return { level: 'attention', text: 'atencao: conexao fechada' };
  }
  if (status === 'PAUSED') {
    return { level: 'attention', text: 'atencao: conectando' };
  }
  if (status === 'COLD' && externalState === 'open') {
    return { level: 'observation', text: 'conectada em observacao' };
  }
  if (status === 'COLD') {
    return { level: 'observation', text: 'em aquecimento/observacao' };
  }
  if (status === 'RECOVERY') {
    return { level: 'observation', text: 'em retomada segura' };
  }
  if (status === 'NORMAL' || !status) {
    return { level: 'ok', text: 'OK' };
  }
  return { level: 'attention', text: 'requer acompanhamento' };
}

function buildReportSituation(
  counts: AdminCountMap,
  guardianRows: AdminGuardianStatus[],
  errors: string[],
): string {
  const classified = guardianRows.map(classifyGuardian);
  const webhookIssues =
    countOf(counts, 'webhookFailed') + countOf(counts, 'webhookStaleProcessing');
  const hasCritical =
    classified.some((item) => item.level === 'critical') ||
    countOf(counts, 'criticalConnectionEvents') > 0;
  const hasAttention =
    classified.some((item) => item.level === 'attention') || countOf(counts, 'pendingDue') > 0;
  const hasActivity = [
    'leadsCreated',
    'conversationsStarted',
    'inboundMessages',
    'outboundMessages',
  ].some((key) => countOf(counts, key) > 0);

  if (errors.length > 0) return 'Situacao geral: coleta parcial; revisar painel admin.';
  if (webhookIssues > 0) return 'Situacao geral: falha na entrada de mensagens do WhatsApp.';
  if (hasCritical) return 'Situacao geral: atencao critica no WhatsApp.';
  if (hasAttention) return 'Situacao geral: requer acompanhamento.';
  if (hasActivity) return 'Situacao geral: operacao ativa no periodo.';
  return 'Situacao geral: estavel, sem novas interacoes no periodo.';
}

function buildWhatsAppSummary(
  guardianRows: AdminGuardianStatus[],
  tenantById: Map<string, AdminTenant>,
): string[] {
  if (guardianRows.length === 0) return ['WhatsApp: sem status registrado no escopo.'];

  const classified = guardianRows.map((row) => ({
    row,
    name: guardianDisplayName(row, tenantById),
    ...classifyGuardian(row),
  }));

  const ok = classified.filter((item) => item.level === 'ok').length;
  const observation = classified.filter((item) => item.level === 'observation');
  const attention = classified.filter((item) => item.level === 'attention');
  const critical = classified.filter((item) => item.level === 'critical');
  const parts = [
    ok > 0 ? `${ok} ${plural(ok, 'conta OK', 'contas OK')}` : null,
    observation.length > 0 ? `${observation.length} em observacao` : null,
    attention.length > 0 ? `${attention.length} requer acompanhamento` : null,
    critical.length > 0 ? `${critical.length} critica` : null,
  ].filter(Boolean);
  const lines = [`WhatsApp: ${parts.join('; ')}.`];
  const notable = [...critical, ...attention, ...observation].slice(0, 3);
  for (const item of notable) {
    lines.push(`Conta ${item.text}: ${item.name}.`);
  }
  return lines;
}

function buildReportAction(
  counts: AdminCountMap,
  guardianRows: AdminGuardianStatus[],
  errors: string[],
): string {
  const classified = guardianRows.map(classifyGuardian);
  const webhookIssues =
    countOf(counts, 'webhookFailed') + countOf(counts, 'webhookStaleProcessing');
  if (errors.length > 0) return 'Acao recomendada: revisar a coleta no painel admin.';
  if (webhookIssues > 0)
    return 'Acao recomendada: verificar a entrada de mensagens recebidas e confirmar se alguma conversa deixou de atualizar.';
  if (
    classified.some((item) => item.level === 'critical') ||
    countOf(counts, 'criticalConnectionEvents') > 0
  ) {
    return 'Acao recomendada: verificar reconexao do WhatsApp afetado.';
  }
  if (classified.some((item) => item.level === 'attention') || countOf(counts, 'pendingDue') > 0) {
    return 'Acao recomendada: acompanhar pendencias e conexoes.';
  }
  if (classified.some((item) => item.level === 'observation')) {
    return 'Acao recomendada: acompanhar contas em observacao.';
  }
  return 'Acao recomendada: nenhuma acao imediata.';
}

function activityCount(activity: AdminAiActivity | undefined, key: string): number {
  const value = Number(activity?.summary?.[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function buildAiActivityLines(activity: AdminAiActivity | undefined): string[] {
  if (!activity) return ['Atividade da IA: sem coleta de SLA operacional neste relatorio.'];

  const blocked = activityCount(activity, 'BLOCKED');
  const stalled = activityCount(activity, 'STALLED');
  const watch = activityCount(activity, 'WATCH');
  const ok = activityCount(activity, 'OK');
  const offHours = activityCount(activity, 'OFF_HOURS');
  const parts = [
    ok > 0 ? `${ok} OK` : null,
    watch > 0 ? `${watch} em acompanhamento` : null,
    stalled > 0 ? `${stalled} atrasada` : null,
    blocked > 0 ? `${blocked} bloqueada` : null,
    offHours > 0 ? `${offHours} fora do horario` : null,
  ].filter(Boolean);
  const lines = [`Atividade da IA: ${parts.length ? parts.join('; ') : 'sem tenants no escopo'}.`];
  const notable = (activity.tenants || [])
    .filter((tenant) =>
      ['BLOCKED', 'STALLED', 'WATCH'].includes(String(tenant.state || '').toUpperCase()),
    )
    .slice(0, 3);

  for (const tenant of notable) {
    const name = cleanText(tenant.tenant_name || tenant.tenant_id || 'tenant desconhecido', 120);
    const summary = sanitizePreview(tenant.summary || 'requer acompanhamento', 160);
    const numbers = [
      `${Number(tenant.contactable_backlog || 0)} aptos`,
      `${Number(tenant.due_pending || 0)} na fila vencida`,
      `${Number(tenant.unanswered_conversations || 0)} sem resposta`,
      `${Number(tenant.outbound_today || 0)} envios hoje`,
    ].join('; ');
    lines.push(`- ${name}: ${summary} (${numbers}).`);
  }

  if (notable.length === 0) {
    lines.push('- Nenhum atraso operacional relevante detectado.');
  }

  return lines;
}

function buildAiActivityAction(activity: AdminAiActivity | undefined): string | null {
  if (!activity) return null;
  const blocked = activityCount(activity, 'BLOCKED');
  const stalled = activityCount(activity, 'STALLED');
  if (blocked > 0)
    return 'Acao IA: primeiro resolver WhatsApp bloqueado; sem isso, a IA nao deve enviar.';
  if (stalled > 0) return 'Acao IA: checar worker de envio, fila vencida e respostas pendentes.';
  if (activityCount(activity, 'WATCH') > 0)
    return 'Acao IA: acompanhar proxima execucao antes de intervir.';
  return 'Acao IA: nenhuma intervencao necessaria.';
}

function buildWebhookProcessingLines(
  counts: AdminCountMap,
  webhookProcessing: AdminWebhookProcessing | undefined,
): string[] {
  const total = countOf(counts, 'webhookEvents');
  const failed = countOf(counts, 'webhookFailed');
  const stale = countOf(counts, 'webhookStaleProcessing');
  const repeated = countOf(counts, 'webhookDuplicateAttempts');
  const problemCount = failed + stale;
  const lines = [
    `Entrada WhatsApp: ${total === 0 ? 'nenhuma entrada recebida' : `${total} ${plural(total, 'entrada recebida', 'entradas recebidas')}`}; ${failed} com falha; ${stale} aberta ha mais de 5min.`,
  ];

  if (repeated > 0) {
    lines.push(
      `Reenvios reconhecidos: ${repeated} ${plural(repeated, 'evento repetido', 'eventos repetidos')} sem duplicar conversa.`,
    );
  }

  const issues = (webhookProcessing?.issues || [])
    .filter((issue) => ['FAILED', 'PROCESSING'].includes(String(issue.status || '').toUpperCase()))
    .slice(0, 3);

  if (problemCount > 0 && issues.length > 0) {
    for (const issue of issues) {
      const name = cleanText(issue.tenant_name || 'conta nao identificada', 120);
      const summary = sanitizePreview(
        issue.operator_summary || issue.error_message || 'entrada precisa de revisao',
        180,
      );
      lines.push(`- ${name}: ${summary}`);
    }
  } else if (problemCount === 0) {
    lines.push('- Nenhuma falha de entrada de mensagens detectada.');
  }

  return lines;
}

function buildWebhookProcessingAction(counts: AdminCountMap): string | null {
  const failed = countOf(counts, 'webhookFailed');
  const stale = countOf(counts, 'webhookStaleProcessing');
  if (failed + stale === 0) return null;
  return 'Acao entrada WhatsApp: abrir o monitoramento admin e conferir se alguma conversa recebida nao apareceu para atendimento.';
}

export function buildAdminReportMessage(schedule: ReportScheduleView, metrics: ReportMetricsView) {
  const counts = metrics.counts || {};
  const tenants = metrics.tenants || [];
  const tenantById = new Map(
    tenants.filter((tenant) => tenant.id).map((tenant) => [String(tenant.id), tenant]),
  );
  const guardianRows = metrics.guardianStatus || [];
  const recentMessages = (metrics.recentMessages || []).slice(-3);
  const errors = metrics.errors || [];
  const aiActivity = metrics.aiActivity;
  const webhookProcessing = metrics.webhookProcessing;
  const leads = countOf(counts, 'leadsCreated');
  const conversationsStarted = countOf(counts, 'conversationsStarted');
  const activeConversations = countOf(counts, 'activeConversations');
  const inbound = countOf(counts, 'inboundMessages');
  const outbound = countOf(counts, 'outboundMessages');
  const pending = countOf(counts, 'pendingDue');
  const webhookIssues =
    countOf(counts, 'webhookFailed') + countOf(counts, 'webhookStaleProcessing');
  const periodStart = formatBrtMinute(metrics.period?.start);
  const periodEnd = formatBrtMinute(metrics.period?.end);

  const situation = buildReportSituation(counts, guardianRows, errors);
  const lines = [
    'Prospix - relatorio de operacao',
    `Agenda: ${cleanText(schedule.name || 'sem nome', 80)}`,
    `Periodo: ${periodStart} a ${periodEnd}`,
    '',
    situation,
    `Captacao: ${leads === 0 ? 'nenhum lead novo' : `${leads} ${plural(leads, 'lead novo', 'leads novos')}`}.`,
    `Conversas: ${activeConversations} ativas; ${conversationsStarted === 0 ? 'nenhuma conversa nova' : `${conversationsStarted} ${plural(conversationsStarted, 'conversa nova', 'conversas novas')}`}.`,
  ];

  if (inbound > 0 || outbound > 0) {
    lines.push(`Interacoes: ${inbound} recebidas; ${outbound} enviadas pela IA.`);
  }

  lines.push(...buildWhatsAppSummary(guardianRows, tenantById));
  lines.push(...buildAiActivityLines(aiActivity));
  lines.push(...buildWebhookProcessingLines(counts, webhookProcessing));
  lines.push(
    `Pendencias: ${pending === 0 ? 'nenhuma fila vencida' : `${pending} ${plural(pending, 'mensagem pendente', 'mensagens pendentes')}`}.`,
  );

  if (recentMessages.length > 0) {
    lines.push('', 'Ultimas interacoes:', ...recentMessages.map(formatRecentMessage));
  } else {
    lines.push('Ultimas interacoes: nenhuma mensagem no periodo.');
  }

  const activityAction = buildAiActivityAction(aiActivity);
  const webhookAction = buildWebhookProcessingAction(counts);
  lines.push('', buildReportAction(counts, guardianRows, errors));
  if (activityAction) lines.push(activityAction);
  if (webhookAction) lines.push(webhookAction);

  const body = lines.join('\n');
  const summary = cleanText(
    [
      situation.replace('Situacao geral: ', ''),
      `${leads} leads novos.`,
      `${conversationsStarted} conversas novas.`,
      `${pending} pendencias.`,
      `${webhookIssues} falhas de entrada.`,
    ].join(' '),
    500,
  );

  return { summary, body };
}

function rawEvidenceText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return cleanText(value, 1200);
  try {
    return cleanText(JSON.stringify(value), 1200);
  } catch (_err) {
    return cleanText(value, 1200);
  }
}

function disconnectEvidenceText(input: DisconnectMessageInput): string {
  const values = [
    input.event?.raw_error_redacted,
    ...(input.connectionLogs || []).map((log) => log.raw_error_redacted),
    input.reasonCode,
    input.externalState,
  ];
  return values.map(rawEvidenceText).join(' ').toLowerCase();
}

function explainDisconnectReason(input: DisconnectMessageInput) {
  const text = disconnectEvidenceText(input);
  const reason = String(input.reasonCode || '').toUpperCase();
  const deviceRemoved = reason.includes('DEVICE_REMOVED') || text.includes('device_removed');
  const unauthorized =
    reason.includes('UNAUTHORIZED') || text.includes('unauthorized') || text.includes('401');
  const conflict = reason.includes('CONFLICT') || text.includes('conflict');
  const stream =
    reason.includes('STREAM') || text.includes('stream errored') || text.includes('stream:error');
  const instanceMissing =
    reason.includes('INSTANCE_NOT_FOUND') || text.includes('instance not found');

  if (deviceRemoved || (unauthorized && conflict)) {
    return {
      short: 'aparelho removido ou sessao sem autorizacao',
      systemResponse:
        'A Evolution API informou falha de autorizacao e conflito de sessao. O detalhe recebido indica que o aparelho conectado foi removido ou perdeu autorizacao no WhatsApp.',
      originalError:
        unauthorized || stream || conflict ? 'Unauthorized / Stream Errored (conflict)' : '',
      action:
        'Reconectar o WhatsApp pelo QR Code no Prospix. Se o WhatsApp exibir restricao da Meta, pause novos disparos e revise as ultimas conversas antes de reativar.',
    };
  }
  if (instanceMissing) {
    return {
      short: 'instancia nao encontrada',
      systemResponse: 'A Evolution API nao encontrou a instancia usada por esse WhatsApp.',
      originalError: 'Instance not found',
      action: 'Verificar a instancia Evolution configurada e reconectar o WhatsApp pelo QR Code.',
    };
  }
  if (stream || conflict) {
    return {
      short: 'falha de conexao com conflito de sessao',
      systemResponse:
        'A Evolution API retornou falha no fluxo de conexao do WhatsApp, com sinal de conflito de sessao.',
      originalError: stream ? 'Stream Errored (conflict)' : 'Session conflict',
      action: 'Reconectar o WhatsApp pelo QR Code e acompanhar se o erro se repete.',
    };
  }
  if (unauthorized) {
    return {
      short: 'autorizacao recusada',
      systemResponse: 'A Evolution API recusou a autorizacao da sessao atual do WhatsApp.',
      originalError: 'Unauthorized',
      action: 'Reconectar o WhatsApp pelo QR Code no Prospix.',
    };
  }
  return {
    short: 'conexao indisponivel',
    systemResponse:
      'O sistema detectou que a conexao do WhatsApp nao estava saudavel no momento da checagem.',
    originalError: '',
    action:
      'Verificar o status no Prospix e reconectar o WhatsApp se o numero continuar indisponivel.',
  };
}

function translateEventType(value: string | null | undefined): string {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'PRE_SEND_HEALTH_CHECK') return 'checagem antes do envio';
  if (normalized === 'CONNECTION_UPDATED') return 'evento de conexao recebido';
  if (normalized === 'QRCODE_UPDATED') return 'atualizacao de QR Code';
  if (normalized.includes('SEND')) return 'tentativa de envio';
  return 'checagem do sistema';
}

function translateLocalOutcome(value: string | null | undefined): string {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'SUSPENDED') return 'envios pausados para proteger a operacao';
  if (normalized === 'PAUSED') return 'envios temporariamente pausados';
  if (normalized === 'COLD') return 'numero mantido em observacao';
  if (normalized === 'RECOVERY') return 'retomada segura em andamento';
  if (normalized === 'NORMAL') return 'estado local mantido como OK';
  return 'acao preventiva registrada';
}

function shortLocalState(value: string | null | undefined): string {
  const normalized = String(value || '').toUpperCase();
  if (!normalized) return 'sem registro';
  if (normalized === 'SUSPENDED') return 'suspenso';
  if (normalized === 'PAUSED') return 'pausado';
  if (normalized === 'COLD') return 'em cuidado';
  if (normalized === 'RECOVERY') return 'em retomada';
  if (normalized === 'NORMAL') return 'normal';
  return cleanText(normalized.toLowerCase(), 60);
}

function localStateTransition(event: AdminConnectionLog | null | undefined): string {
  const beforeRaw = String(event?.local_status_before || '').toUpperCase();
  const afterRaw = String(event?.local_status_after || '').toUpperCase();
  const before = shortLocalState(beforeRaw);
  const after = shortLocalState(afterRaw);
  if (!beforeRaw && !afterRaw) return 'sem registro local';
  if (beforeRaw && afterRaw) return `${before} -> ${after} (${beforeRaw} -> ${afterRaw})`;
  if (afterRaw) return `${after} (${afterRaw})`;
  return beforeRaw;
}

function externalStateText(value: string | null | undefined): string {
  const raw = cleanText(value || '', 80);
  const normalized = raw.toLowerCase();
  if (!raw) return 'sem registro';
  if (['open', 'connected'].includes(normalized)) return `${raw} - conexao aberta`;
  if (['close', 'closed', 'disconnected'].includes(normalized)) return `${raw} - conexao fechada`;
  if (['connecting', 'connection'].includes(normalized)) return `${raw} - conectando`;
  if (['qrcode', 'qr'].includes(normalized)) return `${raw} - aguardando QR Code`;
  return raw;
}

function latestRawError(input: DisconnectMessageInput | RecoveryStructuralAlertInput): string {
  const logs = 'connectionLogs' in input ? input.connectionLogs || [] : [];
  const values = [
    ...logs.map((log) => log.raw_error_redacted),
    'event' in input ? input.event?.raw_error_redacted : null,
    'details' in input ? input.details : null,
  ];
  for (const value of values) {
    const text = rawEvidenceText(value);
    if (text) return text.slice(0, 260);
  }
  return '';
}

function queueTypeText(value: string | null | undefined): string {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'OUTBOUND_START') return 'primeiro contato';
  if (normalized === 'REACTIVE_REPLY') return 'resposta a lead';
  if (normalized === 'CHAT_CONTINUATION') return 'continuidade de conversa';
  if (normalized === 'LOOKUP_REPLY') return 'resposta de consulta';
  if (normalized === 'COMMERCIAL_FOLLOWUP') return 'follow-up comercial';
  return normalized ? cleanText(normalized.toLowerCase(), 80) : 'mensagem';
}

function formatQueueItem(item: AdminQueueItem): string {
  const lead = leadLabel({
    lead_name: item.lead_name || null,
    lead_whatsapp: item.lead_whatsapp || null,
  });
  const attempts = Number(item.attempts || 0);
  const attemptText =
    attempts > 0 ? `, ${attempts} ${plural(attempts, 'tentativa', 'tentativas')}` : '';
  return `- ${formatBrtHour(item.scheduled_for)}: ${queueTypeText(item.message_type)} para ${lead}${attemptText}.`;
}

function queueImpactLines(
  queue: AdminQueueImpact | null | undefined,
  fallbackDue: number | null | undefined,
): string[] {
  const active = queue?.activePending;
  const due = queue?.duePending ?? fallbackDue;
  const lines = [
    `- Vencidas agora: ${pendingText(due)}.`,
    `- Total aguardando: ${active == null ? 'nao informado' : pendingText(active)}.`,
  ];

  if (queue?.oldestDueAt)
    lines.push(`- Mais antiga vencida desde: ${formatBrtMinute(queue.oldestDueAt)}.`);
  if (queue?.nextScheduledFor)
    lines.push(`- Proxima prevista: ${formatBrtMinute(queue.nextScheduledFor)}.`);

  const sample = queue?.sample || [];
  if (sample.length > 0) {
    lines.push('- Amostra da fila afetada:', ...sample.slice(0, 3).map(formatQueueItem));
  }

  return lines;
}

function sortLogs(logs: AdminConnectionLog[]): AdminConnectionLog[] {
  return [...logs].sort((a, b) => {
    const left = new Date(a.created_at || 0).getTime();
    const right = new Date(b.created_at || 0).getTime();
    return left - right;
  });
}

function buildConnectionLogLines(
  logs: AdminConnectionLog[],
  event: AdminConnectionLog | null | undefined,
  reasonShort: string,
): string[] {
  const allLogs = sortLogs(logs.length > 0 ? logs : event ? [event] : []);
  if (allLogs.length === 0) return ['- Nenhum log estruturado foi encontrado para este evento.'];

  if (allLogs.length >= 3) {
    const first = allLogs[0];
    const last = allLogs[allLogs.length - 1];
    const firstTime = formatBrtHour(first.created_at);
    const lastTime = formatBrtHour(last.created_at);
    return [
      `- ${firstTime}: ${translateEventType(first.event_type)} detectou ${reasonShort}.`,
      firstTime === lastTime
        ? `- No mesmo minuto: ${allLogs.length} checagens confirmaram o incidente.`
        : `- ${firstTime} a ${lastTime}: ${allLogs.length} checagens confirmaram o incidente.`,
      `- Resultado: ${translateLocalOutcome(last.local_status_after)}.`,
    ];
  }

  return allLogs.map(
    (log) =>
      `- ${formatBrtHour(log.created_at)}: ${translateEventType(log.event_type)} detectou ${reasonShort}. Resultado: ${translateLocalOutcome(log.local_status_after)}.`,
  );
}

function pendingText(value: number | null | undefined): string {
  if (value == null) return 'nao informado';
  if (value === 0) return 'nenhuma mensagem aguardando envio';
  return `${value} ${plural(value, 'mensagem aguardando envio', 'mensagens aguardando envio')}`;
}

export function buildAdminDisconnectAlertMessage(input: DisconnectMessageInput) {
  const eventAt = input.event?.created_at || new Date().toISOString();
  const tenantName = friendlyTenantName(input.tenant || null);
  const reason = explainDisconnectReason(input);
  const pending = input.pendingDueCount ?? input.event?.pending_due_count ?? null;
  const recentOutbound = (input.recentMessages || [])
    .filter((message) => String(message.direction || '').toUpperCase() === 'OUTBOUND')
    .slice(-4);
  const logLines = buildConnectionLogLines(
    input.connectionLogs || [],
    input.event || null,
    reason.short,
  );
  const reasonCode = cleanText(input.reasonCode || input.event?.reason_code || 'sem codigo', 120);
  const externalState = input.externalState ?? input.event?.external_state ?? null;
  const rawError = latestRawError(input);
  const bodyLines = [
    'Prospix - alerta de WhatsApp',
    '',
    `Atencao: o WhatsApp de ${tenantName} foi desconectado.`,
    '',
    `Quando: ${formatBrtMinute(eventAt)}`,
    `Tenant: ${tenantName}`,
    `Estado local: ${localStateTransition(input.event || null)}.`,
    `Motivo do sistema: ${reasonCode}.`,
    `Estado Evolution: ${externalStateText(externalState)}.`,
    'Impacto: a IA foi pausada para esse numero e nao deve enviar novas mensagens ate a reconexao.',
    '',
    'Fila afetada:',
    ...queueImpactLines(input.queueImpact || null, pending),
    '',
    'Resposta do sistema:',
    reason.systemResponse,
  ];

  if (reason.originalError || rawError) {
    bodyLines.push('', 'Erro registrado:', reason.originalError || rawError);
    if (reason.originalError && rawError && rawError !== reason.originalError) {
      bodyLines.push(`Detalhe recebido: ${rawError}`);
    }
  }

  bodyLines.push('', 'Logs do evento:', ...logLines);

  if (recentOutbound.length > 0) {
    bodyLines.push(
      '',
      'Ultimos envios nas 5h anteriores:',
      ...recentOutbound.map(formatRecentMessage),
    );
  } else {
    bodyLines.push(
      '',
      'Ultimos envios nas 5h anteriores:',
      'Nao foram encontrados envios da IA nesse periodo.',
    );
  }

  bodyLines.push('', 'Acao recomendada:', reason.action);

  const body = bodyLines.join('\n');
  const summary = cleanText(
    `WhatsApp de ${tenantName} desconectado em ${formatBrtMinute(eventAt)}. Motivo: ${reason.short}.`,
    500,
  );
  return { summary, body };
}

export function buildAdminRecoveryStructuralAlertMessage(input: RecoveryStructuralAlertInput) {
  const createdAt = input.createdAt || new Date().toISOString();
  const tenantName = friendlyTenantName(input.tenant || null);
  const reasonCode = cleanText(input.reasonCode || 'RECOVERY_STRUCTURAL_BLOCKED', 140);
  const structuralReason = cleanText(
    input.structuralReason || 'Dependencia estrutural obrigatoria indisponivel.',
    260,
  );
  const detail = latestRawError(input);
  const recentOutbound = (input.recentOutboundMessages || []).slice(-4);
  const bodyLines = [
    'Prospix - alerta de recuperacao',
    '',
    `Atencao: RECOVERY bloqueado por erro estrutural em ${tenantName}.`,
    '',
    `Quando: ${formatBrtMinute(createdAt)}`,
    `Tenant: ${tenantName}`,
    'Estado local: em retomada (RECOVERY).',
    `Motivo do sistema: ${reasonCode}.`,
    '',
    'O que aconteceu:',
    structuralReason,
    '',
    'Impacto:',
    'A IA manteve o bloqueio preventivo e nao abriu reprocessamento amplo. Essa protecao evita disparos duplicados, fora de criterio ou para leads errados enquanto a dependencia obrigatoria estiver indisponivel.',
    '',
    'Fila afetada:',
    ...queueImpactLines(input.queueImpact || null, input.pendingDueCount ?? null),
  ];

  if (detail) {
    bodyLines.push('', 'Erro registrado:', detail);
  }

  if (recentOutbound.length > 0) {
    bodyLines.push(
      '',
      'Ultimos envios nas 5h anteriores:',
      ...recentOutbound.map(formatRecentMessage),
    );
  } else {
    bodyLines.push(
      '',
      'Ultimos envios nas 5h anteriores:',
      'Nao foram encontrados envios da IA nesse periodo.',
    );
  }

  bodyLines.push(
    '',
    'Acao recomendada:',
    'Validar a baseline canonica do banco, confirmar que a visao de elegibilidade esta acessivel ao service role e executar nova rodada do worker. Nao forcar disparo manual enquanto esse alerta estiver ativo.',
  );

  const body = bodyLines.join('\n');
  const summary = cleanText(
    `RECOVERY bloqueado por erro estrutural em ${tenantName}: ${structuralReason}`,
    500,
  );
  return { summary, body };
}

function activityStateLabel(value: string | null | undefined): string {
  const state = String(value || '').toUpperCase();
  if (state === 'BLOCKED') return 'IA bloqueada';
  if (state === 'STALLED') return 'IA atrasada';
  if (state === 'WATCH') return 'IA em acompanhamento';
  return 'atividade da IA';
}

function activityImpactText(activity: AdminAiActivityTenant): string {
  const state = String(activity.state || '').toUpperCase();
  if (state === 'BLOCKED') {
    if (activity.guardian_blocking_send && Number(activity.due_pending || 0) > 0) {
      return 'ha mensagens prontas, mas o WhatsApp esta desconectado, pausado ou sem autorizacao para envio.';
    }
    return 'a IA nao deve enviar mensagens ate o bloqueio operacional ser resolvido.';
  }
  if (Number(activity.due_pending || 0) > 0) {
    return 'ha mensagens que ja deveriam ter sido enviadas e continuam pendentes.';
  }
  if (Number(activity.unanswered_conversations || 0) > 0) {
    return 'ha conversas de leads aguardando resposta da IA alem da tolerancia.';
  }
  return 'a operacao precisa de acompanhamento porque ha sinais de atraso.';
}

function queueStatusText(activity: AdminAiActivityTenant): string {
  const due = Number(activity.due_pending || 0);
  const active = Number(activity.active_pending || 0);
  const status = String(activity.worker_status || '').toUpperCase();
  if (due > 0 && activity.guardian_blocking_send) return 'pronta, aguardando reconexao';
  if (due > 0) return 'atrasada';
  if (active > 0) return 'aguardando horario seguro';
  if (status === 'FAILED') return 'ultimo envio falhou';
  if (status === 'BLOCKED') return 'ultimo envio bloqueado';
  if (status === 'SENT') return 'ultimo envio concluido';
  return 'sem fila ativa';
}

export function buildAdminAiActivityAlertMessage(input: AiActivityAlertInput) {
  const activity = input.activity;
  const tenantName = cleanText(
    activity.tenant_name || input.tenant?.name || input.tenant?.slug || 'tenant desconhecido',
    120,
  );
  const stateLabel = activityStateLabel(activity.state);
  const createdAt = input.createdAt || new Date().toISOString();
  const summaryText = sanitizePreview(
    activity.summary || 'A operacao da IA precisa de acompanhamento.',
    220,
  );
  const actionText = sanitizePreview(
    activity.action || 'Verificar o painel de monitoramento administrativo.',
    220,
  );
  const activePending = Number(activity.active_pending || 0);
  const bodyLines = [
    'Prospix - alerta de atividade da IA',
    '',
    `Atencao: ${stateLabel} em ${tenantName}.`,
    '',
    `Quando: ${formatBrtMinute(createdAt)}`,
    `Impacto: ${activityImpactText(activity)}`,
    '',
    'Evidencias:',
    `- Leads prontos para primeiro contato: ${Number(activity.contactable_backlog || 0)} de ${Number(activity.first_touch_evaluated || 0)} avaliados.`,
    `- Mensagens vencidas na fila: ${Number(activity.due_pending || 0)}.`,
    `- Fila atual: ${activePending} ${plural(activePending, 'mensagem', 'mensagens')}, ${queueStatusText(activity)}.`,
    `- Falhas ou bloqueios nas ultimas 24h: ${Number(activity.blocked_or_failed_last24h || 0)}.`,
    `- Conversas aguardando resposta: ${Number(activity.unanswered_conversations || 0)}.`,
    `- Envios da IA hoje: ${Number(activity.outbound_today || 0)} (${Number(activity.outbound_last_60m || 0)} na ultima hora).`,
    `- Entradas de leads hoje: ${Number(activity.inbound_today || 0)}.`,
    `- Ultimo envio da IA: ${formatBrtMinute(activity.latest_ai_message_at)}.`,
    `- Proximo envio previsto: ${formatBrtMinute(activity.next_scheduled_for)}.`,
    `- Estado do WhatsApp: ${sanitizePreview(activity.guardian_block_summary || activity.guardian_status || 'sem registro', 120)}.`,
  ];

  const reason =
    activity.guardian_reason_code ||
    activity.worker_failed_reason ||
    activity.worker_validation_reason_code ||
    activity.worker_final_guardian_decision ||
    null;
  if (reason) {
    bodyLines.push(`- Motivo registrado: ${sanitizePreview(reason, 160)}.`);
  }

  bodyLines.push('', 'Resumo:', summaryText, '', 'Acao recomendada:', actionText);

  const body = bodyLines.join('\n');
  const summary = cleanText(`${stateLabel} em ${tenantName}: ${summaryText}`, 500);
  return { summary, body };
}
