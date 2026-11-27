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
  mocks.channel.mockResolvedValue({ provider: 'EVOLUTION', apiKey: 'qa-api-key' });
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
  mocks.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/instance/connect/') ? { base64: 'aW1hZ2Vt' } : {})));
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
    mocks.fetch.mockImplementation(async (url: string) => new Response('{}', { status: url.includes('/instance/connect/') ? 401 : 200 }));
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
