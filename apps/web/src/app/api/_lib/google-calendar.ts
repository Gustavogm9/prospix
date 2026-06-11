/**
 * Google Calendar API Helper
 *
 * All interactions with the Google Calendar REST API go through this module.
 * We use native fetch() — no googleapis library dependency.
 */

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: string;   // ISO-8601 dateTime
  end: string;      // ISO-8601 dateTime
  attendees?: Array<{ email: string }>;
  location?: string;
  withMeet?: boolean; // If true, creates a Google Meet conference
}

export interface CreateEventResult {
  eventId: string;
  meetLink?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  status: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  organizer?: { email: string; displayName?: string; self?: boolean };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  colorId?: string;
}

export interface BusyPeriod {
  start: string;
  end: string;
}

// ---------------------------------------------------------------------------
// 1. Token exchange
// ---------------------------------------------------------------------------

/**
 * Exchange a refresh token for a short-lived access token.
 */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Google token exchange failed:', data);
    throw new Error(
      `Failed to refresh Google access token: ${data.error_description || data.error || res.statusText}`
    );
  }

  return data.access_token as string;
}

// ---------------------------------------------------------------------------
// 2. List Calendars
// ---------------------------------------------------------------------------

/**
 * Retrieve the authenticated user's calendar list.
 */
export async function listCalendars(
  refreshToken: string
): Promise<CalendarListEntry[]> {
  const accessToken = await getAccessToken(refreshToken);

  const res = await fetch(`${GOOGLE_API_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Google listCalendars failed:', res.status, body);
    throw new Error(`Failed to list calendars: ${res.statusText}`);
  }

  const data = await res.json();

  return (data.items || []).map((cal: any) => ({
    id: cal.id,
    summary: cal.summary || '',
    primary: cal.primary === true,
    backgroundColor: cal.backgroundColor || '#4285f4',
  }));
}

// ---------------------------------------------------------------------------
// 3. Create Event
// ---------------------------------------------------------------------------

/**
 * Create a new event on the specified calendar.
 * Returns the created event ID.
 */
export async function createEvent(
  refreshToken: string,
  calendarId: string,
  eventData: CalendarEventInput
): Promise<CreateEventResult> {
  const accessToken = await getAccessToken(refreshToken);

  const body: Record<string, any> = {
    summary: eventData.summary,
    description: eventData.description,
    start: {
      dateTime: eventData.start,
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: eventData.end,
      timeZone: 'America/Sao_Paulo',
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 60 }],
    },
  };

  if (eventData.attendees && eventData.attendees.length > 0) {
    body.attendees = eventData.attendees;
  }
  if (eventData.location) {
    body.location = eventData.location;
  }

  // Add Google Meet conference if requested
  if (eventData.withMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `prospix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  // Build query params
  const params = new URLSearchParams();
  if (eventData.withMeet) params.set('conferenceDataVersion', '1');
  if (eventData.attendees && eventData.attendees.length > 0) params.set('sendNotifications', 'true');
  const queryParams = params.toString() ? `?${params}` : '';

  const res = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events${queryParams}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error('Google createEvent failed:', res.status, errBody);
    throw new Error(`Failed to create event: ${res.statusText}`);
  }

  const created = await res.json();
  return {
    eventId: created.id as string,
    meetLink: created.hangoutLink || created.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || undefined,
  };
}

// ---------------------------------------------------------------------------
// 4. Update Event
// ---------------------------------------------------------------------------

/**
 * Partially update an existing event (PATCH).
 */
export async function updateEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string,
  eventData: Partial<CalendarEventInput>
): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);

  const body: Record<string, any> = {};

  if (eventData.summary !== undefined) body.summary = eventData.summary;
  if (eventData.description !== undefined) body.description = eventData.description;
  if (eventData.start) {
    body.start = { dateTime: eventData.start, timeZone: 'America/Sao_Paulo' };
  }
  if (eventData.end) {
    body.end = { dateTime: eventData.end, timeZone: 'America/Sao_Paulo' };
  }
  if (eventData.attendees) body.attendees = eventData.attendees;
  if (eventData.location !== undefined) body.location = eventData.location;

  const res = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error('Google updateEvent failed:', res.status, errBody);
    throw new Error(`Failed to update event ${eventId}: ${res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Delete Event
// ---------------------------------------------------------------------------

/**
 * Delete (cancel) an event from the calendar.
 */
export async function deleteEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const accessToken = await getAccessToken(refreshToken);

  const res = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  // 204 No Content is the expected success response; 410 Gone means already deleted
  if (!res.ok && res.status !== 410) {
    const errBody = await res.text();
    console.error('Google deleteEvent failed:', res.status, errBody);
    throw new Error(`Failed to delete event ${eventId}: ${res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// 6. List Events
// ---------------------------------------------------------------------------

/**
 * List events within a time range, ordered by start time.
 * Cancelled events are filtered out.
 */
export async function listEvents(
  refreshToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const accessToken = await getAccessToken(refreshToken);

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const res = await fetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error('Google listEvents failed:', res.status, errBody);
    throw new Error(`Failed to list events: ${res.statusText}`);
  }

  const data = await res.json();

  return (data.items || [])
    .filter((ev: any) => ev.status !== 'cancelled')
    .map((ev: any) => ({
      id: ev.id,
      summary: ev.summary || '',
      start: ev.start?.dateTime || ev.start?.date || '',
      end: ev.end?.dateTime || ev.end?.date || '',
      status: ev.status || 'confirmed',
      description: ev.description,
      location: ev.location,
      htmlLink: ev.htmlLink,
      hangoutLink: ev.hangoutLink,
      organizer: ev.organizer ? {
        email: ev.organizer.email,
        displayName: ev.organizer.displayName,
        self: ev.organizer.self,
      } : undefined,
      attendees: ev.attendees?.map((a: any) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus,
      })),
      colorId: ev.colorId,
    }));
}

// ---------------------------------------------------------------------------
// 7. Free / Busy
// ---------------------------------------------------------------------------

/**
 * Query free/busy information for a calendar within a time range.
 */
export async function getFreeBusy(
  refreshToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<BusyPeriod[]> {
  const accessToken = await getAccessToken(refreshToken);

  const res = await fetch(`${GOOGLE_API_BASE}/freeBusy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('Google getFreeBusy failed:', res.status, errBody);
    throw new Error(`Failed to get free/busy info: ${res.statusText}`);
  }

  const data = await res.json();
  const calendarBusy = data.calendars?.[calendarId]?.busy || [];

  return calendarBusy.map((slot: any) => ({
    start: slot.start,
    end: slot.end,
  }));
}
