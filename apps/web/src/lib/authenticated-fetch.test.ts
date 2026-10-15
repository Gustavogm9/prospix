import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSessionRetry } from './authenticated-fetch';

afterEach(() => vi.unstubAllGlobals());

describe('fetch autenticado', () => {
  it('renova a sessão e repete uma única vez após 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();

    const response = await fetchWithSessionRetry('/api/teste', {}, {
      getAccessToken: vi.fn().mockResolvedValue('token-antigo'),
      refreshAccessToken: vi.fn().mockResolvedValue('token-novo'),
      onUnauthorized: unauthorized,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer token-antigo' });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer token-novo' });
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('encerra a sessão somente depois da segunda resposta 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const unauthorized = vi.fn();

    const response = await fetchWithSessionRetry('/api/teste', {}, {
      getAccessToken: vi.fn().mockResolvedValue('token-antigo'),
      refreshAccessToken: vi.fn().mockResolvedValue('token-novo'),
      onUnauthorized: unauthorized,
    });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('não repete respostas que não são 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn();

    await fetchWithSessionRetry('/api/teste', {}, {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      refreshAccessToken: refresh,
      onUnauthorized: vi.fn(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
