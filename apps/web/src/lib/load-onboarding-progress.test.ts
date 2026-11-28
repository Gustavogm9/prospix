import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), api: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('./api-fetch', () => ({ apiFetch: mocks.api }));
import { loadOnboardingProgress } from './load-onboarding-progress';

function table(result: unknown) {
  const q = { select: vi.fn(() => q), eq: vi.fn((_field: string, _value: unknown) => q), is: vi.fn(() => q), maybeSingle: vi.fn(() => q), abortSignal: vi.fn(() => q), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  return q;
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
describe('verificação real do onboarding', () => {
  it('consulta o tenant correto e conta clientes existentes, inclusive de dias anteriores', async () => {
    const q = table({ count: 1, data: { persona_name: 'Assistente', business_description: 'Atendimento', tone_of_voice: 'Consultivo' }, error: null });
    mocks.from.mockReturnValue(q);
    mocks.api.mockResolvedValue(new Response(JSON.stringify({ status: 'connected' })));
    expect(await loadOnboardingProgress('conta-b')).toEqual({ whatsapp: true, firstLead: true, icp: true, context: true, firstScript: true });
    expect(q.eq.mock.calls.filter(call => call[0] === 'tenant_id')).toHaveLength(4);
    expect(q.eq.mock.calls.filter(call => call[0] === 'tenant_id').every(call => call[1] === 'conta-b')).toBe(true);
    expect(q.eq).toHaveBeenCalledWith('status', 'ACTIVE');
    expect(mocks.api).toHaveBeenCalledWith('/api/integrations/whatsapp/status?view=connection', expect.objectContaining({ signal: expect.any(AbortSignal) }));
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

it('interrompe a espera e permite tentar novamente quando a conexão não responde', async () => {
  vi.useFakeTimers();
  mocks.from.mockReturnValue(table({ count: 0, data: null, error: null }));
  mocks.api.mockReturnValue(new Promise(() => {}));
  const pending = loadOnboardingProgress('timeout-tenant');
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(mocks.api.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
  await rejected;
});


it('mantém WhatsApp pendente e os demais cadastros confirmados quando a instância ainda não existe', async () => {
  mocks.from.mockReturnValue(table({ count: 1, data: { persona_name: 'QA', business_description: 'Empresa fictícia', tone_of_voice: 'Consultivo' }, error: null }));
  mocks.api.mockResolvedValue(new Response(JSON.stringify({ status: 'disconnected', configured: true, reason: 'instance_not_found' })));
  await expect(loadOnboardingProgress('qa-tenant')).resolves.toEqual({ whatsapp: false, firstLead: true, icp: true, context: true, firstScript: true });
});


it('identifica qual consulta falhou sem expor o erro ou dado retornado pelo banco', async () => {
  mocks.from.mockImplementation(name => table(name === 'icps' ? { error: { message: 'private database detail' } } : { count: 0, data: null, error: null }));
  mocks.api.mockResolvedValue(new Response(JSON.stringify({ status: 'connected' })));
  await expect(loadOnboardingProgress('qa')).rejects.toMatchObject({ source: 'icp', code: 'query_failed' });
});

it('aplica prazo também ao corpo da resposta da conexão', async () => {
  vi.useFakeTimers();
  mocks.from.mockReturnValue(table({ count: 0, data: null, error: null }));
  mocks.api.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
  let outcome: unknown;
  const pending = loadOnboardingProgress('qa').then(value => { outcome = value; }, error => { outcome = error; });
  await vi.advanceTimersByTimeAsync(10_001);
  expect(outcome).toMatchObject({ source: 'timeout', code: 'deadline_exceeded' });
  await pending;
});
