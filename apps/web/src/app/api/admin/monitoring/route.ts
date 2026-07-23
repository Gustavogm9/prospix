import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../_lib/auth';
import { loadAiActivityMonitor } from '../../_lib/ai-activity-monitor';

const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const DEFAULT_ADMIN_CHANNEL_LABEL = 'Canal administrativo';
const DEFAULT_ADMIN_INSTANCE_NAME = 'prospix_admin_monitoring';
const ADMIN_CHANNEL_SELECT = [
  'id',
  'label',
  'evolution_base_url',
  'evolution_instance_name',
  'active',
  'connection_status',
  'external_state',
  'last_qr_requested_at',
  'connected_at',
  'disconnected_at',
  'last_checked_at',
  'last_error',
  'created_at',
  'updated_at',
].join(', ');

type AdminChannelRow = {
  id: string;
  label: string;
  evolution_base_url: string;
  evolution_instance_name: string;
  active: boolean;
  connection_status: 'UNKNOWN' | 'PENDING_QR' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  external_state: string | null;
  last_qr_requested_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type EvolutionCallResult = {
  ok: boolean;
  status: number;
  data: any;
  text: string;
};

function normalizeWhatsapp(value: unknown): string {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return `+${digits}`;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function sanitizeTenantIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value
    .map((id) => String(id || '').trim())
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizeBaseUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getDefaultEvolutionBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.ADMIN_REPORT_EVOLUTION_BASE_URL
      || process.env.EVOLUTION_BASE_URL
      || 'https://evolution-evolution-api.qr4jgl.easypanel.host',
  );
}

function getEvolutionApiKey(): string {
  return process.env.ADMIN_REPORT_EVOLUTION_API_KEY || process.env.EVOLUTION_GUILDS_API_KEY || '';
}

function normalizeInstanceName(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || DEFAULT_ADMIN_INSTANCE_NAME;
}

function redactEvolutionPayload(value: unknown): Record<string, unknown> {
  try {
    const text = JSON.stringify(value ?? {})
      .replace(/[A-Za-z0-9_=-]{40,}/g, '[REDACTED]')
      .replace(/55\d{10,13}/g, '[PHONE_REDACTED]')
      .slice(0, 1000);
    return { preview: text };
  } catch {
    return { preview: String(value ?? '').slice(0, 1000) };
  }
}

function extractQrCode(payload: any): string | null {
  const candidate = payload?.base64
    || payload?.qrcode?.base64
    || payload?.qrcode
    || payload?.qr
    || payload?.code
    || payload?.data?.base64
    || payload?.data?.qrcode?.base64
    || null;
  if (!candidate || typeof candidate !== 'string') return null;
  return candidate;
}

function normalizeEvolutionState(value: unknown): string | null {
  const state = String(value || '').trim();
  return state ? state : null;
}

function connectionStatusFromState(state: string | null): AdminChannelRow['connection_status'] {
  const normalized = String(state || '').toLowerCase();
  if (['open', 'connected', 'connect'].includes(normalized)) return 'CONNECTED';
  if (['connecting', 'qr', 'qrcode', 'pairing', 'pending'].includes(normalized)) return 'PENDING_QR';
  if (['close', 'closed', 'disconnected', 'logout', 'not_found'].includes(normalized)) return 'DISCONNECTED';
  return state ? 'DISCONNECTED' : 'UNKNOWN';
}

function connectionStatusFromInstance(instance: any): { status: AdminChannelRow['connection_status']; externalState: string | null } {
  const state = normalizeEvolutionState(
    instance?.connectionStatus
      || instance?.connectionState?.state
      || instance?.instance?.state
      || instance?.state
      || instance?.status,
  );
  return { status: connectionStatusFromState(state), externalState: state };
}

async function loadActiveChannel(): Promise<AdminChannelRow | null> {
  const { data, error } = await supabaseAdmin
    .from('admin_monitoring_channels')
    .select(ADMIN_CHANNEL_SELECT)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as AdminChannelRow | null;
}

function serializeChannel(channel: AdminChannelRow | null, dispatcherStatus?: Record<string, unknown>) {
  const apiKeyConfigured = Boolean(getEvolutionApiKey());
  const baseUrlConfigured = Boolean(channel?.evolution_base_url || getDefaultEvolutionBaseUrl());
  const mergedStatus = dispatcherStatus || {};
  const connectionStatus = String(
    mergedStatus.connectionStatus || channel?.connection_status || 'UNKNOWN',
  );

  return {
    configured: Boolean(channel && apiKeyConfigured && baseUrlConfigured),
    connected: connectionStatus === 'CONNECTED',
    channelId: channel?.id || null,
    label: channel?.label || null,
    source: channel ? 'admin_monitoring_channels' : 'NO_ACTIVE_ADMIN_MONITORING_CHANNEL',
    instanceName: channel?.evolution_instance_name || null,
    baseUrlConfigured,
    apiKeyConfigured,
    connectionStatus,
    externalState: (mergedStatus.externalState as string | null | undefined) ?? channel?.external_state ?? null,
    lastQrRequestedAt: (mergedStatus.lastQrRequestedAt as string | null | undefined) ?? channel?.last_qr_requested_at ?? null,
    connectedAt: (mergedStatus.connectedAt as string | null | undefined) ?? channel?.connected_at ?? null,
    disconnectedAt: (mergedStatus.disconnectedAt as string | null | undefined) ?? channel?.disconnected_at ?? null,
    lastCheckedAt: (mergedStatus.lastCheckedAt as string | null | undefined) ?? channel?.last_checked_at ?? null,
    lastError: (mergedStatus.lastError as string | null | undefined) ?? channel?.last_error ?? null,
    dispatcherReachable: mergedStatus.dispatcherReachable as boolean | undefined,
    dispatcherError: (mergedStatus.dispatcherError as string | null | undefined) ?? null,
    reason: channel ? null : 'NO_ACTIVE_ADMIN_MONITORING_CHANNEL',
  };
}

async function evolutionFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<EvolutionCallResult> {
  const extraHeaders = init.headers instanceof Headers
    ? Object.fromEntries(init.headers.entries())
    : Array.isArray(init.headers)
      ? Object.fromEntries(init.headers)
      : init.headers || {};

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(12_000),
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data, text };
}

function isInstanceAlreadyExists(result: EvolutionCallResult): boolean {
  const text = `${result.text} ${JSON.stringify(result.data || {})}`.toLowerCase();
  return result.status === 409 || (result.status === 400 && (text.includes('already') || text.includes('exist')));
}

function findEvolutionInstance(instances: any, instanceName: string): any | null {
  if (!Array.isArray(instances)) return null;
  return instances.find((instance: any) =>
    instance?.name === instanceName
    || instance?.instanceName === instanceName
    || instance?.instance?.instanceName === instanceName
    || instance?.instance?.name === instanceName
  ) || null;
}

async function insertChannelEvent(
  channelId: string,
  eventType: string,
  patch: {
    connectionStatus?: AdminChannelRow['connection_status'] | null;
    externalState?: string | null;
    error?: string | null;
    rawResponse?: unknown;
    createdById?: string | null;
  } = {},
) {
  await supabaseAdmin.from('admin_monitoring_channel_events').insert({
    channel_id: channelId,
    event_type: eventType,
    connection_status: patch.connectionStatus || null,
    external_state: patch.externalState || null,
    error: patch.error || null,
    raw_response_redacted: redactEvolutionPayload(patch.rawResponse || {}),
    created_by_id: patch.createdById || null,
  });
}

async function updateChannelStatus(
  channel: AdminChannelRow,
  status: AdminChannelRow['connection_status'],
  patch: {
    externalState?: string | null;
    lastError?: string | null;
    lastQrRequestedAt?: string | null;
    createdById?: string | null;
    eventType?: string;
    rawResponse?: unknown;
  } = {},
) {
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    connection_status: status,
    external_state: patch.externalState ?? null,
    last_checked_at: now,
    last_error: patch.lastError ?? null,
  };

  if (patch.lastQrRequestedAt) updatePayload.last_qr_requested_at = patch.lastQrRequestedAt;
  if (status === 'CONNECTED') updatePayload.connected_at = now;
  if (status === 'DISCONNECTED') updatePayload.disconnected_at = now;

  const { data, error } = await supabaseAdmin
    .from('admin_monitoring_channels')
    .update(updatePayload)
    .eq('id', channel.id)
    .select(ADMIN_CHANNEL_SELECT)
    .single();

  if (error) throw error;

  await insertChannelEvent(channel.id, patch.eventType || 'STATUS_SYNC', {
    connectionStatus: status,
    externalState: patch.externalState ?? null,
    error: patch.lastError ?? null,
    rawResponse: patch.rawResponse || {},
    createdById: patch.createdById || null,
  });

  return data as unknown as AdminChannelRow;
}

async function ensureActiveChannel(body: any, adminId: string): Promise<AdminChannelRow> {
  const active = await loadActiveChannel();
  const label = String(body.label || active?.label || DEFAULT_ADMIN_CHANNEL_LABEL).trim() || DEFAULT_ADMIN_CHANNEL_LABEL;
  const instanceName = normalizeInstanceName(body.instanceName || active?.evolution_instance_name || DEFAULT_ADMIN_INSTANCE_NAME);
  const baseUrl = normalizeBaseUrl(body.baseUrl || active?.evolution_base_url || getDefaultEvolutionBaseUrl());

  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error('EVOLUTION_BASE_URL_INVALID');
  }

  if (active) {
    const { data, error } = await supabaseAdmin
      .from('admin_monitoring_channels')
      .update({
        label,
        evolution_base_url: baseUrl,
        evolution_instance_name: instanceName,
        active: true,
        last_error: null,
      })
      .eq('id', active.id)
      .select(ADMIN_CHANNEL_SELECT)
      .single();

    if (error) throw error;
    return data as unknown as AdminChannelRow;
  }

  const deactivateRes = await supabaseAdmin
    .from('admin_monitoring_channels')
    .update({ active: false })
    .eq('active', true);
  if (deactivateRes.error) throw deactivateRes.error;

  const { data, error } = await supabaseAdmin
    .from('admin_monitoring_channels')
    .insert({
      label,
      evolution_base_url: baseUrl,
      evolution_instance_name: instanceName,
      active: true,
      connection_status: 'UNKNOWN',
      created_by_id: adminId,
    })
    .select(ADMIN_CHANNEL_SELECT)
    .single();

  if (error) throw error;
  return data as unknown as AdminChannelRow;
}

async function refreshChannelStatus(channel: AdminChannelRow, requestQr: boolean, adminId?: string) {
  const apiKey = getEvolutionApiKey();
  if (!apiKey) {
    const updated = await updateChannelStatus(channel, 'ERROR', {
      lastError: 'EVOLUTION_API_KEY_NOT_CONFIGURED',
      createdById: adminId || null,
      eventType: 'STATUS_SYNC_FAILED',
    });
    return { channel: updated, qrcode: null };
  }

  let status: AdminChannelRow['connection_status'] = 'UNKNOWN';
  let externalState: string | null = null;
  let rawResponse: unknown = {};
  let lastError: string | null = null;

  try {
    const instancesResult = await evolutionFetch(channel.evolution_base_url, apiKey, '/instance/fetchInstances');
    rawResponse = instancesResult.data || instancesResult.text;

    if (instancesResult.ok) {
      const instance = findEvolutionInstance(instancesResult.data, channel.evolution_instance_name);
      if (instance) {
        const parsed = connectionStatusFromInstance(instance);
        status = parsed.status;
        externalState = parsed.externalState;
      } else {
        status = 'DISCONNECTED';
        externalState = 'not_found';
      }
    } else {
      const fallbackResult = await evolutionFetch(
        channel.evolution_base_url,
        apiKey,
        `/instance/connectionState/${channel.evolution_instance_name}`,
      );
      rawResponse = fallbackResult.data || fallbackResult.text;
      if (!fallbackResult.ok) {
        status = 'ERROR';
        lastError = `Evolution HTTP ${fallbackResult.status}`;
      } else {
        const parsed = connectionStatusFromInstance(fallbackResult.data);
        status = parsed.status;
        externalState = parsed.externalState;
      }
    }
  } catch (err: unknown) {
    status = 'ERROR';
    lastError = err instanceof Error ? err.message.slice(0, 240) : 'EVOLUTION_STATUS_UNAVAILABLE';
  }

  let qrcode: string | null = null;
  let lastQrRequestedAt: string | null = null;

  if (requestQr && status !== 'CONNECTED' && apiKey) {
    const qrResult = await evolutionFetch(
      channel.evolution_base_url,
      apiKey,
      `/instance/connect/${channel.evolution_instance_name}`,
    );
    qrcode = extractQrCode(qrResult.data);
    lastQrRequestedAt = new Date().toISOString();
    rawResponse = qrResult.data || qrResult.text;
    status = qrcode ? 'PENDING_QR' : status;
    if (!qrResult.ok && !lastError) lastError = `Evolution QR HTTP ${qrResult.status}`;
  }

  const updated = await updateChannelStatus(channel, status, {
    externalState,
    lastError,
    lastQrRequestedAt,
    createdById: adminId || null,
    eventType: requestQr ? 'QR_REFRESH_REQUESTED' : 'STATUS_SYNC',
    rawResponse,
  });

  return { channel: updated, qrcode };
}

function errorResponse(message: string, status = 400, code = 'VALIDATION') {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

async function audit(adminId: string, action: string, targetType: string, targetId: string | null, payload: unknown) {
  await supabaseAdmin.from('audit_log').insert({
    user_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    payload,
  });
}

async function invokeDispatcher(payload: Record<string, unknown>) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_FUNCTIONS_NOT_CONFIGURED');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-monitoring-dispatcher`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ ...payload, source: 'admin-api' }),
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text.slice(0, 500) };
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Dispatcher HTTP ${response.status}`);
  }

  return data;
}

async function dispatcherChannelStatus(channel: AdminChannelRow | null) {
  try {
    const data = await invokeDispatcher({ mode: 'status' });
    return serializeChannel(channel, {
      ...(data.channel || {}),
      dispatcherReachable: true,
      dispatcherError: null,
    });
  } catch (err: any) {
    return serializeChannel(channel, {
      dispatcherReachable: false,
      dispatcherError: err?.message || 'Dispatcher status unavailable',
    });
  }
}

function guardianStateLabel(status: unknown): string {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  if (normalized === 'NORMAL') return 'Operacional';
  if (normalized === 'COLD') return 'Em observacao';
  if (normalized === 'RECOVERY') return 'Retomada segura';
  if (normalized === 'HIGH_LOAD') return 'Volume alto';
  if (normalized === 'COOLDOWN') return 'Em resfriamento';
  if (normalized === 'PAUSED') return 'Pausado';
  if (normalized === 'SUSPENDED') return 'Precisa de acao';
  if (normalized === 'UNKNOWN') return 'Sem status';
  return normalized.replaceAll('_', ' ');
}

function guardianOperationLabel(operation: string): string {
  if (operation === 'ACTIVE') return 'Operando normalmente';
  if (operation === 'THROTTLED') return 'Operando com cuidado';
  if (operation === 'BLOCKED') return 'Envios pausados';
  if (operation === 'REQUIRES_ACTION') return 'Precisa de acao';
  return operation.replaceAll('_', ' ');
}

function durationSince(value: unknown): number | null {
  if (!value) return null;
  const startedAt = new Date(String(value)).getTime();
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function isFuture(value: unknown): boolean {
  if (!value) return false;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function buildGuardianCurrentState(status: any, latestTransition: any | null, tenant: any) {
  if (!status) {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      status: 'UNKNOWN',
      label: guardianStateLabel('UNKNOWN'),
      impactLevel: 'ATTENTION',
      operationState: 'REQUIRES_ACTION',
      operationLabel: guardianOperationLabel('REQUIRES_ACTION'),
      externalState: null,
      reasonCode: 'STATUS_NOT_REGISTERED',
      stateSource: null,
      enteredAt: null,
      durationSeconds: null,
      allowSend: false,
      allowNewActive: false,
      summary: 'Ainda nao existe registro de saude do WhatsApp para este tenant. A operacao precisa de uma checagem do Guardian.',
      lastCheckedAt: null,
      updatedAt: null,
    };
  }

  const normalized = String(status.status || 'NORMAL').toUpperCase();
  const enteredAt = status.state_entered_at || latestTransition?.entered_at || status.updated_at || null;
  const reasonCode = status.state_reason_code || status.last_disconnect_reason_code || latestTransition?.reason_code || null;
  const quarantined = isFuture(status.quarantined_until);

  let impactLevel = 'INFO';
  let operationState = 'ACTIVE';
  let allowSend = true;
  let allowNewActive = true;
  let summary = 'WhatsApp operacional. A IA pode responder e iniciar conversas dentro das regras configuradas.';

  if (normalized === 'SUSPENDED') {
    impactLevel = 'CRITICAL';
    operationState = 'REQUIRES_ACTION';
    allowSend = false;
    allowNewActive = false;
    summary = 'WhatsApp desconectado ou sem autorizacao. A IA nao envia ate reconectar o numero.';
  } else if (normalized === 'PAUSED') {
    impactLevel = 'ATTENTION';
    operationState = 'BLOCKED';
    allowSend = false;
    allowNewActive = false;
    summary = 'Conexao instavel, fechada ou conectando. A IA pausa envios para evitar falhas.';
  } else if (normalized === 'COLD') {
    impactLevel = 'OBSERVATION';
    operationState = 'THROTTLED';
    allowSend = true;
    allowNewActive = !quarantined;
    summary = quarantined
      ? 'WhatsApp conectado em observacao. Respostas podem seguir, mas novas prospeccoes aguardam o fim da quarentena.'
      : 'WhatsApp conectado em observacao. A IA opera com ritmo reduzido para proteger o numero.';
  } else if (normalized === 'RECOVERY') {
    impactLevel = 'OBSERVATION';
    operationState = 'THROTTLED';
    allowSend = true;
    allowNewActive = true;
    summary = 'Retomada segura apos reconexao. A IA realinha a fila, retenta apenas contatos recuperaveis e envia em ritmo controlado.';
  } else if (normalized === 'HIGH_LOAD') {
    impactLevel = 'OBSERVATION';
    operationState = 'THROTTLED';
    allowSend = true;
    allowNewActive = false;
    summary = 'Volume alto. A IA prioriza respostas e reduz novas prospeccoes ate a carga normalizar.';
  } else if (normalized === 'COOLDOWN') {
    impactLevel = 'ATTENTION';
    operationState = 'THROTTLED';
    allowSend = true;
    allowNewActive = false;
    summary = 'Numero em resfriamento operacional. A IA envia com intervalo maior e nao inicia novas prospeccoes.';
  }

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    status: normalized,
    label: guardianStateLabel(normalized),
    impactLevel,
    operationState,
    operationLabel: guardianOperationLabel(operationState),
    externalState: status.external_state || null,
    reasonCode,
    stateSource: status.state_source || null,
    enteredAt,
    durationSeconds: durationSince(enteredAt),
    allowSend,
    allowNewActive,
    summary,
    lastCheckedAt: status.external_checked_at || null,
    updatedAt: status.updated_at || null,
  };
}

function sortGuardianStates(states: any[]) {
  const rank: Record<string, number> = {
    CRITICAL: 0,
    ATTENTION: 1,
    OBSERVATION: 2,
    INFO: 3,
  };
  return states.sort((a, b) =>
    (rank[a.impactLevel] ?? 9) - (rank[b.impactLevel] ?? 9)
    || String(a.tenantName || '').localeCompare(String(b.tenantName || '')),
  );
}

async function loadGuardianStates(tenants: any[]) {
  let statusResult = await supabaseAdmin
    .from('whatsapp_guardian_status')
    .select('tenant_id, status, external_state, external_checked_at, last_disconnect_reason_code, quarantined_until, circuit_open_until, last_global_send_at, state_entered_at, state_reason_code, state_source, updated_at');
  let schemaVersion = 'v2';

  if (statusResult.error) {
    schemaVersion = 'legacy';
    statusResult = await supabaseAdmin
      .from('whatsapp_guardian_status')
      .select('tenant_id, status, external_state, external_checked_at, last_disconnect_reason_code, quarantined_until, circuit_open_until, last_global_send_at, updated_at');
  }

  if (statusResult.error) {
    return {
      available: false,
      schemaVersion,
      statusError: statusResult.error.message,
      transitionLogAvailable: false,
      transitionLogError: null,
      current: [],
      recentTransitions: [],
    };
  }

  const transitionResult = await supabaseAdmin
    .from('whatsapp_guardian_state_transitions')
    .select('tenant_id, previous_status, status, external_state, reason_code, impact_level, operation_state, operator_summary, allow_send, allow_new_active, entered_at, exited_at, duration_seconds')
    .order('entered_at', { ascending: false })
    .limit(30);

  const transitionRows = transitionResult.error ? [] : (transitionResult.data || []);
  const latestTransitionByTenant = new Map<string, any>();
  for (const transition of transitionRows) {
    if (!latestTransitionByTenant.has(transition.tenant_id)) {
      latestTransitionByTenant.set(transition.tenant_id, transition);
    }
  }

  const tenantById = new Map((tenants || []).map((tenant: any) => [tenant.id, tenant]));
  const statusByTenant = new Map((statusResult.data || []).map((status: any) => [status.tenant_id, status]));
  const current = sortGuardianStates((tenants || []).map((tenant: any) =>
    buildGuardianCurrentState(statusByTenant.get(tenant.id) || null, latestTransitionByTenant.get(tenant.id) || null, tenant),
  ));

  return {
    available: true,
    schemaVersion,
    statusError: null,
    transitionLogAvailable: !transitionResult.error,
    transitionLogError: transitionResult.error?.message || null,
    current,
    recentTransitions: transitionRows.map((transition: any) => {
      const tenant = tenantById.get(transition.tenant_id);
      return {
        tenantId: transition.tenant_id,
        tenantName: tenant?.name || transition.tenant_id,
        previousStatus: transition.previous_status || null,
        status: transition.status,
        externalState: transition.external_state || null,
        reasonCode: transition.reason_code || null,
        impactLevel: transition.impact_level || null,
        operationState: transition.operation_state || null,
        operationLabel: guardianOperationLabel(String(transition.operation_state || '')),
        operatorSummary: transition.operator_summary || null,
        allowSend: transition.allow_send ?? null,
        allowNewActive: transition.allow_new_active ?? null,
        enteredAt: transition.entered_at,
        exitedAt: transition.exited_at || null,
        durationSeconds: transition.duration_seconds ?? null,
      };
    }),
  };
}

async function loadAiActivityAlertDeliveries() {
  const result = await supabaseAdmin
    .from('admin_ai_activity_alert_deliveries')
    .select('id, operational_alert_id, tenant_id, recipient_id, channel_id, incident_key, status, activity_state, severity, ai_summary, error, created_at, sent_at, tenants(id, name, slug), admin_monitoring_recipients(id, label, whatsapp)')
    .order('created_at', { ascending: false })
    .limit(25);

  if (result.error) {
    return {
      available: false,
      error: result.error.message,
      rows: [],
    };
  }

  return {
    available: true,
    error: null,
    rows: result.data || [],
  };
}

function mapWorkerDueQueueDiagnostic(row: any) {
  return {
    pendingOutboundId: row.pending_outbound_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name || row.tenant_id,
    tenantSlug: row.tenant_slug || '',
    conversationId: row.conversation_id || null,
    leadId: row.lead_id || null,
    leadName: row.lead_name || null,
    leadSource: row.lead_source || null,
    leadStatus: row.lead_status || null,
    campaignName: row.campaign_name || null,
    campaignStatus: row.campaign_status || null,
    messageType: row.message_type || null,
    scheduledFor: row.scheduled_for,
    dueAgeSeconds: row.due_age_seconds == null ? null : Number(row.due_age_seconds),
    attempts: Number(row.attempts ?? 0),
    validationStatus: row.validation_status || null,
    validationReasonCode: row.validation_reason_code || null,
    finalGuardianDecision: row.final_guardian_decision || null,
    conversationStatus: row.conversation_status || null,
    aiHandling: row.ai_handling ?? null,
    guardianStatus: row.guardian_status || null,
    guardianExternalState: row.guardian_external_state || null,
    guardianReasonCode: row.guardian_reason_code || null,
    blockingReason: row.blocking_reason,
    blockerKind: row.blocker_kind,
    blocksSend: Boolean(row.blocks_send),
    operatorSummary: row.operator_summary,
    recommendedAction: row.recommended_action,
  };
}

async function loadWorkerDueQueueDiagnostics() {
  const result = await supabaseAdmin
    .from('ai_worker_due_queue_diagnostics')
    .select('*')
    .order('scheduled_for', { ascending: true })
    .limit(25);

  if (result.error) {
    return {
      available: false,
      error: result.error.message,
      rows: [],
    };
  }

  return {
    available: true,
    error: null,
    rows: (result.data || []).map(mapWorkerDueQueueDiagnostic),
  };
}

function numericMetric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function mapWebhookProcessingFailure(row: any) {
  return {
    id: row.id,
    eventName: row.event_name || null,
    instanceName: row.instance_name || null,
    whatsappMessageIdHash: row.whatsapp_message_id_hash || null,
    remoteJidHash: row.remote_jid_hash || null,
    fromMe: row.from_me ?? null,
    tenantId: row.tenant_id || null,
    tenantName: row.tenant_name || 'Conta nao identificada',
    leadId: row.lead_id || null,
    conversationId: row.conversation_id || null,
    messageId: row.message_id || null,
    status: row.status || 'UNKNOWN',
    skipReason: row.skip_reason || null,
    errorMessage: row.error_message || null,
    attempts: numericMetric(row.attempts),
    acceptedAt: row.accepted_at || null,
    processingStartedAt: row.processing_started_at || null,
    processedAt: row.processed_at || null,
    failedAt: row.failed_at || null,
    lastSeenAt: row.last_seen_at || null,
    updatedAt: row.updated_at || null,
    processingAgeSeconds: row.processing_age_seconds == null ? null : numericMetric(row.processing_age_seconds),
    operatorSummary: row.operator_summary || null,
    recommendedAction: row.recommended_action || null,
  };
}

async function loadWebhookProcessingDiagnostics() {
  const [healthResult, failureResult] = await Promise.all([
    supabaseAdmin
      .from('evolution_webhook_operational_health')
      .select('*')
      .maybeSingle(),
    supabaseAdmin
      .from('evolution_webhook_operational_failures')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(25),
  ]);

  if (healthResult.error || failureResult.error) {
    return {
      available: false,
      error: healthResult.error?.message || failureResult.error?.message || 'Diagnostico de entrada indisponivel.',
      health: null,
      rows: [],
    };
  }

  const health = healthResult.data || {};
  return {
    available: true,
    error: null,
    health: {
      total24h: numericMetric(health.total_24h),
      processed24h: numericMetric(health.processed_24h),
      skipped24h: numericMetric(health.skipped_24h),
      failed24h: numericMetric(health.failed_24h),
      staleProcessing: numericMetric(health.stale_processing),
      duplicateAttempts24h: numericMetric(health.duplicate_attempts_24h),
      failedOrStale24h: numericMetric(health.failed_or_stale_24h),
      latestEventAt: health.latest_event_at || null,
      latestFailedAt: health.latest_failed_at || null,
      generatedAt: health.generated_at || null,
    },
    rows: (failureResult.data || []).map(mapWebhookProcessingFailure),
  };
}

async function loadDashboard() {
  const activeChannel = await loadActiveChannel();
  const [
    channel,
    channelEventsRes,
    dispatcherRunsRes,
    recipientsRes,
    schedulesRes,
    runsRes,
    deliveriesRes,
    tenantsRes,
  ] = await Promise.all([
    dispatcherChannelStatus(activeChannel),
    activeChannel
      ? supabaseAdmin
        .from('admin_monitoring_channel_events')
        .select('id, channel_id, event_type, connection_status, external_state, error, raw_response_redacted, created_at')
        .eq('channel_id', activeChannel.id)
        .order('created_at', { ascending: false })
        .limit(10)
      : supabaseAdmin
        .from('admin_monitoring_channel_events')
        .select('id, channel_id, event_type, connection_status, external_state, error, raw_response_redacted, created_at')
        .order('created_at', { ascending: false })
        .limit(10),
    supabaseAdmin
      .from('admin_monitoring_dispatcher_runs')
      .select('id, mode, source, status, claimed_count, sent_count, failed_count, skipped_count, error, started_at, completed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('admin_monitoring_recipients')
      .select('*')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('admin_monitoring_schedules')
      .select('*, admin_monitoring_recipients(id, label, whatsapp, active)')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('admin_monitoring_report_runs')
      .select('id, schedule_id, recipient_id, channel_id, status, period_start, period_end, metrics, ai_summary, error, started_at, completed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('admin_disconnect_alert_deliveries')
      .select('id, connection_event_id, operational_alert_id, tenant_id, recipient_id, channel_id, incident_key, status, reason_code, external_state, ai_summary, error, created_at, sent_at, tenants(id, name, slug), admin_monitoring_recipients(id, label, whatsapp)')
      .order('created_at', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('tenants')
      .select('id, name, slug, status')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ]);

  for (const result of [channelEventsRes, dispatcherRunsRes, recipientsRes, schedulesRes, runsRes, deliveriesRes, tenantsRes]) {
    if (result.error) throw result.error;
  }

  const recipients = recipientsRes.data || [];
  const schedules = schedulesRes.data || [];
  const runs = runsRes.data || [];
  const deliveries = deliveriesRes.data || [];
  const dispatcherRuns = dispatcherRunsRes.data || [];
  const tenants = tenantsRes.data || [];
  const guardianStates = await loadGuardianStates(tenants);
  const aiActivity = await loadAiActivityMonitor(supabaseAdmin, {
    tenants,
    guardianStates: guardianStates.current,
  });
  const aiActivityAlertDeliveries = await loadAiActivityAlertDeliveries();
  const workerDueQueueDiagnostics = await loadWorkerDueQueueDiagnostics();
  const webhookProcessing = await loadWebhookProcessingDiagnostics();
  const nowMs = Date.now();
  const activeSchedules = schedules.filter((s: any) => s.active);
  const overdueSchedules = activeSchedules.filter((s: any) => {
    const nextRunAt = new Date(s.next_run_at).getTime();
    return Number.isFinite(nextRunAt) && nextRunAt <= nowMs;
  }).length;
  const nextDueAt = activeSchedules
    .map((s: any) => s.next_run_at)
    .filter(Boolean)
    .sort((a: string, b: string) => a.localeCompare(b))[0] || null;
  const lastDispatcherRun: any = dispatcherRuns[0] || null;

  return {
    ok: true,
    channel,
    channelEvents: channelEventsRes.data || [],
    scheduler: {
      lastRunAt: lastDispatcherRun?.started_at || null,
      lastCompletedAt: lastDispatcherRun?.completed_at || null,
      lastStatus: lastDispatcherRun?.status || null,
      lastSource: lastDispatcherRun?.source || null,
      lastError: lastDispatcherRun?.error || null,
      lastClaimedCount: lastDispatcherRun?.claimed_count ?? null,
      lastSentCount: lastDispatcherRun?.sent_count ?? null,
      lastFailedCount: lastDispatcherRun?.failed_count ?? null,
      overdueSchedules,
      nextDueAt,
    },
    summary: {
      recipients: recipients.length,
      activeRecipients: recipients.filter((r: any) => r.active).length,
      activeSchedules: activeSchedules.length,
      overdueSchedules,
      failedReports24h: runs.filter((r: any) => r.status === 'FAILED').length,
      disconnectAlerts24h: deliveries.length,
      guardianAttentionStates: guardianStates.current.filter((state: any) => state.impactLevel !== 'INFO').length,
      aiActivityIssues: aiActivity.summary.blocked + aiActivity.summary.stalled + aiActivity.summary.watch,
      aiActivityAlerts24h: aiActivityAlertDeliveries.rows.length,
      dueQueueItems: workerDueQueueDiagnostics.rows.length,
      webhookProcessingFailures24h: webhookProcessing.health?.failed24h ?? 0,
      webhookProcessingStale: webhookProcessing.health?.staleProcessing ?? 0,
      webhookProcessingDuplicates24h: webhookProcessing.health?.duplicateAttempts24h ?? 0,
      webhookProcessingIssues: webhookProcessing.health?.failedOrStale24h ?? 0,
    },
    recipients,
    schedules,
    reportRuns: runs,
    disconnectDeliveries: deliveries,
    dispatcherRuns,
    tenants,
    guardianStates,
    aiActivity,
    aiActivityAlertDeliveries,
    workerDueQueueDiagnostics,
    webhookProcessing,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json(await loadDashboard());
  } catch (err) {
    console.error('admin/monitoring GET failed', err);
    return errorResponse('Falha ao carregar monitoramento administrativo.', 500, 'INTERNAL');
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('JSON invalido.', 400);
  }

  try {
    if (body.action === 'connect_channel') {
      const apiKey = getEvolutionApiKey();
      if (!apiKey) return errorResponse('Chave da Evolution API nao configurada para o canal administrativo.', 500, 'EVOLUTION_API_KEY_MISSING');

      const channel = await ensureActiveChannel(body, auth.adminId);

      const createResult = await evolutionFetch(channel.evolution_base_url, apiKey, '/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName: channel.evolution_instance_name,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
        }),
      });

      if (!createResult.ok && !isInstanceAlreadyExists(createResult)) {
        const updated = await updateChannelStatus(channel, 'ERROR', {
          lastError: `Evolution create HTTP ${createResult.status}`,
          createdById: auth.adminId,
          eventType: 'CONNECT_CREATE_FAILED',
          rawResponse: createResult.data || createResult.text,
        });
        await audit(auth.adminId, 'admin_monitoring.channel.connect_failed', 'admin_monitoring_channel', channel.id, {
          status: createResult.status,
        });
        return NextResponse.json({ ok: false, message: 'Evolution recusou a criacao da instancia administrativa.', channel: serializeChannel(updated) }, { status: 502 });
      }

      const webhookUrl = `${process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || ''}/v1/webhooks/evolution`;
      let webhookResult: EvolutionCallResult | null = null;
      if (webhookUrl.startsWith('http')) {
        webhookResult = await evolutionFetch(channel.evolution_base_url, apiKey, `/webhook/set/${channel.evolution_instance_name}`, {
          method: 'POST',
          body: JSON.stringify({
            url: webhookUrl,
            webhook_by_events: false,
            webhook_base64: false,
            events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED'],
          }),
        });
      }

      const qrResult = await evolutionFetch(channel.evolution_base_url, apiKey, `/instance/connect/${channel.evolution_instance_name}`);
      const qrcode = extractQrCode(qrResult.data);
      const status: AdminChannelRow['connection_status'] = qrcode ? 'PENDING_QR' : 'UNKNOWN';
      const now = new Date().toISOString();
      const updated = await updateChannelStatus(channel, qrResult.ok ? status : 'ERROR', {
        lastQrRequestedAt: now,
        lastError: qrResult.ok ? null : `Evolution QR HTTP ${qrResult.status}`,
        createdById: auth.adminId,
        eventType: 'CONNECT_QR_REQUESTED',
        rawResponse: {
          create: { ok: createResult.ok, status: createResult.status, alreadyExists: isInstanceAlreadyExists(createResult) },
          webhook: webhookResult ? { ok: webhookResult.ok, status: webhookResult.status } : { skipped: true },
          qr: qrResult.data || qrResult.text,
        },
      });

      await audit(auth.adminId, 'admin_monitoring.channel.connect', 'admin_monitoring_channel', updated.id, {
        instanceName: updated.evolution_instance_name,
        hasQrCode: Boolean(qrcode),
        webhookConfigured: Boolean(webhookResult?.ok),
      });

      return NextResponse.json({
        ok: true,
        channel: serializeChannel(updated),
        qrcode,
      });
    }

    if (body.action === 'refresh_channel') {
      const channel = await loadActiveChannel();
      if (!channel) return errorResponse('Nenhum canal administrativo ativo cadastrado.', 404, 'CHANNEL_NOT_FOUND');

      const result = await refreshChannelStatus(channel, asBoolean(body.requestQr, false), auth.adminId);
      await audit(auth.adminId, 'admin_monitoring.channel.refresh', 'admin_monitoring_channel', channel.id, {
        requestQr: asBoolean(body.requestQr, false),
        status: result.channel.connection_status,
      });

      return NextResponse.json({
        ok: true,
        channel: serializeChannel(result.channel),
        qrcode: result.qrcode,
      });
    }

    if (body.action === 'disconnect_channel') {
      const channel = await loadActiveChannel();
      if (!channel) return errorResponse('Nenhum canal administrativo ativo cadastrado.', 404, 'CHANNEL_NOT_FOUND');

      const apiKey = getEvolutionApiKey();
      if (!apiKey) return errorResponse('Chave da Evolution API nao configurada para desconectar o canal.', 500, 'EVOLUTION_API_KEY_MISSING');

      const logoutResult = await evolutionFetch(channel.evolution_base_url, apiKey, `/instance/logout/${channel.evolution_instance_name}`, {
        method: 'DELETE',
      });
      const deleteResult = await evolutionFetch(channel.evolution_base_url, apiKey, `/instance/delete/${channel.evolution_instance_name}`, {
        method: 'DELETE',
      });

      const errors = [
        logoutResult.ok ? null : `logout HTTP ${logoutResult.status}`,
        deleteResult.ok ? null : `delete HTTP ${deleteResult.status}`,
      ].filter(Boolean);

      const updated = await updateChannelStatus(channel, errors.length ? 'ERROR' : 'DISCONNECTED', {
        externalState: errors.length ? 'disconnect_failed' : 'manual_disconnect',
        lastError: errors.length ? errors.join(' | ') : null,
        createdById: auth.adminId,
        eventType: 'DISCONNECT_REQUESTED',
        rawResponse: {
          logout: { ok: logoutResult.ok, status: logoutResult.status },
          delete: { ok: deleteResult.ok, status: deleteResult.status },
        },
      });

      await audit(auth.adminId, 'admin_monitoring.channel.disconnect', 'admin_monitoring_channel', channel.id, {
        status: updated.connection_status,
        errors,
      });

      return NextResponse.json({
        ok: errors.length === 0,
        channel: serializeChannel(updated),
        message: errors.length ? 'Evolution retornou erro ao desconectar a instancia administrativa.' : 'Canal administrativo desconectado.',
      }, { status: errors.length ? 502 : 200 });
    }

    if (body.action === 'create_recipient') {
      const label = String(body.label || '').trim();
      const whatsapp = normalizeWhatsapp(body.whatsapp);
      if (label.length < 2) return errorResponse('Nome do destinatario e obrigatorio.');
      if (!E164_RE.test(whatsapp)) return errorResponse('WhatsApp deve estar em E.164. Exemplo: +5517999999999.');

      const { data, error } = await supabaseAdmin
        .from('admin_monitoring_recipients')
        .insert({
          label,
          whatsapp,
          active: asBoolean(body.active, true),
          report_enabled: asBoolean(body.reportEnabled, true),
          disconnect_alerts_enabled: asBoolean(body.disconnectAlertsEnabled, true),
          notes: String(body.notes || '').trim() || null,
          created_by_id: auth.adminId,
        })
        .select('*')
        .single();

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.recipient.create', 'admin_monitoring_recipient', data.id, { label, whatsapp });
      return NextResponse.json({ ok: true, recipient: data }, { status: 201 });
    }

    if (body.action === 'create_schedule') {
      const name = String(body.name || '').trim();
      const recipientId = String(body.recipientId || '').trim();
      const intervalMinutes = asInteger(body.intervalMinutes, 60);
      const windowMinutes = asInteger(body.windowMinutes, 60);
      if (name.length < 3) return errorResponse('Nome da agenda e obrigatorio.');
      if (!recipientId) return errorResponse('Destinatario e obrigatorio.');
      if (intervalMinutes < 5 || intervalMinutes > 1440) return errorResponse('Intervalo deve ficar entre 5 e 1440 minutos.');
      if (windowMinutes < 5 || windowMinutes > 10080) return errorResponse('Janela deve ficar entre 5 e 10080 minutos.');

      const { data, error } = await supabaseAdmin
        .from('admin_monitoring_schedules')
        .insert({
          name,
          recipient_id: recipientId,
          active: asBoolean(body.active, true),
          interval_minutes: intervalMinutes,
          window_minutes: windowMinutes,
          timezone: 'America/Sao_Paulo',
          tenant_ids: sanitizeTenantIds(body.tenantIds),
          include_numbers: asBoolean(body.includeNumbers, true),
          include_recent_messages: asBoolean(body.includeRecentMessages, true),
          next_run_at: new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString(),
          created_by_id: auth.adminId,
        })
        .select('*')
        .single();

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.schedule.create', 'admin_monitoring_schedule', data.id, {
        name,
        recipientId,
        intervalMinutes,
        windowMinutes,
      });
      return NextResponse.json({ ok: true, schedule: data }, { status: 201 });
    }

    if (body.action === 'send_test') {
      const recipientId = String(body.recipientId || '').trim();
      if (!recipientId) return errorResponse('Destinatario e obrigatorio.');
      const result = await invokeDispatcher({ mode: 'recipient_test', recipient_id: recipientId });
      await audit(auth.adminId, 'admin_monitoring.recipient.test', 'admin_monitoring_recipient', recipientId, result);
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === 'run_schedule_now') {
      const scheduleId = String(body.scheduleId || '').trim();
      if (!scheduleId) return errorResponse('Agenda e obrigatoria.');
      const result = await invokeDispatcher({ mode: 'schedule', schedule_id: scheduleId });
      await audit(auth.adminId, 'admin_monitoring.schedule.run_now', 'admin_monitoring_schedule', scheduleId, result);
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === 'webhook_reprocess') {
      const processingEventId = String(body.processingEventId || body.processing_event_id || '').trim();
      const reason = String(body.reason || '').trim();
      const dryRun = asBoolean(body.dryRun, true);
      if (!isUuid(processingEventId)) return errorResponse('Evento de entrada invalido.', 400, 'INVALID_WEBHOOK_EVENT_ID');
      if (reason.length < 10) return errorResponse('Informe um motivo com pelo menos 10 caracteres.', 400, 'REPROCESS_REASON_REQUIRED');

      const result = await invokeDispatcher({
        mode: 'webhook_reprocess',
        processing_event_id: processingEventId,
        requested_by_id: auth.adminId,
        dry_run: dryRun,
        reason,
      });
      const dispatcherResult = result?.result || result;

      await audit(
        auth.adminId,
        dryRun ? 'admin_monitoring.webhook_reprocess.dry_run' : 'admin_monitoring.webhook_reprocess.execute',
        'evolution_webhook_processing_event',
        processingEventId,
        {
          dryRun,
          reason,
          dispatcherResult,
        },
      );

      if (!dryRun && dispatcherResult?.ok !== true) {
        return errorResponse(
          dispatcherResult?.error || dispatcherResult?.reason || 'Reprocessamento nao aceito pelo dispatcher.',
          409,
          'WEBHOOK_REPROCESS_FAILED',
        );
      }

      return NextResponse.json({ ok: true, result: dispatcherResult });
    }

    return errorResponse('Acao POST desconhecida.');
  } catch (err: any) {
    console.error('admin/monitoring POST failed', err);
    return errorResponse(err?.message || 'Falha ao processar acao.', 500, 'INTERNAL');
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('JSON invalido.', 400);
  }

  try {
    if (body.type === 'recipient') {
      const id = String(body.id || '').trim();
      if (!id) return errorResponse('ID do destinatario e obrigatorio.');

      const patch: Record<string, unknown> = {};
      if (body.label !== undefined) patch.label = String(body.label || '').trim();
      if (body.whatsapp !== undefined) {
        const whatsapp = normalizeWhatsapp(body.whatsapp);
        if (!E164_RE.test(whatsapp)) return errorResponse('WhatsApp deve estar em E.164. Exemplo: +5517999999999.');
        patch.whatsapp = whatsapp;
      }
      if (body.active !== undefined) patch.active = asBoolean(body.active, true);
      if (body.reportEnabled !== undefined) patch.report_enabled = asBoolean(body.reportEnabled, true);
      if (body.disconnectAlertsEnabled !== undefined) patch.disconnect_alerts_enabled = asBoolean(body.disconnectAlertsEnabled, true);
      if (body.notes !== undefined) patch.notes = String(body.notes || '').trim() || null;

      const { error } = await supabaseAdmin
        .from('admin_monitoring_recipients')
        .update(patch)
        .eq('id', id);

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.recipient.update', 'admin_monitoring_recipient', id, patch);
      return NextResponse.json({ ok: true });
    }

    if (body.type === 'schedule') {
      const id = String(body.id || '').trim();
      if (!id) return errorResponse('ID da agenda e obrigatorio.');

      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name || '').trim();
      if (body.recipientId !== undefined) patch.recipient_id = String(body.recipientId || '').trim();
      if (body.active !== undefined) patch.active = asBoolean(body.active, true);
      if (body.intervalMinutes !== undefined) {
        const intervalMinutes = asInteger(body.intervalMinutes, 60);
        if (intervalMinutes < 5 || intervalMinutes > 1440) return errorResponse('Intervalo deve ficar entre 5 e 1440 minutos.');
        patch.interval_minutes = intervalMinutes;
      }
      if (body.windowMinutes !== undefined) {
        const windowMinutes = asInteger(body.windowMinutes, 60);
        if (windowMinutes < 5 || windowMinutes > 10080) return errorResponse('Janela deve ficar entre 5 e 10080 minutos.');
        patch.window_minutes = windowMinutes;
      }
      if (body.tenantIds !== undefined) patch.tenant_ids = sanitizeTenantIds(body.tenantIds);
      if (body.includeNumbers !== undefined) patch.include_numbers = asBoolean(body.includeNumbers, true);
      if (body.includeRecentMessages !== undefined) patch.include_recent_messages = asBoolean(body.includeRecentMessages, true);

      const { error } = await supabaseAdmin
        .from('admin_monitoring_schedules')
        .update(patch)
        .eq('id', id);

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.schedule.update', 'admin_monitoring_schedule', id, patch);
      return NextResponse.json({ ok: true });
    }

    return errorResponse('Tipo PATCH desconhecido.');
  } catch (err: any) {
    console.error('admin/monitoring PATCH failed', err);
    return errorResponse(err?.message || 'Falha ao atualizar.', 500, 'INTERNAL');
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const id = searchParams.get('id');
  if (!id) return errorResponse('ID obrigatorio.');

  try {
    if (type === 'recipient') {
      const { error } = await supabaseAdmin.from('admin_monitoring_recipients').delete().eq('id', id);
      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.recipient.delete', 'admin_monitoring_recipient', id, {});
      return NextResponse.json({ ok: true });
    }

    if (type === 'schedule') {
      const { error } = await supabaseAdmin.from('admin_monitoring_schedules').delete().eq('id', id);
      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.schedule.delete', 'admin_monitoring_schedule', id, {});
      return NextResponse.json({ ok: true });
    }

    return errorResponse('Tipo DELETE desconhecido.');
  } catch (err: any) {
    console.error('admin/monitoring DELETE failed', err);
    return errorResponse(err?.message || 'Falha ao excluir.', 500, 'INTERNAL');
  }
}
