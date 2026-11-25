import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateRequest, getSupabaseAdmin } from '../../../_lib/supabase-admin';
import { createEvent, confirmEvent } from '../../../_lib/google-calendar';
import { POST } from './route';

vi.mock('../../../_lib/supabase-admin', () => ({ authenticateRequest: vi.fn(), getSupabaseAdmin: vi.fn() }));
vi.mock('../../../_lib/google-calendar', () => ({ createEvent: vi.fn(), confirmEvent: vi.fn() }));
vi.mock('../../../../../lib/secrets', () => ({ readStoredSecret: () => 'test-refresh' }));
const request = () => new NextRequest('http://localhost/api/integrations/calendar/push-event', { method: 'POST', body: JSON.stringify({ meetingId: 'qa-meeting', sendInvite: false }) });
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), update: vi.fn(() => q),
    single: vi.fn(async () => ({ data, error })), maybeSingle: vi.fn(async () => ({ data, error })) };
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateRequest).mockResolvedValue({ tenantId: 'qa-tenant' } as any);
});
describe('confirmação de sincronização Google', () => {
  it('informa reconciliação pendente se o evento existir, mas o vínculo no banco falhar', async () => {
    const meeting = query({ id: 'qa-meeting', scheduled_for: '2026-11-20T15:00:00Z', duration_minutes: 30 });
    const secret = query({ google_oauth_refresh_encrypted: 'test-secret' });
    const update = query(null, { message: 'write failed' });
    let meetingRead = false;
    vi.mocked(getSupabaseAdmin).mockReturnValue({ from: (table: string) => {
      if (table === 'tenant_secrets') return secret;
      if (!meetingRead) { meetingRead = true; return meeting; }
      return update;
    } } as any);
    vi.mocked(createEvent).mockResolvedValue({ eventId: 'provider-receipt' });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'RECONCILIATION_REQUIRED' });
    expect(update.eq).toHaveBeenCalledWith('tenant_id', 'qa-tenant');
  });
  it('reutiliza o recibo já persistido, sem novo efeito no Google', async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue({ from: (table: string) => table === 'tenant_secrets' ? query({ google_oauth_refresh_encrypted: 'test-refresh' }) : query({ id: 'qa-meeting', google_event_id: 'already-created' }) } as any);
    vi.mocked(confirmEvent).mockResolvedValue({ eventId: 'already-created' });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ success: true, eventId: 'already-created', alreadySynced: true });
    expect(createEvent).not.toHaveBeenCalled();
    expect(confirmEvent).toHaveBeenCalledWith('test-refresh', 'primary', 'already-created');
  });
});
