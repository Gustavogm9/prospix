import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('./api-fetch', () => ({ apiFetch: mocks.api }));
import { requestOnboardingQr } from './onboarding-whatsapp';
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
describe('pedido de QR do onboarding', () => {
  it('normaliza a imagem base64 retornada pela integração existente', async () => {
    mocks.api.mockResolvedValue(new Response(JSON.stringify({ qrcode: 'aW1hZ2Vt' })));
    expect(await requestOnboardingQr()).toBe('data:image/png;base64,aW1hZ2Vt');
    expect(mocks.api).toHaveBeenCalledWith('/api/integrations/whatsapp/connect', expect.objectContaining({ method: 'POST' }));
  });
  it('recusa resposta com erro e formato que não seja imagem', async () => {
    mocks.api.mockResolvedValueOnce(new Response(JSON.stringify({ qrcode: 'aW1hZ2Vt' }), { status: 503 }));
    await expect(requestOnboardingQr()).rejects.toThrow('QR_UNAVAILABLE');
    mocks.api.mockResolvedValueOnce(new Response(JSON.stringify({ qrcode: 'https://example.test/qr' })));
    await expect(requestOnboardingQr()).rejects.toThrow('QR_INVALID');
  });
  it('encerra a espera mesmo quando a sessão bloqueia antes do fetch', async () => {
    vi.useFakeTimers();
    mocks.api.mockReturnValue(new Promise(() => {}));
    let outcome: unknown;
    const pending = requestOnboardingQr().then(() => { outcome = 'success'; }, error => { outcome = error; });
    await vi.advanceTimersByTimeAsync(20_001);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('QR_TIMEOUT');
    expect(mocks.api.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    await pending;
  });
  it('limita também a leitura de um corpo que nunca termina', async () => {
    vi.useFakeTimers();
    const response = { ok: true, json: () => new Promise(() => {}) };
    mocks.api.mockResolvedValue(response);
    let outcome: unknown;
    const pending = requestOnboardingQr().then(() => { outcome = 'success'; }, error => { outcome = error; });
    await vi.advanceTimersByTimeAsync(20_001);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('QR_TIMEOUT');
    await pending;
  });
});
