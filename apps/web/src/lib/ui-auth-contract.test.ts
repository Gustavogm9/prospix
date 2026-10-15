import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8');

describe('contrato de revalidação de perfis na interface', () => {
  it('não autoriza o painel administrativo por user_metadata', () => {
    const layout = source('app/admin/layout.tsx');
    const store = source('store/admin-auth-store.ts');

    expect(layout).not.toContain('user_metadata');
    expect(layout).not.toMatch(/role:\s*meta\?\.role\s*\|\|/);
    expect(layout).toContain('initializeFromSupabase');
    expect(store).toContain("select('id, name, email, role, deleted_at')");
    expect(store).toContain("userData.role !== 'GUILDS_ADMIN'");
  });

  it('revalida vínculo, exclusão e perfil do usuário comum no banco', () => {
    const layout = source('app/(dashboard)/layout.tsx');
    const store = source('store/auth-store.ts');

    expect(layout).toContain('initializeFromSupabase');
    expect(store).toContain('tenant_id, name, email, role, deleted_at');
    expect(store).toContain('!userData.tenant_id');
    expect(store).toContain('userData.deleted_at');
  });
});
