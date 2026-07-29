type SupabaseLike = any;

export type WhatsAppProvider = 'EVOLUTION' | 'WAHA';

export type WhatsAppChannel = {
  id: string | null;
  provider: WhatsAppProvider;
  label: string | null;
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  source: 'whatsapp_channels' | 'tenant_secrets' | 'admin_monitoring_channels';
  sendEnabled: boolean;
  receiveEnabled: boolean;
  connectionStatus?: string | null;
  externalState?: string | null;
};

export type ExternalConnectionStatus = {
  ok: boolean;
  state: string | null;
  reasonCode: string | null;
  critical: boolean;
  rawError: string | null;
  reachoutTimelock?: {
    active: boolean;
    raw: unknown;
  } | null;
};

export type SendWhatsAppResult = {
  ok: boolean;
  provider: WhatsAppProvider;
  channelId: string | null;
  whatsappMsgId?: string | null;
  error?: string | null;
};

type FetchOptions = {
  timeoutMs?: number;
};

const DEFAULT_EVOLUTION_BASE_URL = 'https://evolution-evolution-api.qr4jgl.easypanel.host';
const DEFAULT_WAHA_BASE_URL = 'https://waha-waha.qr4jgl.easypanel.host';

function env(name: string): string | null {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : null;
}

function normalizeBaseUrl(value: string | null | undefined): string {
  const cleaned = String(value || '').trim().replace(/\/+$/, '');
  return cleaned;
}

function normalizeProvider(value: unknown): WhatsAppProvider {
  return String(value || '').toUpperCase() === 'WAHA' ? 'WAHA' : 'EVOLUTION';
}

function apiKeyForProvider(provider: WhatsAppProvider, rowKey?: string | null): string {
  const direct = rowKey && rowKey.trim() ? rowKey.trim() : null;
  if (direct) return direct;
  if (provider === 'WAHA') {
    return env('WAHA_API_KEY') || '';
  }
  return env('EVOLUTION_GUILDS_API_KEY') || env('EVOLUTION_API_KEY') || '';
}

function clampTimeoutMs(value: number | undefined, fallback = 15000): number {
  if (!Number.isFinite(value || NaN)) return fallback;
  return Math.min(60000, Math.max(1000, Number(value)));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampTimeoutMs(timeoutMs));
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_err) {
    return { raw: text.slice(0, 1000) };
  }
}

function toLoggableText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch (_err) {
    return String(value ?? '');
  }
}

function redactText(value: unknown): string {
  return toLoggableText(value)
    .replace(/55\d{10,13}/g, '[PHONE_REDACTED]')
    .replace(/[A-Za-z0-9_=-]{48,}/g, '[TOKEN_REDACTED]')
    .slice(0, 1000);
}

function getPath(value: unknown, path: string[]): unknown {
  let current: any = value;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return null;
    current = current[key];
  }
  return current;
}

function normalizePhone(raw: string): string {
  let phone = String(raw || '').replace(/@.*$/, '').replace(/\D/g, '');
  if (phone.startsWith('55') && phone.length >= 12) return phone;
  if (phone.length === 10 || phone.length === 11) return `55${phone}`;
  return phone;
}

function toWahaChatId(raw: string): string {
  const phone = normalizePhone(raw);
  if (String(raw || '').includes('@')) return String(raw);
  return `${phone}@c.us`;
}

function extractMessageId(provider: WhatsAppProvider, payload: unknown): string | null {
  const candidates = provider === 'WAHA'
    ? [
      getPath(payload, ['id']),
      getPath(payload, ['_data', 'id', 'id']),
      getPath(payload, ['key', 'id']),
      getPath(payload, ['messageId']),
    ]
    : [
      getPath(payload, ['key', 'id']),
      getPath(payload, ['message', 'key', 'id']),
      getPath(payload, ['id']),
      getPath(payload, ['messageId']),
    ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function resolveWahaMediaPayload(mediaUrl: string, mediaType?: string | null): {
  endpoint: string;
  file: {
    mimetype: string;
    filename: string;
    url: string;
  };
} {
  const normalized = String(mediaType || '').toLowerCase();
  if (normalized.includes('image')) {
    return {
      endpoint: 'sendImage',
      file: {
        mimetype: 'image/jpeg',
        filename: 'imagem.jpg',
        url: mediaUrl,
      },
    };
  }

  if (normalized.includes('video')) {
    return {
      endpoint: 'sendVideo',
      file: {
        mimetype: 'video/mp4',
        filename: 'video.mp4',
        url: mediaUrl,
      },
    };
  }

  return {
    endpoint: 'sendFile',
    file: {
      mimetype: normalized.includes('pdf') || normalized === 'document'
        ? 'application/pdf'
        : 'application/octet-stream',
      filename: normalized.includes('pdf') || normalized === 'document'
        ? 'Apresentacao_Prospix.pdf'
        : 'arquivo',
      url: mediaUrl,
    },
  };
}

function hasReachoutTimelock(payload: unknown): boolean {
  const candidates = [
    getPath(payload, ['me', 'reachoutTimelock']),
    getPath(payload, ['data', 'me', 'reachoutTimelock']),
    getPath(payload, ['payload', 'me', 'reachoutTimelock']),
    getPath(payload, ['status', 'reachoutTimelock']),
  ];
  return candidates.some((value) => {
    if (!value) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'object') return true;
    if (typeof value === 'string') return value.trim().length > 0;
    return false;
  });
}

export async function loadTenantWhatsAppChannel(
  supabase: SupabaseLike,
  tenantId: string,
): Promise<WhatsAppChannel | null> {
  const { data: channel, error: channelError } = await supabase
    .from('whatsapp_channels')
    .select('id, provider, label, base_url, instance_name, api_key_encrypted, send_enabled, receive_enabled, connection_status, external_state')
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
      source: 'whatsapp_channels',
      sendEnabled: channel.send_enabled !== false,
      receiveEnabled: channel.receive_enabled !== false,
      connectionStatus: channel.connection_status ?? null,
      externalState: channel.external_state ?? null,
    };
  }

  const { data: legacy, error: legacyError } = await supabase
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
    source: 'tenant_secrets',
    sendEnabled: true,
    receiveEnabled: true,
  };
}

async function fetchEvolutionConnectionStatus(
  channel: WhatsAppChannel,
  options: FetchOptions = {},
): Promise<ExternalConnectionStatus> {
  if (!channel.apiKey) {
    return {
      ok: false,
      state: null,
      reasonCode: 'WA_PROVIDER_API_KEY_MISSING',
      critical: true,
      rawError: 'Evolution API key is missing',
    };
  }

  const headers = { apikey: channel.apiKey };
  const encodedInstance = encodeURIComponent(channel.instanceName);

  try {
    const connectionResponse = await fetchWithTimeout(
      `${channel.baseUrl}/instance/connectionState/${encodedInstance}`,
      { headers },
      options.timeoutMs,
    );
    const connectionPayload = await parseJsonSafe(connectionResponse);

    if (connectionResponse.ok) {
      const state = String(
        getPath(connectionPayload, ['instance', 'state'])
          ?? getPath(connectionPayload, ['state'])
          ?? getPath(connectionPayload, ['connectionState'])
          ?? '',
      ).toLowerCase();

      if (state === 'open') {
        return {
          ok: true,
          state,
          reasonCode: null,
          critical: false,
          rawError: null,
        };
      }

      return {
        ok: false,
        state: state || null,
        reasonCode: state ? `WA_EVOLUTION_${state.toUpperCase()}` : 'WA_EVOLUTION_NOT_OPEN',
        critical: ['close', 'closed', 'removed', 'logout', 'disconnected'].includes(state),
        rawError: redactText(connectionPayload),
      };
    }

    const fetchInstancesResponse = await fetchWithTimeout(
      `${channel.baseUrl}/instance/fetchInstances?instanceName=${encodedInstance}`,
      { headers },
      options.timeoutMs,
    );
    const fetchInstancesPayload = await parseJsonSafe(fetchInstancesResponse);

    if (fetchInstancesResponse.ok) {
      const first = Array.isArray(fetchInstancesPayload) ? fetchInstancesPayload[0] : fetchInstancesPayload;
      const state = String(
        getPath(first, ['connectionStatus'])
          ?? getPath(first, ['instance', 'state'])
          ?? getPath(first, ['state'])
          ?? '',
      ).toLowerCase();

      if (state === 'open') {
        return {
          ok: true,
          state,
          reasonCode: null,
          critical: false,
          rawError: null,
        };
      }

      return {
        ok: false,
        state: state || null,
        reasonCode: state ? `WA_EVOLUTION_${state.toUpperCase()}` : 'WA_EVOLUTION_FETCH_INSTANCE_NOT_OPEN',
        critical: ['close', 'closed', 'removed', 'logout', 'disconnected'].includes(state),
        rawError: redactText(fetchInstancesPayload),
      };
    }

    return {
      ok: false,
      state: null,
      reasonCode: `WA_EVOLUTION_HTTP_${connectionResponse.status}`,
      critical: connectionResponse.status === 401 || connectionResponse.status === 403 || connectionResponse.status === 404,
      rawError: redactText({ connectionPayload, fetchInstancesPayload }),
    };
  } catch (err) {
    return {
      ok: false,
      state: null,
      reasonCode: err instanceof DOMException && err.name === 'AbortError'
        ? 'WA_EVOLUTION_STATUS_TIMEOUT'
        : 'WA_EVOLUTION_STATUS_ERROR',
      critical: false,
      rawError: redactText(err),
    };
  }
}

async function fetchWahaConnectionStatus(
  channel: WhatsAppChannel,
  options: FetchOptions = {},
): Promise<ExternalConnectionStatus> {
  if (!channel.apiKey) {
    return {
      ok: false,
      state: null,
      reasonCode: 'WA_PROVIDER_API_KEY_MISSING',
      critical: true,
      rawError: 'WAHA API key is missing',
    };
  }

  try {
    const response = await fetchWithTimeout(
      `${channel.baseUrl}/api/sessions/${encodeURIComponent(channel.instanceName)}`,
      {
        headers: {
          'X-Api-Key': channel.apiKey,
        },
      },
      options.timeoutMs,
    );
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      return {
        ok: false,
        state: null,
        reasonCode: `WA_WAHA_HTTP_${response.status}`,
        critical: response.status === 401 || response.status === 403 || response.status === 404,
        rawError: redactText(payload),
      };
    }

    const status = String(
      getPath(payload, ['status'])
        ?? getPath(payload, ['session', 'status'])
        ?? '',
    ).toUpperCase();
    const timelockActive = hasReachoutTimelock(payload);

    if (status === 'WORKING') {
      return {
        ok: true,
        state: status,
        reasonCode: timelockActive ? 'WA_REACHOUT_TIMELOCK_ACTIVE' : null,
        critical: false,
        rawError: timelockActive ? redactText(payload) : null,
        reachoutTimelock: timelockActive ? { active: true, raw: payload } : null,
      };
    }

    if (status === 'SCAN_QR_CODE') {
      return {
        ok: false,
        state: status,
        reasonCode: 'WA_WAHA_QR_REQUIRED',
        critical: false,
        rawError: redactText(payload),
      };
    }

    if (status === 'STOPPED') {
      return {
        ok: false,
        state: status,
        reasonCode: 'WA_WAHA_STOPPED',
        critical: true,
        rawError: redactText(payload),
      };
    }

    if (status === 'FAILED') {
      return {
        ok: false,
        state: status,
        reasonCode: 'WA_WAHA_FAILED',
        critical: true,
        rawError: redactText(payload),
      };
    }

    return {
      ok: false,
      state: status || null,
      reasonCode: status ? `WA_WAHA_${status}` : 'WA_WAHA_STATUS_UNKNOWN',
      critical: false,
      rawError: redactText(payload),
    };
  } catch (err) {
    return {
      ok: false,
      state: null,
      reasonCode: err instanceof DOMException && err.name === 'AbortError'
        ? 'WA_WAHA_STATUS_TIMEOUT'
        : 'WA_WAHA_STATUS_ERROR',
      critical: false,
      rawError: redactText(err),
    };
  }
}

export async function fetchWhatsAppConnectionStatus(
  channel: WhatsAppChannel | null,
  options: FetchOptions = {},
): Promise<ExternalConnectionStatus> {
  if (!channel) {
    return {
      ok: false,
      state: null,
      reasonCode: 'WA_PROVIDER_NOT_CONFIGURED',
      critical: true,
      rawError: 'No active WhatsApp provider channel was found',
    };
  }

  if (channel.provider === 'WAHA') {
    return await fetchWahaConnectionStatus(channel, options);
  }
  return await fetchEvolutionConnectionStatus(channel, options);
}

export async function sendWhatsAppMessage(
  channel: WhatsAppChannel,
  phone: string,
  text: string,
  mediaUrl?: string | null,
  mediaType?: string | null,
  options: FetchOptions = {},
): Promise<SendWhatsAppResult> {
  if (!channel.sendEnabled) {
    return {
      ok: false,
      provider: channel.provider,
      channelId: channel.id,
      error: 'WhatsApp channel send is disabled',
    };
  }

  if (!channel.apiKey) {
    return {
      ok: false,
      provider: channel.provider,
      channelId: channel.id,
      error: 'WhatsApp provider API key is missing',
    };
  }

  if (channel.provider === 'WAHA') {
    try {
      const mediaPayload = mediaUrl ? resolveWahaMediaPayload(mediaUrl, mediaType) : null;
      const response = await fetchWithTimeout(
        `${channel.baseUrl}/api/${mediaPayload ? mediaPayload.endpoint : 'sendText'}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': channel.apiKey,
          },
          body: JSON.stringify({
            session: channel.instanceName,
            chatId: toWahaChatId(phone),
            ...(mediaPayload
              ? {
                caption: text,
                file: mediaPayload.file,
              }
              : { text }),
          }),
        },
        options.timeoutMs,
      );
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        return {
          ok: false,
          provider: 'WAHA',
          channelId: channel.id,
          error: `WAHA ${response.status}: ${redactText(payload)}`,
        };
      }

      return {
        ok: true,
        provider: 'WAHA',
        channelId: channel.id,
        whatsappMsgId: extractMessageId('WAHA', payload),
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'WAHA',
        channelId: channel.id,
        error: err instanceof DOMException && err.name === 'AbortError'
          ? 'WAHA send timeout'
          : redactText(err),
      };
    }
  }

  const encodedInstance = encodeURIComponent(channel.instanceName);
  const endpoint = mediaUrl
    ? `${channel.baseUrl}/message/sendMedia/${encodedInstance}`
    : `${channel.baseUrl}/message/sendText/${encodedInstance}`;
  const payload = mediaUrl
    ? {
      number: normalizePhone(phone),
      mediatype: mediaType || 'document',
      media: mediaUrl,
      caption: text,
    }
    : {
      number: normalizePhone(phone),
      text,
    };

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: channel.apiKey,
        },
        body: JSON.stringify(payload),
      },
      options.timeoutMs,
    );
    const responsePayload = await parseJsonSafe(response);

    if (!response.ok) {
      return {
        ok: false,
        provider: 'EVOLUTION',
        channelId: channel.id,
        error: `Evolution ${response.status}: ${redactText(responsePayload)}`,
      };
    }

    return {
      ok: true,
      provider: 'EVOLUTION',
      channelId: channel.id,
      whatsappMsgId: extractMessageId('EVOLUTION', responsePayload),
    };
  } catch (err) {
    return {
      ok: false,
      provider: 'EVOLUTION',
      channelId: channel.id,
      error: err instanceof DOMException && err.name === 'AbortError'
        ? 'Evolution send timeout'
        : redactText(err),
    };
  }
}
