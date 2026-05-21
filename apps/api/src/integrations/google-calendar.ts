import { Result } from '@prospix/shared-types';
import { ResultHelper } from '../lib/result.js';
import { env } from '../config/env.js';

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  description?: string;
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

/**
 * Exchange a Google OAuth Refresh Token for a fresh Access Token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh google access token: ${response.statusText} - ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * List events on a Google Calendar within a specific time window.
 */
export async function listEvents(params: {
  calendarId: string;
  refreshToken: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<Result<CalendarEvent[]>> {
  try {
    const accessToken = await refreshAccessToken(params.refreshToken);
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`);
    url.searchParams.set('timeMin', params.timeMin.toISOString());
    url.searchParams.set('timeMax', params.timeMax.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: `Google Calendar listEvents returned ${response.status}: ${response.statusText}`,
      });
    }

    const data = (await response.json()) as { items?: CalendarEvent[] };
    return ResultHelper.success(data.items || []);
  } catch (error) {
    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: (error as Error).message || 'Unexpected Google Calendar listEvents error',
    });
  }
}

/**
 * Create a new event on a Google Calendar.
 */
export async function createEvent(params: {
  calendarId: string;
  refreshToken: string;
  event: {
    summary: string;
    start: Date;
    end: Date;
    description?: string;
    attendees?: Array<{ email: string }>;
  };
}): Promise<Result<{ id: string }>> {
  try {
    const accessToken = await refreshAccessToken(params.refreshToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.event.summary,
        description: params.event.description,
        start: { dateTime: params.event.start.toISOString() },
        end: { dateTime: params.event.end.toISOString() },
        attendees: params.event.attendees,
      }),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: `Google Calendar createEvent returned ${response.status}: ${response.statusText} - ${errTxt}`,
      });
    }

    const data = (await response.json()) as { id: string };
    return ResultHelper.success({ id: data.id });
  } catch (error) {
    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: (error as Error).message || 'Unexpected Google Calendar createEvent error',
    });
  }
}

/**
 * Watch for events changes on a Google Calendar.
 */
export async function watchChannel(params: {
  calendarId: string;
  refreshToken: string;
  address: string;
  channelId: string;
}): Promise<Result<{ channelId: string; resourceId: string; expiration: string }>> {
  try {
    const accessToken = await refreshAccessToken(params.refreshToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events/watch`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: params.channelId,
        type: 'web_hook',
        address: params.address,
      }),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: `Google Calendar watchChannel returned ${response.status}: ${response.statusText} - ${errTxt}`,
      });
    }

    const data = (await response.json()) as { id: string; resourceId: string; expiration: string };
    return ResultHelper.success({
      channelId: data.id,
      resourceId: data.resourceId,
      expiration: data.expiration,
    });
  } catch (error) {
    return ResultHelper.failure({
      code: 'INTERNAL_ERROR',
      message: (error as Error).message || 'Unexpected Google Calendar watchChannel error',
    });
  }
}
