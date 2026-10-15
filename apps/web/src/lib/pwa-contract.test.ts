import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('contrato PWA', () => {
  it('registra o service worker no layout raiz', () => {
    expect(read('src/app/layout.tsx')).toContain('<ServiceWorkerRegistrar />');
    expect(read('src/components/ServiceWorkerRegistrar.tsx')).toContain("register('/sw.js'");
  });

  it('usa uma página offline explícita sem cachear páginas autenticadas', () => {
    const worker = read('public/sw.js');
    expect(worker).toContain("'/offline'");
    expect(worker).not.toContain("caches.match('/')");
    expect(worker).toContain("event.data?.type === 'SKIP_WAITING'");
  });

  it('não promete fila ou sincronização offline que não existe', () => {
    const mobilePage = read('src/app/(dashboard)/app-mobile/page.tsx');
    expect(mobilePage).not.toContain('sincroniza quando voltar online');
  });
});
