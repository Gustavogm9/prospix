import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'api');
const adminApiRoot = join(apiRoot, 'admin');

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

describe('contrato de autenticação das APIs administrativas', () => {
  it('usa uma única implementação de requireAdmin', () => {
    const shared = readFileSync(join(apiRoot, '_lib', 'auth.ts'), 'utf8');
    const compatibilityModule = readFileSync(join(adminApiRoot, '_lib', 'auth.ts'), 'utf8');

    expect(shared).toMatch(/export async function requireAdmin/);
    expect(compatibilityModule).not.toMatch(/function requireAdmin/);
    expect(compatibilityModule).toContain("from '../../_lib/auth'");
  });

  it('interrompe todo handler quando requireAdmin devolve NextResponse', () => {
    const guardedRoutes = routeFiles(adminApiRoot)
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => source.includes('requireAdmin(request)'));

    expect(guardedRoutes.length).toBeGreaterThan(0);

    for (const { path, source } of guardedRoutes) {
      const calls = source.match(/const auth = await requireAdmin\(request\);/g) ?? [];
      const guards = source.match(/if \(auth instanceof NextResponse\) return auth;/g) ?? [];

      expect(source, path).not.toMatch(/['"]error['"]\s+in\s+auth/);
      expect(guards.length, path).toBe(calls.length);
    }
  });
});
