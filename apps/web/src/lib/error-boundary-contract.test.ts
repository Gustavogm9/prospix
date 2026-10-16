import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('contrato de erro seguro', () => {
  it('não mostra mensagem interna nem stack no erro de página', () => {
    const boundary = read('src/app/error.tsx');

    expect(boundary).not.toContain('error.message');
    expect(boundary).not.toContain("console.error('Page error:', error)");
    expect(boundary).toContain("digest: error.digest ?? 'sem-referência'");
  });

  it('tem uma página 404 em português com rota de retorno', () => {
    const notFound = read('src/app/not-found.tsx');

    expect(notFound).toContain('Página não encontrada');
    expect(notFound).toContain('href="/"');
    expect(notFound).not.toMatch(/lorem|todo|em breve/i);
  });
});
