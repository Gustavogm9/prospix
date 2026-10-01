import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkWhatsAppNumber,
  loadTenantWhatsAppChannel,
  sendWhatsAppMessage,
} from '../../../../supabase/functions/_shared/whatsapp-provider';

describe('sendWhatsAppMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends Evolution v2 typing delay with the text payload', async () => {
    vi.stubGlobal('Deno', {
      env: {
        get: (name: string) =>
          name === 'EVOLUTION_BASIC_AUTH_HOST' ? 'evolution.example.test' : null,
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: { id: 'provider-message-id' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendWhatsAppMessage(
      {
        id: 'channel-id',
        provider: 'EVOLUTION',
        label: 'QA',
        baseUrl: 'https://evolution.example.test',
        instanceName: 'guilds',
        apiKey: 'api-key',
        source: 'whatsapp_channels',
        sendEnabled: true,
        receiveEnabled: true,
      },
      '5511999999999',
      'Mensagem curta e humana.',
      null,
      null,
      { typingDelayMs: 2400 },
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      number: '5511999999999',
      text: 'Mensagem curta e humana.',
      delay: 2400,
    });
  });
});

describe('checkWhatsAppNumber', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('checks the active Evolution channel without exposing a legacy fallback', async () => {
    vi.stubGlobal('Deno', { env: { get: () => null } });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ exists: true, jid: '5511999999999@s.whatsapp.net' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkWhatsAppNumber({
      id: 'channel-id',
      provider: 'EVOLUTION',
      label: 'Principal',
      baseUrl: 'https://evolution.example.test',
      instanceName: 'prospix',
      apiKey: 'api-key',
      source: 'whatsapp_channels',
      sendEnabled: true,
      receiveEnabled: true,
    }, '+55 (11) 99999-9999');

    expect(result).toMatchObject({ exists: true, provider: 'EVOLUTION', channelId: 'channel-id' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://evolution.example.test/chat/whatsappNumbers/prospix',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({ numbers: ['5511999999999'] });
  });

  it('returns an indeterminate result when the provider rejects the request', async () => {
    vi.stubGlobal('Deno', { env: { get: () => null } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 }),
    ));

    const result = await checkWhatsAppNumber({
      id: null,
      provider: 'WAHA',
      label: null,
      baseUrl: 'https://waha.example.test',
      instanceName: 'default',
      apiKey: 'bad-key',
      source: 'whatsapp_channels',
      sendEnabled: true,
      receiveEnabled: true,
    }, '5511999999999');

    expect(result.exists).toBeNull();
    expect(result.error).toContain('401');
  });
});

describe('loadTenantWhatsAppChannel', () => {
  it('fails closed instead of reading the legacy VPS when requested by enrichment', async () => {
    const query: Record<string, any> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.order = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn(() => query);

    const result = await loadTenantWhatsAppChannel(
      { from },
      'tenant-id',
      { allowLegacyFallback: false },
    );

    expect(result).toBeNull();
    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith('whatsapp_channels');
  });
});
