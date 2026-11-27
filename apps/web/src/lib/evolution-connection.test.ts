import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeEvolutionConnection } from './evolution-connection';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const channel = { baseUrl: 'https://evo.example.test', apiKey: 'qa-key', instanceName: 'active-channel' };
describe('estado real do canal Evolution selecionado', () => {
  it('consulta a instância ativa e inclui Basic somente no host autorizado', async () => {
    vi.stubEnv('EVOLUTION_BASIC_AUTH_B64', 'cWE6cWE='); vi.stubEnv('EVOLUTION_BASIC_AUTH_HOST', 'evo.example.test');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ instance: { state: 'open' } })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeEvolutionConnection(channel)).resolves.toMatchObject({ status: 'connected' });
    expect(fetchMock).toHaveBeenCalledWith('https://evo.example.test/instance/connectionState/active-channel', expect.objectContaining({ headers: { apikey: 'qa-key', Authorization: 'Basic cWE6cWE=' } }));
  });
  it('não declara conexão quando o provedor falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(probeEvolutionConnection(channel)).resolves.toMatchObject({ status: 'unavailable' });
  });
});


it('trata instância ainda não criada como desconectada, sem erro geral no onboarding', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    status: 404, error: 'Not Found', response: { message: ['The "active-channel" instance does not exist'] },
  }), { status: 404 })));
  await expect(probeEvolutionConnection(channel)).resolves.toEqual({ status: 'disconnected', reason: 'instance_not_found' });
});

it.each([401, 403, 500, 503])('mantém HTTP %s como indisponível em vez de permitir conexão presumida', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'unavailable' }), { status })));
  await expect(probeEvolutionConnection(channel)).resolves.toEqual({ status: 'unavailable', reason: 'provider_unavailable' });
});

it('não confunde rota 404 inválida com instância ausente', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 404, error: 'Not Found', message: 'Cannot GET /invalid' }), { status: 404 })));
  await expect(probeEvolutionConnection(channel)).resolves.toEqual({ status: 'unavailable', reason: 'provider_unavailable' });
});
