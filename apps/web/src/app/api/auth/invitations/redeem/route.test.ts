import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { getSupabaseAdmin } from '../../../_lib/supabase-admin';
import { POST } from './route';

vi.mock('../../../_lib/supabase-admin', () => ({ getSupabaseAdmin: vi.fn() }));

function singleRow(data: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return query;
}

function ownerRows(data: { id: string; email: string }[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    then: (resolve: (value: { data: typeof data; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return query;
}

describe('resgate de convite com dois OWNERs no tenant', () => {
  it('usa o perfil correspondente ao e-mail e recusa recriar uma conta já ativa', async () => {
    const invitation = singleRow({
      id: 'invite-1', tenant_id: 'tenant-1', role: 'OWNER',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null, revoked_at: null,
    });
    const tenant = singleRow({ id: 'tenant-1', status: 'ACTIVE' });
    const owners = ownerRows([
      { id: 'owner-1', email: 'primeira@empresa.com.br' },
      { id: 'owner-2', email: 'Segunda@Empresa.com.br' },
    ]);
    const getUserById = vi.fn(async () => ({ data: { user: { id: 'owner-2' } }, error: null }));
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tenant_invitations') return invitation;
        if (table === 'tenants') return tenant;
        if (table === 'users') return owners;
        throw new Error(`Tabela inesperada: ${table}`);
      }),
      auth: { admin: { getUserById } },
    } as unknown as ReturnType<typeof getSupabaseAdmin>);

    const request = new NextRequest('http://localhost/api/auth/invitations/redeem', {
      method: 'POST',
      body: JSON.stringify({
        code: 'PRSPX-ABCD-EFGH', accept_terms: true,
        user: { email: 'segunda@empresa.com.br', name: 'Segunda',
          whatsapp: '5517999999999', password: 'senha12345' },
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'INVITATION_USED' });
    expect(getUserById).toHaveBeenCalledExactlyOnceWith('owner-2');
  });
});
