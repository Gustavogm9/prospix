import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent } from './google-calendar';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const event = { summary: 'QA TESTE', start: '2026-11-20T15:00:00Z', end: '2026-11-20T15:30:00Z', id: 'abc123', meetingId: 'meeting-1' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('criação idempotente de evento Google', () => {
  it('reconcilia repetição pelo ID estável sem duplicar o compromisso', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'test-token' }))
      .mockResolvedValueOnce(json({ error: 'duplicate' }, 409))
      .mockResolvedValueOnce(json({ id: 'abc123', extendedProperties: { private: { prospixMeetingId: 'meeting-1' } } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createEvent('refresh', 'primary', event)).resolves.toMatchObject({ eventId: 'abc123' });
    const payload = JSON.parse(fetchMock.mock.calls[1]![1]!.body);
    expect(payload.id).toBe('abc123');
    expect(payload.extendedProperties.private.prospixMeetingId).toBe('meeting-1');
    expect(fetchMock.mock.calls[2]![1]!.method).toBe('GET');
  });
  it('recusa resposta 200 sem recibo do evento', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ access_token: 'test-token' })).mockResolvedValueOnce(json({})));
    await expect(createEvent('refresh', 'primary', event)).rejects.toThrow();
  });
  it('não reutiliza evento de outra reunião em uma colisão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ access_token: 'test-token' }))
      .mockResolvedValueOnce(json({}, 409)).mockResolvedValueOnce(json({ id: 'abc123', extendedProperties: { private: { prospixMeetingId: 'outra' } } })));
    await expect(createEvent('refresh', 'primary', event)).rejects.toThrow();
  });
});
