import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { googleCalendarHandlers } from '@prospix/mocks';
import { listEvents, createEvent, watchChannel, refreshAccessToken } from './google-calendar.js';

// Setup MSW Server
const server = setupServer(...googleCalendarHandlers);

describe('Google Calendar Integration (with MSW Mock)', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  const mockParams = {
    calendarId: 'primary',
    refreshToken: 'mock-refresh-token',
  };

  it('should refresh access token successfully', async () => {
    const accessToken = await refreshAccessToken(mockParams.refreshToken);
    expect(accessToken).toBe('mock_access_token_123');
  });

  it('should list events successfully', async () => {
    const result = await listEvents({
      ...mockParams,
      timeMin: new Date('2026-05-22T00:00:00Z'),
      timeMax: new Date('2026-05-22T23:59:59Z'),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      const first = result.value[0];
      expect(first).toBeDefined();
      if (first) {
        expect(first.id).toBe('mock_evt_existing');
        expect(first.summary).toBe('Reunião existente');
      }
    }
  });

  it('should create an event successfully', async () => {
    const result = await createEvent({
      ...mockParams,
      event: {
        summary: 'Reunião Prospix',
        start: new Date('2026-05-22T14:00:00Z'),
        end: new Date('2026-05-22T14:30:00Z'),
        description: 'Mocked Prospix Meeting',
        attendees: [{ email: 'lead@example.com' }],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeDefined();
      expect(result.value.id.startsWith('mock_evt_')).toBe(true);
    }
  });

  it('should watch calendar channel successfully', async () => {
    const result = await watchChannel({
      ...mockParams,
      address: 'https://api.prospix.com/v1/webhooks/google/calendar',
      channelId: 'mock-channel-id',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channelId).toBe('mock-channel-id');
      expect(result.value.resourceId).toBeDefined();
      expect(result.value.expiration).toBeDefined();
    }
  });
});
