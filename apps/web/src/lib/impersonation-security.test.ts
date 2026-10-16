import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('contrato de segurança da impersonificação', () => {
  it('falha de forma fechada enquanto não existe sessão segura', () => {
    const route = read('src/app/api/admin/impersonate/route.ts');

    expect(route).toContain("error: 'FEATURE_UNAVAILABLE'");
    expect(route).toContain('status: 503');
    expect(route).not.toContain('impersonationToken');
    expect(route).not.toContain("toString('base64url')");
    expect(route).not.toContain('randomBytes');
  });

  it('não transporta identidade administrativa pela URL', () => {
    const page = read('src/app/admin/impersonacao/page.tsx');

    expect(page).not.toContain('imp_token');
    expect(page).not.toContain('window.open');
    expect(page).toContain('Indisponível até ativação segura');
  });
});
