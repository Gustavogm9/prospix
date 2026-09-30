import { describe, expect, it } from 'vitest';

import { resolveLoginTarget } from './login-routing';

describe('resolveLoginTarget', () => {
  it('routes a Guilds admin to the isolated admin session and console', () => {
    expect(resolveLoginTarget({ role: 'GUILDS_ADMIN', tenant_id: null })).toEqual({
      surface: 'admin',
      path: '/admin',
    });
  });

  it.each(['OWNER', 'ASSISTANT', 'ADMIN'] as const)('routes %s to the tenant dashboard', (role) => {
    expect(
      resolveLoginTarget({
        role,
        tenant_id: '11111111-1111-1111-1111-111111111111',
      }),
    ).toEqual({
      surface: 'tenant',
      path: '/inicio',
    });
  });
});
