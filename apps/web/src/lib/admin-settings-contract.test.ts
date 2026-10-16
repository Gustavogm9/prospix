import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('contrato de veracidade das configurações administrativas', () => {
  it('não apresenta integrações estáticas como conectadas', () => {
    const page = read('src/app/admin/configuracoes/page.tsx');

    expect(page).not.toContain("status: 'connected'");
    expect(page).toContain("status: 'unverified'");
    expect(page).toContain('Não verificado');
  });

  it('exibe o mesmo prazo padrão usado na geração de convites', () => {
    const page = read('src/app/admin/configuracoes/page.tsx');
    const route = read('src/app/api/admin/tenants/[id]/invitations/route.ts');

    expect(route).toContain("process.env.INVITATION_CODE_TTL_DAYS || '14'");
    expect(page).toContain('14 dias');
    expect(page).not.toContain('7 dias');
  });

  it('não anuncia funcionalidade futura como se estivesse em entrega', () => {
    const page = read('src/app/admin/configuracoes/page.tsx');

    expect(page.toLocaleLowerCase('pt-BR')).not.toContain('em breve');
  });
});
