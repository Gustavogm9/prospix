export type LoginProfile = {
  role: 'OWNER' | 'ASSISTANT' | 'ADMIN' | 'GUILDS_ADMIN';
  tenant_id: string | null;
};

export type LoginTarget =
  | { surface: 'admin'; path: '/admin' }
  | { surface: 'tenant'; path: '/inicio' };

export function resolveLoginTarget(profile: LoginProfile): LoginTarget {
  if (profile.role === 'GUILDS_ADMIN') {
    return { surface: 'admin', path: '/admin' };
  }

  if (!profile.tenant_id) {
    throw new Error('Usuário sem corretora vinculada. Contate o suporte.');
  }

  return { surface: 'tenant', path: '/inicio' };
}
