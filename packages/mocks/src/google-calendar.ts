import { http, HttpResponse } from 'msw';

export const googleCalendarHandlers = [
  // Listar eventos (verificar disponibilidade)
  http.get('https://www.googleapis.com/calendar/v3/calendars/:calId/events', () =>
    HttpResponse.json({
      items: [
        {
          id: 'mock_evt_existing',
          summary: 'Reunião existente',
          start: { dateTime: '2026-05-22T10:00:00-03:00' },
          end: { dateTime: '2026-05-22T11:00:00-03:00' },
        },
      ],
    }),
  ),
  // Criar evento
  http.post(
    'https://www.googleapis.com/calendar/v3/calendars/:calId/events',
    async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ id: `mock_evt_${Date.now()}`, ...body });
    },
  ),
  // Google OAuth Token exchange / refresh
  http.post('https://oauth2.googleapis.com/token', async () => {
    return HttpResponse.json({
      access_token: 'mock_access_token_123',
      expires_in: 3600,
      token_type: 'Bearer',
    });
  }),
  // Watch events channel
  http.post(
    'https://www.googleapis.com/calendar/v3/calendars/:calId/events/watch',
    async ({ request }) => {
      const body = (await request.json()) as { id: string; type: string; address: string };
      return HttpResponse.json({
        id: body.id,
        resourceId: `mock_res_${Date.now()}`,
        expiration: String(Date.now() + 86400 * 1000),
      });
    },
  ),
];
