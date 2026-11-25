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
