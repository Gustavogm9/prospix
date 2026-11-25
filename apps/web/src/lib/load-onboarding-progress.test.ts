import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), api: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('./api-fetch', () => ({ apiFetch: mocks.api }));
import { loadOnboardingProgress } from './load-onboarding-progress';

function table(result: unknown) {
  const q = { select: vi.fn(() => q), eq: vi.fn((_field: string, _value: unknown) => q), is: vi.fn(() => q), maybeSingle: vi.fn(() => q), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  return q;
}
beforeEach(() => vi.resetAllMocks());
describe('verificação real do onboarding', () => {
  it('consulta o tenant correto e conta clientes existentes, inclusive de dias anteriores', async () => {
    const q = table({ count: 1, data: { persona_name: 'Assistente', business_description: 'Atendimento', tone_of_voice: 'Consultivo' }, error: null });
    mocks.from.mockReturnValue(q);
    mocks.api.mockResolvedValue(new Response(JSON.stringify({ status: 'connected' })));
    expect(await loadOnboardingProgress('conta-b')).toEqual({ whatsapp: true, firstLead: true, icp: true, context: true, firstScript: true });
    expect(q.eq.mock.calls.filter(call => call[0] === 'tenant_id')).toHaveLength(4);
    expect(q.eq.mock.calls.filter(call => call[0] === 'tenant_id').every(call => call[1] === 'conta-b')).toBe(true);
    expect(q.eq).toHaveBeenCalledWith('status', 'ACTIVE');
  });
  it('não transforma erro do banco em etapa pendente ou concluída', async () => {
    mocks.from.mockReturnValue(table({ error: { message: 'denied' } }));
    mocks.api.mockResolvedValue(new Response(JSON.stringify({ status: 'connected' })));
    await expect(loadOnboardingProgress('a')).rejects.toThrow();
  });
  it('não aceita conexão indisponível como confirmação de WhatsApp', async () => {
    mocks.from.mockReturnValue(table({ count: 0, data: null, error: null }));
    mocks.api.mockResolvedValue(new Response(JSON.stringify({ status: 'unavailable' })));
    await expect(loadOnboardingProgress('a')).rejects.toThrow();
  });
});
