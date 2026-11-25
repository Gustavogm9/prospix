import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), channel: vi.fn(), waha: vi.fn(), evolution: vi.fn(), diagnostics: vi.fn() }));
vi.mock('../../../_lib/supabase-admin', () => ({ authenticateRequest: mocks.auth, supabaseAdmin: { from: mocks.diagnostics } }));
vi.mock('@/lib/secrets', () => ({ readStoredSecret: vi.fn() }));
vi.mock('@/lib/evolution-connection', () => ({ probeEvolutionConnection: mocks.evolution }));
vi.mock('../../../_lib/ai-activity-monitor', () => ({ loadAiActivityMonitor: mocks.diagnostics }));
vi.mock('../../../_lib/whatsapp-provider', () => ({
  loadTenantWhatsAppChannel: mocks.channel, loadTenantWahaChannel: mocks.diagnostics,
  fetchWahaSession: mocks.waha,
  mapWahaStatusToAppStatus: (status: string) => ({ status: status === 'WORKING' ? 'connected' : 'pending_qr', reason: null }),
}));
import { GET } from './route';
const request = () => new NextRequest('http://localhost/api/integrations/whatsapp/status?view=connection&tenantId=other');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ tenantId: 'authenticated-tenant', role: 'OWNER' });
  mocks.channel.mockResolvedValue(null);
  mocks.diagnostics.mockImplementation(() => { throw new Error('Heavy diagnostics must not run'); });
});
describe('status leve de conexão para onboarding', () => {
  it('não aguarda diagnósticos operacionais quando o tenant ainda não conectou WhatsApp', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'disconnected', configured: false });
    expect(mocks.channel).toHaveBeenCalledWith(expect.anything(), 'authenticated-tenant');
    expect(mocks.diagnostics).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('confirma Evolution no provedor ativo sem consultar canais candidatos ou diagnósticos', async () => {
    const channel = { provider: 'EVOLUTION', apiKey: 'fictional', instanceName: 'test' };
    mocks.channel.mockResolvedValue(channel);
    mocks.evolution.mockResolvedValue({ status: 'connected', reason: null });
    expect(await (await GET(request())).json()).toEqual({ status: 'connected', reason: null, configured: true });
    expect(mocks.evolution).toHaveBeenCalledWith(channel);
    expect(mocks.diagnostics).not.toHaveBeenCalled();
  });
  it('confirma WAHA no provedor ativo', async () => {
    mocks.channel.mockResolvedValue({ provider: 'WAHA', apiKey: 'fictional' });
    mocks.waha.mockResolvedValue({ ok: true, status: 'WORKING' });
    expect((await (await GET(request())).json()).status).toBe('connected');
    expect(mocks.diagnostics).not.toHaveBeenCalled();
  });
  it('mantém falha de provedor como indisponível, sem inventar desconexão', async () => {
    mocks.channel.mockResolvedValue({ provider: 'WAHA', apiKey: 'fictional' });
    mocks.waha.mockResolvedValue({ ok: false, status: null });
    expect((await (await GET(request())).json()).status).toBe('unavailable');
  });
  it('recusa sessão ausente antes de consultar a conexão', async () => {
    mocks.auth.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.channel).not.toHaveBeenCalled();
  });
});

it('recusa leitura resumida sem organização ou com papel administrativo', async () => {
  mocks.auth.mockResolvedValue({ tenantId: null, role: 'GUILDS_ADMIN' });
  expect((await GET(request())).status).toBe(403);
  expect(mocks.channel).not.toHaveBeenCalled();
});
it('permite a assistente consultar a conexão do próprio tenant', async () => {
  mocks.auth.mockResolvedValue({ tenantId: 'assistant-tenant', role: 'ASSISTANT' });
  expect((await GET(request())).status).toBe(200);
  expect(mocks.channel).toHaveBeenCalledWith(expect.anything(), 'assistant-tenant');
});
