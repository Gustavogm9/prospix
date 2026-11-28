import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), channel: vi.fn(), readSecret: vi.fn(), fetch: vi.fn(), upsert: vi.fn() }));
vi.mock('../../../_lib/supabase-admin', () => ({ authenticateRequest: mocks.auth, supabaseAdmin: { from: mocks.from } }));
vi.mock('../../../_lib/whatsapp-provider', () => ({ loadTenantWhatsAppChannel: mocks.channel, loadTenantWahaChannel: vi.fn(), buildWahaWebhookUrl: vi.fn(), createOrUpdateWahaSession: vi.fn(), getWahaQrCode: vi.fn() }));
vi.mock('@/lib/secrets', () => ({ readStoredSecret: mocks.readSecret, encryptSecret: vi.fn() }));
import { POST } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ tenantId: 'qa-tenant', role: 'OWNER' });
  mocks.channel.mockResolvedValue({ provider: 'EVOLUTION', source: 'tenant_secrets', baseUrl: 'https://evo.example.test', instanceName: 'qa-onboarding', apiKey: 'qa-api-key' });
  mocks.readSecret.mockReturnValue('qa-api-key');
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    const value = table === 'tenants'
      ? { id: 'qa-tenant', slug: 'qa-onboarding', name: 'QA' }
      : { evolution_instance_name: 'qa-onboarding', evolution_base_url: 'https://evo.example.test', evolution_api_key_encrypted: 'qa-encrypted' };
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: value, error: null }), upsert: mocks.upsert };
    return query;
  });
  vi.stubEnv('EVOLUTION_BASIC_AUTH_HOST', 'evo.example.test');
  vi.stubEnv('EVOLUTION_BASIC_AUTH_B64', 'cWE6cWE=');
  vi.stubEnv('API_URL', 'https://api.example.test');
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/connectionState/') ? { instance: { state: 'close' } } : url.includes('/instance/connect/') ? { base64: 'aW1hZ2Vt' } : {})));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = () => new NextRequest('http://localhost/api/integrations/whatsapp/connect', { method: 'POST', body: '{}' });

describe('QR Evolution do onboarding', () => {
  it('autentica criação, webhook e QR no proxy Basic autorizado, com prazo por chamada', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).qrcode).toBe('aW1hZ2Vt');
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://evo.example.test/instance/connectionState/qa-onboarding',
      'https://evo.example.test/instance/create',
      'https://evo.example.test/webhook/set/qa-onboarding',
      'https://evo.example.test/instance/connect/qa-onboarding',
    ]);
    for (const [, options] of mocks.fetch.mock.calls) {
      expect(options.headers).toMatchObject({ apikey: 'qa-api-key', Authorization: 'Basic cWE6cWE=' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('não envia Basic para host fora da configuração autorizada', async () => {
    vi.stubEnv('EVOLUTION_BASIC_AUTH_HOST', 'another.example.test');
    expect((await POST(request())).status).toBe(200);
    for (const [, options] of mocks.fetch.mock.calls) expect(options.headers.Authorization).toBeUndefined();
  });
  it('mantém erro do provedor sem retornar QR fictício', async () => {
    mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/connectionState/') ? { instance: { state: 'close' } } : {}), { status: url.includes('/instance/connect/') ? 401 : 200 }));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect((await response.json()).qrcode).toBeUndefined();
  });
  it('impede assistente de iniciar integração', async () => {
    mocks.auth.mockResolvedValue({ tenantId: 'qa-tenant', role: 'ASSISTANT' });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});


it('gera QR no mesmo canal Evolution selecionado pela consulta de status', async () => {
  mocks.channel.mockResolvedValue({ provider: 'EVOLUTION', id: 'qa-channel', source: 'whatsapp_channels', baseUrl: 'https://active.example.test', instanceName: 'qa-active', apiKey: 'qa-active-key' });
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/connectionState/') ? { instance: { state: 'close' } } : url.includes('/connectionState/') ? { instance: { state: 'close' } } : url.includes('/instance/connect/') ? { base64: 'aW1hZ2Vt' } : {})));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(mocks.fetch.mock.calls.every(([url]) => new URL(url).origin === 'https://active.example.test')).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledWith('https://active.example.test/instance/connect/qa-active', expect.objectContaining({ headers: expect.objectContaining({ apikey: 'qa-active-key' }) }));
  expect(mocks.from.mock.calls.some(([table]) => table === 'tenant_secrets')).toBe(false);
});

it('reconhece sessão já aberta sem recriar instância, pedir QR ou alterar webhook', async () => {
  mocks.channel.mockResolvedValue({ provider: 'EVOLUTION', id: 'qa-channel', source: 'whatsapp_channels', baseUrl: 'https://active.example.test', instanceName: 'qa-active', apiKey: 'qa-active-key' });
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/connectionState/') ? { instance: { state: 'open' } } : {})));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'connected', instanceName: 'qa-active' });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledWith('https://active.example.test/instance/connectionState/qa-active', expect.anything());
  expect(mocks.upsert).not.toHaveBeenCalled();
});


it('não tenta criar ou alterar uma sessão cujo estado está indisponível', async () => {
  mocks.fetch.mockResolvedValue(new Response('{}', { status: 503 }));
  expect((await POST(request())).status).toBe(503);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it('reconfirma conexão quando o pareamento termina durante a resposta do QR', async () => {
  let checks = 0;
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/connectionState/') ? { instance: { state: ++checks === 1 ? 'close' : 'open' } } : {})));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'connected', instanceName: 'qa-onboarding' });
  expect(mocks.upsert).not.toHaveBeenCalled();
});


it('preserva provisionamento inicial sem canal e usa o registro recém-criado', async () => {
  const loaded = { provider: 'EVOLUTION', source: 'tenant_secrets', baseUrl: 'https://evo.example.test', instanceName: 'tenant_qaonboarding', apiKey: 'qa-api-key' };
  mocks.channel.mockResolvedValueOnce(null).mockResolvedValueOnce(loaded);
  const originalFrom = mocks.from.getMockImplementation()!;
  const insert = vi.fn();
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }), insert: (value: unknown) => { insert(value); return query; }, single: async () => ({ data: { evolution_instance_name: 'tenant_qaonboarding' }, error: null }) };
  mocks.from.mockImplementation(table => table === 'tenant_secrets' ? query : originalFrom(table));
  expect((await POST(request())).status).toBe(200);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'qa-tenant', evolution_instance_name: 'tenant_qaonboarding' }));
  expect(mocks.channel).toHaveBeenCalledTimes(2);
  expect(mocks.fetch).toHaveBeenCalledWith('https://evo.example.test/instance/connect/tenant_qaonboarding', expect.anything());
});
