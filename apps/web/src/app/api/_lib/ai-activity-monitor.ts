type SupabaseLike = {
  from: (table: string) => any;
};

export type AiActivityState = 'OK' | 'WATCH' | 'STALLED' | 'BLOCKED' | 'OFF_HOURS';

export type FirstTouchEligibilitySummary = {
  eligible: number;
  totalEvaluated: number;
  byReason: Record<string, number>;
  topBlockingReason: string | null;
  topBlockingReasonLabel: string | null;
  topBlockingReasonCount: number;
};

export type AiWorkerOperationalSnapshot = {
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
};

export type TenantAiActivity = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string | null;
  state: AiActivityState;
  label: string;
  severity: 'INFO' | 'OBSERVATION' | 'ATTENTION' | 'CRITICAL';
  summary: string;
  requiredAction: string;
  isOperatingWindow: boolean;
  operatingWindowLabel: string;
  leadsCreatedToday: number;
  contactableBacklog: number;
  oldestContactableLeadAt: string | null;
  firstTouchEligibility: FirstTouchEligibilitySummary;
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
  workerSnapshot: AiWorkerOperationalSnapshot | null;
};

export type AiActivityMonitor = {
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
  tenants: TenantAiActivity[];
  evidenceErrors: string[];
};

type LoadOptions = {
  tenantIds?: string[];
  tenants?: Array<Record<string, any>>;
  guardianStates?: Array<Record<string, any>>;
  now?: Date;
};

const OPERATING_START_HOUR = 9;
const OPERATING_END_HOUR = 18;
const BRT_UTC_OFFSET_HOURS = 3;
const DUE_PENDING_STALLED_MINUTES = 15;
const UNANSWERED_STALLED_MINUTES = 10;

const EMPTY_FIRST_TOUCH_ELIGIBILITY: FirstTouchEligibilitySummary = {
  eligible: 0,
  totalEvaluated: 0,
  byReason: {},
  topBlockingReason: null,
  topBlockingReasonLabel: null,
  topBlockingReasonCount: 0,
};

const FIRST_TOUCH_REASON_LABELS: Record<string, string> = {
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

function brtParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: Number(map.get('hour')),
    minute: Number(map.get('minute')),
    weekday: map.get('weekday') || '',
  };
}

function brtTodayAt(parts: ReturnType<typeof brtParts>, hour: number): string {
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour + BRT_UTC_OFFSET_HOURS,
    0,
    0,
    0,
  )).toISOString();
}

function buildOperatingWindow(now: Date) {
  const parts = brtParts(now);
  const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
  const isOpen = !weekend && parts.hour >= OPERATING_START_HOUR && parts.hour < OPERATING_END_HOUR;
  return {
    isOpen,
    label: isOpen
      ? 'Horario ativo de prospeccao'
      : weekend
        ? 'Fora do horario ativo: fim de semana'
        : `Fora do horario ativo: ${OPERATING_START_HOUR}h as ${OPERATING_END_HOUR}h`,
    dayStartAt: brtTodayAt(parts, 0),
    operatingStartAt: brtTodayAt(parts, OPERATING_START_HOUR),
    operatingEndAt: brtTodayAt(parts, OPERATING_END_HOUR),
  };
}

function tenantScope(query: any, tenantIds: string[]) {
  return tenantIds.length > 0 ? query.in('tenant_id', tenantIds) : query;
}

async function loadRows<T>(
  label: string,
  query: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  errors: string[],
): Promise<T[]> {
  try {
    const { data, error } = await query;
    if (error) {
      errors.push(`${label}: ${error.message || 'erro desconhecido'}`);
      return [];
    }
    return data || [];
  } catch (err: any) {
    errors.push(`${label}: ${String(err?.message || err).slice(0, 240)}`);
    return [];
  }
}

async function loadTenants(supabase: SupabaseLike, options: LoadOptions, errors: string[]) {
  if (options.tenants) return options.tenants;

  let query = supabase
    .from('tenants')
    .select('id, name, slug, status')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (options.tenantIds?.length) query = query.in('id', options.tenantIds);
  return loadRows<Record<string, any>>('tenants', query, errors);
}

async function loadGuardianRows(
  supabase: SupabaseLike,
  tenantIds: string[],
  provided: Array<Record<string, any>> | undefined,
  errors: string[],
) {
  if (provided) return provided;

  let query = supabase
    .from('whatsapp_guardian_status')
    .select('tenant_id, status, external_state, last_disconnect_reason_code, quarantined_until, circuit_open_until, updated_at');
  query = tenantScope(query, tenantIds);
  return loadRows<Record<string, any>>('guardian_status', query, errors);
}

function byTenant(rows: Array<Record<string, any>>, tenantKey = 'tenant_id') {
  const map = new Map<string, Array<Record<string, any>>>();
  for (const row of rows) {
    const tenantId = String(row[tenantKey] || '');
    if (!tenantId) continue;
    const list = map.get(tenantId) || [];
    list.push(row);
    map.set(tenantId, list);
  }
  return map;
}

function latestAt(rows: Array<Record<string, any>>, field: string): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    const value = row[field] ? String(row[field]) : null;
    if (value && (!latest || value > latest)) latest = value;
  }
  return latest;
}

function oldestAt(rows: Array<Record<string, any>>, field: string): string | null {
  let oldest: string | null = null;
  for (const row of rows) {
    const value = row[field] ? String(row[field]) : null;
    if (value && (!oldest || value < oldest)) oldest = value;
  }
  return oldest;
}

function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return FIRST_TOUCH_REASON_LABELS[reason] || reason.replaceAll('_', ' ').toLowerCase();
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function mapWorkerSnapshot(row: Record<string, any> | null | undefined): AiWorkerOperationalSnapshot | null {
  if (!row) return null;
  return {
    activePending: Number(row.active_pending ?? 0),
    duePending: Number(row.due_pending ?? 0),
    approvedPending: Number(row.approved_pending ?? 0),
    delayedPending: Number(row.delayed_pending ?? 0),
    blockedOrFailedLast24h: Number(row.blocked_or_failed_last24h ?? 0),
    nextScheduledFor: row.next_scheduled_for ?? null,
    oldestDueAt: row.oldest_due_at ?? null,
    oldestDueAgeSeconds: row.oldest_due_age_seconds == null ? null : Number(row.oldest_due_age_seconds),
    sentToday: Number(row.sent_today ?? 0),
    sentLast60m: Number(row.sent_last60m ?? 0),
    latestAiMessageAt: row.latest_ai_message_at ?? null,
    latestInboundAt: row.latest_inbound_at ?? null,
    latestRetryQueuedAt: row.latest_retry_queued_at ?? null,
    guardianStatus: row.guardian_status ?? null,
    guardianExternalState: row.guardian_external_state ?? null,
    guardianReasonCode: row.guardian_reason_code ?? null,
    guardianOperationState: row.guardian_operation_state ?? null,
    guardianBlockingSend: Boolean(row.guardian_blocking_send),
    guardianBlockSummary: row.guardian_block_summary ?? null,
    firstTouchEligible: Number(row.first_touch_eligible ?? 0),
    firstTouchEvaluated: Number(row.first_touch_evaluated ?? 0),
    latestQueue: row.latest_queue_id
      ? {
          id: row.latest_queue_id ?? null,
          messageType: row.latest_queue_message_type ?? null,
          status: row.latest_queue_status ?? null,
          createdAt: row.latest_queue_created_at ?? null,
          scheduledFor: row.latest_queue_scheduled_for ?? null,
          sentAt: row.latest_queue_sent_at ?? null,
          failedAt: row.latest_queue_failed_at ?? null,
          failedReason: row.latest_queue_failed_reason ?? null,
          validationStatus: row.latest_queue_validation_status ?? null,
          validationReasonCode: row.latest_queue_validation_reason_code ?? null,
          finalGuardianDecision: row.latest_queue_final_guardian_decision ?? null,
        }
      : null,
  };
}

function buildFirstTouchEligibilitySummary(rows: Array<Record<string, any>>): FirstTouchEligibilitySummary {
  if (!rows.length) return { ...EMPTY_FIRST_TOUCH_ELIGIBILITY, byReason: {} };

  const byReason: Record<string, number> = {};
  let eligible = 0;
  let topBlockingReason: string | null = null;
  let topBlockingReasonCount = 0;

  for (const row of rows) {
    const reason = String(row.eligibility_reason || (row.is_eligible_now ? 'ELIGIBLE' : 'UNKNOWN'));
    byReason[reason] = (byReason[reason] || 0) + 1;
    if (row.is_eligible_now === true || reason === 'ELIGIBLE') {
      eligible += 1;
      continue;
    }
    if (byReason[reason] > topBlockingReasonCount) {
      topBlockingReason = reason;
      topBlockingReasonCount = byReason[reason];
    }
  }

  return {
    eligible,
    totalEvaluated: rows.length,
    byReason,
    topBlockingReason,
    topBlockingReasonLabel: reasonLabel(topBlockingReason),
    topBlockingReasonCount,
  };
}

function ageMinutes(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((nowMs - time) / 60000));
}

function guardianOperation(row: Record<string, any> | undefined) {
  const status = String(row?.status || '').toUpperCase();
  const operation = String(row?.operationState || row?.operation_state || '').toUpperCase();
  if (operation) return operation;
  if (status === 'SUSPENDED') return 'REQUIRES_ACTION';
  if (status === 'PAUSED') return 'BLOCKED';
  if (status === 'COLD' || status === 'RECOVERY' || status === 'HIGH_LOAD' || status === 'COOLDOWN') return 'THROTTLED';
  return status ? 'ACTIVE' : null;
}

function classifyTenantActivity(input: {
  tenantStatus: string | null;
  isOperatingWindow: boolean;
  guardianStatus: string | null;
  guardianOperationState: string | null;
  contactableBacklog: number;
  oldestContactableLeadAt: string | null;
  firstTouchEligibility: FirstTouchEligibilitySummary;
  duePending: number;
  oldestDuePendingAt: string | null;
  unansweredConversations: number;
  oldestUnansweredInboundAt: string | null;
  outboundToday: number;
  workerSnapshot?: AiWorkerOperationalSnapshot | null;
  nowMs: number;
}): Pick<TenantAiActivity, 'state' | 'label' | 'severity' | 'summary' | 'requiredAction'> {
  const inactiveTenant = input.tenantStatus && input.tenantStatus !== 'ACTIVE';
  if (inactiveTenant) {
    return {
      state: 'OFF_HOURS',
      label: 'Tenant sem operacao ativa',
      severity: 'INFO',
      summary: 'Tenant nao esta marcado como ACTIVE; a IA nao deve iniciar operacao comercial normal.',
      requiredAction: 'Nenhuma acao de IA enquanto o tenant nao estiver ativo.',
    };
  }

  if (input.guardianOperationState === 'REQUIRES_ACTION' || input.guardianOperationState === 'BLOCKED') {
    const duePending = input.workerSnapshot?.duePending ?? input.duePending;
    const pendingDetail = duePending > 0
      ? ` ${countLabel(duePending, 'mensagem pronta aguarda', 'mensagens prontas aguardam')} reconexao antes de enviar.`
      : '';
    return {
      state: 'BLOCKED',
      label: 'IA bloqueada pelo WhatsApp',
      severity: 'CRITICAL',
      summary: `${input.workerSnapshot?.guardianBlockSummary || 'A conexao do WhatsApp esta bloqueada ou exige acao.'}.${pendingDetail}`,
      requiredAction: 'Reconectar ou estabilizar o WhatsApp antes de esperar novos envios.',
    };
  }

  const dueAge = ageMinutes(input.oldestDuePendingAt, input.nowMs);
  if (input.duePending > 0 && (dueAge ?? 0) >= DUE_PENDING_STALLED_MINUTES) {
    return {
      state: 'STALLED',
      label: 'Fila vencida',
      severity: 'ATTENTION',
      summary: input.duePending === 1
        ? '1 mensagem deveria ter sido enviada e ainda esta pendente.'
        : `${countLabel(input.duePending, 'mensagem', 'mensagens')} deveriam ter sido enviadas e ainda estao pendentes.`,
      requiredAction: 'Executar/checar send-messages e validar se Guardian, campanha ou WhatsApp estao bloqueando a fila.',
    };
  }

  const unansweredAge = ageMinutes(input.oldestUnansweredInboundAt, input.nowMs);
  if (input.unansweredConversations > 0 && (unansweredAge ?? 0) >= UNANSWERED_STALLED_MINUTES) {
    return {
      state: 'STALLED',
      label: 'Resposta atrasada',
      severity: 'ATTENTION',
      summary: input.unansweredConversations === 1
        ? '1 conversa recebeu mensagem do lead e ainda nao teve resposta posterior da IA.'
        : `${countLabel(input.unansweredConversations, 'conversa', 'conversas')} receberam mensagem do lead e ainda nao tiveram resposta posterior da IA.`,
      requiredAction: 'Priorizar continuacao de conversa antes de novas prospeccoes.',
    };
  }

  if (input.isOperatingWindow && input.contactableBacklog > 0 && input.outboundToday === 0) {
    return {
      state: 'WATCH',
      label: 'Sem primeiro envio hoje',
      severity: 'OBSERVATION',
      summary: input.contactableBacklog === 1
        ? '1 lead enriquecido esta elegivel pela regra canonica de primeiro contato, mas ainda nao houve envio da IA hoje.'
        : `${countLabel(input.contactableBacklog, 'lead enriquecido', 'leads enriquecidos')} estao elegiveis pela regra canonica de primeiro contato, mas ainda nao houve envio da IA hoje.`,
      requiredAction: 'Acompanhar a proxima execucao do worker e verificar campanha ativa, horario e limites de cadencia.',
    };
  }

  if (
    input.isOperatingWindow &&
    input.contactableBacklog === 0 &&
    input.outboundToday === 0 &&
    input.firstTouchEligibility.totalEvaluated > 0 &&
    input.firstTouchEligibility.topBlockingReason
  ) {
    const reason = input.firstTouchEligibility.topBlockingReasonLabel || 'criterio operacional';
    const count = input.firstTouchEligibility.topBlockingReasonCount;
    return {
      state: 'WATCH',
      label: 'Sem lead elegivel',
      severity: 'OBSERVATION',
      summary: `Nenhum lead atende a todos os criterios canonicos de primeiro contato agora. Principal motivo: ${reason} (${count}).`,
      requiredAction: 'Corrigir o motivo principal antes de esperar novos envios automaticos da IA.',
    };
  }

  if (input.duePending > 0 || input.unansweredConversations > 0 || input.contactableBacklog > 0) {
    return {
      state: 'WATCH',
      label: 'Operacao com pendencias',
      severity: 'OBSERVATION',
      summary: 'Existem itens para acompanhar, mas ainda dentro da janela de tolerancia operacional.',
      requiredAction: 'Monitorar a proxima execucao antes de intervir.',
    };
  }

  if (!input.isOperatingWindow) {
    return {
      state: 'OFF_HOURS',
      label: 'Fora do horario ativo',
      severity: 'INFO',
      summary: 'Fora do periodo esperado para novas prospeccoes; respostas podem depender das regras do worker.',
      requiredAction: 'Nenhuma acao imediata.',
    };
  }

  if (input.guardianOperationState === 'THROTTLED') {
    if (String(input.guardianStatus || '').toUpperCase() === 'RECOVERY') {
      return {
        state: 'WATCH',
        label: 'Retomada segura',
        severity: 'OBSERVATION',
        summary: 'A IA esta retomando apos reconexao: responde normalmente, mas novos contatos sao seletivos e enviados em ritmo controlado.',
        requiredAction: 'Acompanhar se ha envios bem-sucedidos e se o estado volta para Operacional apos o periodo minimo de observacao.',
      };
    }

    return {
      state: 'WATCH',
      label: 'IA operando com cuidado',
      severity: 'OBSERVATION',
      summary: 'O WhatsApp esta em estado de cuidado; a IA pode enviar, mas com ritmo reduzido.',
      requiredAction: 'Acompanhar volume e evitar aumentar cadencia manualmente.',
    };
  }

  return {
    state: 'OK',
    label: 'IA operacional',
    severity: 'INFO',
    summary: 'Nao ha fila vencida, conversa sem resposta atrasada ou lead apto parado fora da tolerancia.',
    requiredAction: 'Nenhuma acao imediata.',
  };
}

export async function loadAiActivityMonitor(
  supabase: SupabaseLike,
  options: LoadOptions = {},
): Promise<AiActivityMonitor> {
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const evidenceErrors: string[] = [];
  const operatingWindow = buildOperatingWindow(now);
  const tenantRows = await loadTenants(supabase, options, evidenceErrors);
  const tenantIds = (options.tenantIds?.length ? options.tenantIds : tenantRows.map((tenant) => String(tenant.id))).filter(Boolean);
  const last60m = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const unansweredCutoff = new Date(nowMs - UNANSWERED_STALLED_MINUTES * 60 * 1000).toISOString();

  let firstTouchEligibilityQuery = supabase
    .from('first_touch_lead_eligibility')
    .select('tenant_id, lead_id, created_at, eligibility_reason, is_eligible_now')
    .eq('lead_status', 'ENRICHED')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(5000);
  firstTouchEligibilityQuery = tenantScope(firstTouchEligibilityQuery, tenantIds);
  let firstTouchEligibilityRows = await loadRows<Record<string, any>>('first_touch_eligibility', firstTouchEligibilityQuery, evidenceErrors);

  const firstTouchEligibilityErrorIndex = evidenceErrors.findIndex((error) => error.startsWith('first_touch_eligibility:'));
  if (firstTouchEligibilityErrorIndex >= 0) {
    evidenceErrors.splice(firstTouchEligibilityErrorIndex, 1);
    let fallbackLeadQuery = supabase
      .from('leads')
      .select('id, tenant_id, created_at')
      .eq('status', 'ENRICHED')
      .is('deleted_at', null)
      .is('contacted_at', null)
      .is('queued_first_touch_at', null)
      .not('campaign_id', 'is', null)
      .not('whatsapp', 'is', null)
      .or('whatsapp_valid.is.null,whatsapp_valid.eq.true')
      .order('created_at', { ascending: true })
      .limit(1000);
    fallbackLeadQuery = tenantScope(fallbackLeadQuery, tenantIds);
    const fallbackRows = await loadRows<Record<string, any>>('first_touch_eligibility_fallback', fallbackLeadQuery, evidenceErrors);
    firstTouchEligibilityRows = fallbackRows.map((row) => ({
      tenant_id: row.tenant_id,
      lead_id: row.id,
      created_at: row.created_at,
      eligibility_reason: 'ELIGIBLE',
      is_eligible_now: true,
    }));
  }

  let leadsTodayQuery = supabase
    .from('leads')
    .select('id, tenant_id, created_at')
    .is('deleted_at', null)
    .gte('created_at', operatingWindow.dayStartAt)
    .lte('created_at', nowIso)
    .limit(1000);
  leadsTodayQuery = tenantScope(leadsTodayQuery, tenantIds);

  let pendingDueQuery = supabase
    .from('pending_outbound')
    .select('id, tenant_id, conversation_id, scheduled_for, created_at, attempts')
    .is('sent_at', null)
    .is('failed_at', null)
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(1000);
  pendingDueQuery = tenantScope(pendingDueQuery, tenantIds);

  let conversationsQuery = supabase
    .from('conversations')
    .select('id, tenant_id, lead_id, status, ai_handling, last_inbound_at, last_outbound_at, last_message_at')
    .eq('status', 'ACTIVE')
    .eq('ai_handling', true)
    .not('last_inbound_at', 'is', null)
    .lte('last_inbound_at', unansweredCutoff)
    .limit(1000);
  conversationsQuery = tenantScope(conversationsQuery, tenantIds);

  let outboundTodayQuery = supabase
    .from('messages')
    .select('id, tenant_id, created_at, direction, sender')
    .eq('direction', 'OUTBOUND')
    .eq('sender', 'AI')
    .gte('created_at', operatingWindow.dayStartAt)
    .lte('created_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1000);
  outboundTodayQuery = tenantScope(outboundTodayQuery, tenantIds);

  let inboundTodayQuery = supabase
    .from('messages')
    .select('id, tenant_id, created_at, direction')
    .eq('direction', 'INBOUND')
    .gte('created_at', operatingWindow.dayStartAt)
    .lte('created_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1000);
  inboundTodayQuery = tenantScope(inboundTodayQuery, tenantIds);

  let workerSnapshotQuery = supabase
    .from('ai_worker_operational_snapshot')
    .select([
      'tenant_id',
      'active_pending',
      'due_pending',
      'approved_pending',
      'delayed_pending',
      'blocked_or_failed_last24h',
      'next_scheduled_for',
      'oldest_due_at',
      'oldest_due_age_seconds',
      'sent_today',
      'sent_last60m',
      'latest_ai_message_at',
      'latest_inbound_at',
      'latest_retry_queued_at',
      'guardian_status',
      'guardian_external_state',
      'guardian_reason_code',
      'guardian_operation_state',
      'guardian_blocking_send',
      'guardian_block_summary',
      'first_touch_eligible',
      'first_touch_evaluated',
      'latest_queue_id',
      'latest_queue_message_type',
      'latest_queue_status',
      'latest_queue_created_at',
      'latest_queue_scheduled_for',
      'latest_queue_sent_at',
      'latest_queue_failed_at',
      'latest_queue_failed_reason',
      'latest_queue_validation_status',
      'latest_queue_validation_reason_code',
      'latest_queue_final_guardian_decision',
    ].join(', '));
  workerSnapshotQuery = tenantScope(workerSnapshotQuery, tenantIds);

  const [
    leadsToday,
    pendingDue,
    conversations,
    outboundToday,
    inboundToday,
    guardianRows,
    workerSnapshotRows,
  ] = await Promise.all([
    loadRows<Record<string, any>>('leads_today', leadsTodayQuery, evidenceErrors),
    loadRows<Record<string, any>>('pending_due', pendingDueQuery, evidenceErrors),
    loadRows<Record<string, any>>('unanswered_conversations', conversationsQuery, evidenceErrors),
    loadRows<Record<string, any>>('outbound_today', outboundTodayQuery, evidenceErrors),
    loadRows<Record<string, any>>('inbound_today', inboundTodayQuery, evidenceErrors),
    loadGuardianRows(supabase, tenantIds, options.guardianStates, evidenceErrors),
    loadRows<Record<string, any>>('ai_worker_operational_snapshot', workerSnapshotQuery, evidenceErrors),
  ]);

  const firstTouchEligibilityByTenant = byTenant(firstTouchEligibilityRows);
  const leadsTodayByTenant = byTenant(leadsToday);
  const pendingByTenant = byTenant(pendingDue);
  const unansweredByTenant = byTenant(conversations.filter((conversation) => {
    const inbound = conversation.last_inbound_at ? String(conversation.last_inbound_at) : null;
    const outbound = conversation.last_outbound_at ? String(conversation.last_outbound_at) : null;
    return inbound && (!outbound || inbound > outbound);
  }));
  const outboundByTenant = byTenant(outboundToday);
  const inboundByTenant = byTenant(inboundToday);
  const guardianByTenant = new Map<string, Record<string, any>>();
  for (const row of guardianRows) {
    const id = String(row.tenantId || row.tenant_id || '');
    if (id) guardianByTenant.set(id, row);
  }
  const workerByTenant = new Map<string, AiWorkerOperationalSnapshot>();
  for (const row of workerSnapshotRows) {
    const tenantId = String(row.tenant_id || '');
    const snapshot = mapWorkerSnapshot(row);
    if (tenantId && snapshot) workerByTenant.set(tenantId, snapshot);
  }

  const tenants = tenantRows.map((tenant) => {
    const tenantId = String(tenant.id);
    const firstTouchRows = firstTouchEligibilityByTenant.get(tenantId) || [];
    const firstTouchEligibility = buildFirstTouchEligibilitySummary(firstTouchRows);
    const contactable = firstTouchRows.filter((row) => row.is_eligible_now === true || row.eligibility_reason === 'ELIGIBLE');
    const due = pendingByTenant.get(tenantId) || [];
    const unanswered = unansweredByTenant.get(tenantId) || [];
    const outbounds = outboundByTenant.get(tenantId) || [];
    const inbounds = inboundByTenant.get(tenantId) || [];
    const guardian = guardianByTenant.get(tenantId);
    const workerSnapshot = workerByTenant.get(tenantId) || null;
    const operationState = guardianOperation(guardian);
    const guardianStatus = guardian?.status ? String(guardian.status) : null;
    const contactableBacklog = workerSnapshot?.firstTouchEligible ?? contactable.length;
    const duePending = workerSnapshot?.duePending ?? due.length;
    const outboundTodayCount = workerSnapshot?.sentToday ?? outbounds.length;
    const outboundLast60m = workerSnapshot?.sentLast60m
      ?? outbounds.filter((message) => String(message.created_at || '') >= last60m).length;
    const classified = classifyTenantActivity({
      tenantStatus: tenant.status ? String(tenant.status) : null,
      isOperatingWindow: operatingWindow.isOpen,
      guardianStatus,
      guardianOperationState: workerSnapshot?.guardianOperationState || operationState,
      contactableBacklog,
      oldestContactableLeadAt: oldestAt(contactable, 'created_at'),
      firstTouchEligibility,
      duePending,
      oldestDuePendingAt: workerSnapshot?.oldestDueAt || oldestAt(due, 'scheduled_for'),
      unansweredConversations: unanswered.length,
      oldestUnansweredInboundAt: oldestAt(unanswered, 'last_inbound_at'),
      outboundToday: outboundTodayCount,
      workerSnapshot,
      nowMs,
    });

    return {
      tenantId,
      tenantName: String(tenant.name || tenant.slug || tenantId),
      tenantSlug: String(tenant.slug || ''),
      tenantStatus: tenant.status ? String(tenant.status) : null,
      ...classified,
      isOperatingWindow: operatingWindow.isOpen,
      operatingWindowLabel: operatingWindow.label,
      leadsCreatedToday: (leadsTodayByTenant.get(tenantId) || []).length,
      contactableBacklog,
      oldestContactableLeadAt: oldestAt(contactable, 'created_at'),
      firstTouchEligibility,
      duePending,
      oldestDuePendingAt: workerSnapshot?.oldestDueAt || oldestAt(due, 'scheduled_for'),
      unansweredConversations: unanswered.length,
      oldestUnansweredInboundAt: oldestAt(unanswered, 'last_inbound_at'),
      outboundToday: outboundTodayCount,
      outboundLast60m,
      inboundToday: inbounds.length,
      lastOutboundAt: workerSnapshot?.latestAiMessageAt || latestAt(outbounds, 'created_at'),
      lastInboundAt: workerSnapshot?.latestInboundAt || latestAt(inbounds, 'created_at'),
      guardianStatus: workerSnapshot?.guardianStatus || guardianStatus,
      guardianOperationState: workerSnapshot?.guardianOperationState || operationState,
      workerSnapshot,
    };
  });

  const summary = tenants.reduce((acc, tenant) => {
    acc.totalTenants += 1;
    if (tenant.state === 'OK') acc.ok += 1;
    if (tenant.state === 'WATCH') acc.watch += 1;
    if (tenant.state === 'STALLED') acc.stalled += 1;
    if (tenant.state === 'BLOCKED') acc.blocked += 1;
    if (tenant.state === 'OFF_HOURS') acc.offHours += 1;
    return acc;
  }, { totalTenants: 0, ok: 0, watch: 0, stalled: 0, blocked: 0, offHours: 0 });

  return {
    generatedAt: nowIso,
    operatingWindow,
    summary,
    tenants: tenants.sort((a, b) => {
      const rank: Record<AiActivityState, number> = { BLOCKED: 0, STALLED: 1, WATCH: 2, OK: 3, OFF_HOURS: 4 };
      return rank[a.state] - rank[b.state] || a.tenantName.localeCompare(b.tenantName);
    }),
    evidenceErrors,
  };
}
