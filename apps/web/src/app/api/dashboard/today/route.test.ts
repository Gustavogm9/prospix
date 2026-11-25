import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';
import { GET } from './route';
vi.mock('../../_lib/supabase-admin', () => ({ authenticateRequest: vi.fn(), supabaseAdmin: { from: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function query(result: unknown) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), gte: vi.fn(() => q), lt: vi.fn(() => q),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  return q;
}
describe('contadores do dia', () => {
  it('falha explicitamente quando o banco falha em vez de inventar zero', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ tenantId: 'qa' } as any);
    vi.mocked(supabaseAdmin.from).mockReturnValue(query({ count: null, error: { message: 'unavailable' } }) as any);
    expect((await GET(new NextRequest('http://localhost/api/dashboard/today'))).status).toBe(503);
  });
  it('delimita hoje no Brasil quando o servidor já está no dia seguinte', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-20T01:00:00Z'));
    vi.mocked(authenticateRequest).mockResolvedValue({ tenantId: 'qa' } as any);
    const q = query({ count: 2, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as any);
    const response = await GET(new NextRequest('http://localhost/api/dashboard/today'));
    expect(response.status).toBe(200);
    expect(q.gte).toHaveBeenCalledWith('created_at', '2026-11-19T03:00:00.000Z');
    expect(q.lt).toHaveBeenCalledWith('created_at', '2026-11-20T03:00:00.000Z');
  });
});
