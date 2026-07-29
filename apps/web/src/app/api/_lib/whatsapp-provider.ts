type SupabaseAdminLike = any;

export type WhatsAppProvider = 'EVOLUTION' | 'WAHA';

export type AppWhatsAppChannel = {
  id: string | null;
  provider: WhatsAppProvider;
  label: string | null;
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  webhookSecret: string | null;
  active: boolean;
  source: 'whatsapp_channels' | 'tenant_secrets';
  sendEnabled: boolean;
  receiveEnabled: boolean;
};

const DEFAULT_EVOLUTION_BASE_URL = 'https://evolution-evolution-api.qr4jgl.easypanel.host';
const DEFAULT_WAHA_BASE_URL = 'https://waha-waha.qr4jgl.easypanel.host';

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function normalizeBaseUrl(value: string | null | undefined): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeProvider(value: unknown): WhatsAppProvider {
  return String(value || '').toUpperCase() === 'WAHA' ? 'WAHA' : 'EVOLUTION';
}

function apiKeyForProvider(provider: WhatsAppProvider, rowKey?: string | null): string {
  if (rowKey && rowKey.trim()) return rowKey.trim();
  if (provider === 'WAHA') return env('WAHA_API_KEY') || '';
  return env('EVOLUTION_GUILDS_API_KEY') || env('EVOLUTION_API_KEY') || '';
}

export async function loadTenantWhatsAppChannel(
  supabaseAdmin: SupabaseAdminLike,
  tenantId: string,
): Promise<AppWhatsAppChannel | null> {
  const { data: channel, error: channelError } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('id, provider, label, base_url, instance_name, api_key_encrypted, webhook_secret, send_enabled, receive_enabled')
    .eq('owner_type', 'TENANT')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('send_enabled', { ascending: false })
    .order('receive_enabled', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!channelError && channel?.instance_name) {
    const provider = normalizeProvider(channel.provider);
    return {
      id: channel.id ?? null,
      provider,
      label: channel.label ?? null,
      baseUrl: normalizeBaseUrl(channel.base_url || (provider === 'WAHA' ? DEFAULT_WAHA_BASE_URL : DEFAULT_EVOLUTION_BASE_URL)),
      instanceName: channel.instance_name,
      apiKey: apiKeyForProvider(provider, channel.api_key_encrypted),
      webhookSecret: channel.webhook_secret || null,
      active: true,
      source: 'whatsapp_channels',
      sendEnabled: channel.send_enabled !== false,
      receiveEnabled: channel.receive_enabled !== false,
    };
  }

  const { data: legacy, error: legacyError } = await supabaseAdmin
    .from('tenant_secrets')
    .select('evolution_base_url, evolution_instance_name, evolution_api_key_encrypted')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (legacyError || !legacy?.evolution_instance_name) return null;

  return {
    id: null,
    provider: 'EVOLUTION',
    label: 'Evolution legado',
    baseUrl: normalizeBaseUrl(legacy.evolution_base_url || env('EVOLUTION_BASE_URL') || DEFAULT_EVOLUTION_BASE_URL),
    instanceName: legacy.evolution_instance_name,
    apiKey: apiKeyForProvider('EVOLUTION', legacy.evolution_api_key_encrypted),
    webhookSecret: null,
    active: true,
    source: 'tenant_secrets',
    sendEnabled: true,
    receiveEnabled: true,
  };
}

export async function loadTenantWahaChannel(
  supabaseAdmin: SupabaseAdminLike,
  tenantId: string,
): Promise<AppWhatsAppChannel | null> {
  const { data: channel, error } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('id, provider, label, base_url, instance_name, api_key_encrypted, webhook_secret, active, send_enabled, receive_enabled')
    .eq('owner_type', 'TENANT')
    .eq('tenant_id', tenantId)
    .eq('provider', 'WAHA')
    .order('active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !channel?.instance_name) return null;

  return {
    id: channel.id ?? null,
    provider: 'WAHA',
    label: channel.label ?? null,
    baseUrl: normalizeBaseUrl(channel.base_url || DEFAULT_WAHA_BASE_URL),
    instanceName: channel.instance_name,
    apiKey: apiKeyForProvider('WAHA', channel.api_key_encrypted),
    webhookSecret: channel.webhook_secret || null,
    active: channel.active === true,
    source: 'whatsapp_channels',
    sendEnabled: channel.send_enabled !== false,
    receiveEnabled: channel.receive_enabled !== false,
  };
}

export async function fetchWahaSession(channel: AppWhatsAppChannel): Promise<{
  ok: boolean;
  status: string | null;
  payload: any;
  httpStatus?: number;
}> {
  const response = await fetch(
    `${channel.baseUrl}/api/sessions/${encodeURIComponent(channel.instanceName)}`,
    {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': channel.apiKey,
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_err) {
    payload = { raw: text.slice(0, 500) };
  }

  return {
    ok: response.ok,
    status: String(payload?.status || '').toUpperCase() || null,
    payload,
    httpStatus: response.status,
  };
}

export function mapWahaStatusToAppStatus(status: string | null): {
  status: 'connected' | 'disconnected' | 'pending_qr';
  reason: string | null;
} {
  if (status === 'WORKING') return { status: 'connected', reason: null };
  if (status === 'SCAN_QR_CODE' || status === 'STARTING') {
    return { status: 'pending_qr', reason: 'qr_required' };
  }
  if (status === 'FAILED') return { status: 'disconnected', reason: 'waha_failed' };
  if (status === 'STOPPED') return { status: 'disconnected', reason: 'waha_stopped' };
  return { status: 'disconnected', reason: 'other' };
}

export function buildWahaWebhookUrl(): string {
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
  if (supabaseUrl) return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/webhook-waha`;
  const apiUrl = env('API_URL') || env('NEXT_PUBLIC_API_URL');
  if (apiUrl) return `${apiUrl.replace(/\/+$/, '')}/v1/webhooks/waha`;
  return '';
}

export async function createOrUpdateWahaSession(
  channel: AppWhatsAppChannel,
  webhookUrl: string,
): Promise<void> {
  const body = {
    name: channel.instanceName,
    config: {
      webhooks: webhookUrl
        ? [
          {
            url: webhookUrl,
            events: ['message', 'message.ack', 'session.status'],
            customHeaders: channel.webhookSecret
              ? [
                  {
                    name: 'X-Prospix-Webhook-Secret',
                    value: channel.webhookSecret,
                  },
                ]
              : [],
          },
        ]
        : [],
      ignore: {
        status: true,
        groups: true,
        channels: true,
      },
    },
  };

  const createResponse = await fetch(`${channel.baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': channel.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!createResponse.ok && createResponse.status !== 409) {
    const text = await createResponse.text().catch(() => '');
    throw new Error(`WAHA_CREATE_SESSION_${createResponse.status}:${text.slice(0, 240)}`);
  }

  if (createResponse.status === 409) {
    await fetch(`${channel.baseUrl}/api/sessions/${encodeURIComponent(channel.instanceName)}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': channel.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
  }

  await fetch(`${channel.baseUrl}/api/sessions/${encodeURIComponent(channel.instanceName)}/start`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': channel.apiKey,
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
}

export async function getWahaQrCode(channel: AppWhatsAppChannel): Promise<string | null> {
  const response = await fetch(
    `${channel.baseUrl}/api/${encodeURIComponent(channel.instanceName)}/auth/qr`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': channel.apiKey,
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`WAHA_QR_${response.status}:${text.slice(0, 240)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    return data?.data || data?.base64 || data?.qr || data?.qrcode || null;
  }

  const text = await response.text();
  return text || null;
}

export async function logoutWahaSession(channel: AppWhatsAppChannel): Promise<void> {
  const response = await fetch(
    `${channel.baseUrl}/api/sessions/${encodeURIComponent(channel.instanceName)}/logout`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': channel.apiKey,
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => '');
    throw new Error(`WAHA_LOGOUT_${response.status}:${text.slice(0, 240)}`);
  }
}
