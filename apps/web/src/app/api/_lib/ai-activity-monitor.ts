type SupabaseLike = {
  from: (table: string) => any;
};

export type AiActivityState = 'OK' | 'WATCH' | 'STALLED' | 'BLOCKED' | 'OFF_HOURS';

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
  if (status === 'COLD' || status === 'HIGH_LOAD' || status === 'COOLDOWN') return 'THROTTLED';
  return status ? 'ACTIVE' : null;
}

function classifyTenantActivity(input: {
  tenantStatus: string | null;
  isOperatingWindow: boolean;
  guardianStatus: string | null;
  guardianOperationState: string | null;
  contactableBacklog: number;
  oldestContactableLeadAt: string | null;
  duePending: number;
  oldestDuePendingAt: string | null;
  unansweredConversations: number;
  oldestUnansweredInboundAt: string | null;
  outboundToday: number;
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
    return {
      state: 'BLOCKED',
      label: 'IA bloqueada pelo WhatsApp',
      severity: 'CRITICAL',
      summary: 'A IA nao deve enviar porque o Guardian marcou a conexao do WhatsApp como bloqueada ou exigindo acao.',
      requiredAction: 'Reconectar ou estabilizar o WhatsApp antes de esperar novos envios.',
    };
  }

  const dueAge = ageMinutes(input.oldestDuePendingAt, input.nowMs);
  if (input.duePending > 0 && (dueAge ?? 0) >= DUE_PENDING_STALLED_MINUTES) {
    return {
      state: 'STALLED',
      label: 'Fila vencida',
      severity: 'ATTENTION',
      summary: `${input.duePending} mensagem(ns) deveriam ter sido enviadas e ainda estao pendentes.`,
      requiredAction: 'Executar/checar send-messages e validar se Guardian, campanha ou WhatsApp estao bloqueando a fila.',
    };
  }

  const unansweredAge = ageMinutes(input.oldestUnansweredInboundAt, input.nowMs);
  if (input.unansweredConversations > 0 && (unansweredAge ?? 0) >= UNANSWERED_STALLED_MINUTES) {
    return {
      state: 'STALLED',
      label: 'Resposta atrasada',
      severity: 'ATTENTION',
      summary: `${input.unansweredConversations} conversa(s) receberam mensagem do lead e ainda nao tiveram resposta posterior da IA.`,
      requiredAction: 'Priorizar continuacao de conversa antes de novas prospeccoes.',
    };
  }

  if (input.isOperatingWindow && input.contactableBacklog > 0 && input.outboundToday === 0) {
    return {
      state: 'WATCH',
      label: 'Sem primeiro envio hoje',
      severity: 'OBSERVATION',
      summary: `${input.contactableBacklog} lead(s) enriquecidos estao aptos para primeiro contato, mas ainda nao houve envio da IA hoje.`,
      requiredAction: 'Acompanhar a proxima execucao do worker e verificar campanha ativa, horario e limites de cadencia.',
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

  let leadBacklogQuery = supabase
    .from('leads')
    .select('id, tenant_id, name, source, status, created_at, queued_first_touch_at, contacted_at')
    .eq('status', 'ENRICHED')
    .is('deleted_at', null)
    .is('contacted_at', null)
    .is('queued_first_touch_at', null)
    .not('whatsapp', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1000);
  leadBacklogQuery = tenantScope(leadBacklogQuery, tenantIds);
  let contactableLeads = await loadRows<Record<string, any>>('contactable_leads', leadBacklogQuery, evidenceErrors);

  if (evidenceErrors.some((error) => error.startsWith('contactable_leads:'))) {
    evidenceErrors.pop();
    let fallbackLeadQuery = supabase
      .from('leads')
      .select('id, tenant_id, name, source, status, created_at, contacted_at')
      .eq('status', 'ENRICHED')
      .is('deleted_at', null)
      .is('contacted_at', null)
      .not('whatsapp', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1000);
    fallbackLeadQuery = tenantScope(fallbackLeadQuery, tenantIds);
    contactableLeads = await loadRows<Record<string, any>>('contactable_leads_legacy', fallbackLeadQuery, evidenceErrors);
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

  const [
    leadsToday,
    pendingDue,
    conversations,
    outboundToday,
    inboundToday,
    guardianRows,
  ] = await Promise.all([
    loadRows<Record<string, any>>('leads_today', leadsTodayQuery, evidenceErrors),
    loadRows<Record<string, any>>('pending_due', pendingDueQuery, evidenceErrors),
    loadRows<Record<string, any>>('unanswered_conversations', conversationsQuery, evidenceErrors),
    loadRows<Record<string, any>>('outbound_today', outboundTodayQuery, evidenceErrors),
    loadRows<Record<string, any>>('inbound_today', inboundTodayQuery, evidenceErrors),
    loadGuardianRows(supabase, tenantIds, options.guardianStates, evidenceErrors),
  ]);

  const contactableByTenant = byTenant(contactableLeads);
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

  const tenants = tenantRows.map((tenant) => {
    const tenantId = String(tenant.id);
    const contactable = contactableByTenant.get(tenantId) || [];
    const due = pendingByTenant.get(tenantId) || [];
    const unanswered = unansweredByTenant.get(tenantId) || [];
    const outbounds = outboundByTenant.get(tenantId) || [];
    const inbounds = inboundByTenant.get(tenantId) || [];
    const guardian = guardianByTenant.get(tenantId);
    const operationState = guardianOperation(guardian);
    const guardianStatus = guardian?.status ? String(guardian.status) : null;
    const outboundLast60m = outbounds.filter((message) => String(message.created_at || '') >= last60m).length;
    const classified = classifyTenantActivity({
      tenantStatus: tenant.status ? String(tenant.status) : null,
      isOperatingWindow: operatingWindow.isOpen,
      guardianStatus,
      guardianOperationState: operationState,
      contactableBacklog: contactable.length,
      oldestContactableLeadAt: oldestAt(contactable, 'created_at'),
      duePending: due.length,
      oldestDuePendingAt: oldestAt(due, 'scheduled_for'),
      unansweredConversations: unanswered.length,
      oldestUnansweredInboundAt: oldestAt(unanswered, 'last_inbound_at'),
      outboundToday: outbounds.length,
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
      contactableBacklog: contactable.length,
      oldestContactableLeadAt: oldestAt(contactable, 'created_at'),
      duePending: due.length,
      oldestDuePendingAt: oldestAt(due, 'scheduled_for'),
      unansweredConversations: unanswered.length,
      oldestUnansweredInboundAt: oldestAt(unanswered, 'last_inbound_at'),
      outboundToday: outbounds.length,
      outboundLast60m,
      inboundToday: inbounds.length,
      lastOutboundAt: latestAt(outbounds, 'created_at'),
      lastInboundAt: latestAt(inbounds, 'created_at'),
      guardianStatus,
      guardianOperationState: operationState,
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
