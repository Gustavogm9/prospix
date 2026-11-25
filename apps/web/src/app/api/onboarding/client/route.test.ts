import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), create: vi.fn() }));
vi.mock('../../_lib/supabase-admin', () => ({ authenticateRequest: mocks.auth }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }));
vi.mock('../../../../lib/manual-lead', () => ({ createManualLead: mocks.create }));
import { POST } from './route';
const key = '11111111-1111-4111-8111-111111111111';
const body = { name: 'Contato de teste', whatsapp: '(55) 99999-1234', email: '', city: '' };
function request(data: unknown = body) {
  return new NextRequest('http://localhost/api/onboarding/client', { method: 'POST', headers: { authorization: 'Bearer fictional', 'Idempotency-Key': key }, body: JSON.stringify(data) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test');
  mocks.auth.mockResolvedValue({ tenantId: 'tenant-a', userId: 'owner-a', role: 'OWNER' });
  mocks.client.mockReturnValue({ scoped: true });
  mocks.create.mockResolvedValue({ data: { id: key }, error: null });
});
describe('cadastro do primeiro cliente', () => {
  it('recusa sessão ausente antes de gravar', async () => {
    mocks.auth.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('recusa papel fora do painel cliente', async () => {
    mocks.auth.mockResolvedValue({ tenantId: null, role: 'GUILDS_ADMIN' });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('valida e-mail no servidor e recusa tenant fornecido no corpo', async () => {
    expect((await POST(request({ ...body, email: 'invalido' }))).status).toBe(400);
    expect((await POST(request({ ...body, tenantId: 'tenant-b' }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('grava no tenant autenticado, com JWT do usuário e chave repetível', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.client).toHaveBeenCalledWith(expect.any(String), 'public-test', expect.objectContaining({ global: { headers: { Authorization: 'Bearer fictional' } } }));
    expect(mocks.create).toHaveBeenCalledWith({ scoped: true }, 'tenant-a', expect.objectContaining({ whatsapp: '5555999991234', profession: 'OTHER' }), key);
    expect(await response.json()).toEqual({ id: key });
  });
  it('não confirma sucesso se a gravação falhar', async () => {
    mocks.create.mockResolvedValue({ data: null, error: { code: 'CONFLICT' } });
    expect((await POST(request())).status).toBe(409);
  });
});
