import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf8');

describe('cabeçalhos de segurança', () => {
  it.each([
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Frame-Options',
  ])('configura %s', (header) => {
    expect(config).toContain(header);
  });

  it('restringe framing, objetos, origem base e formulários na CSP', () => {
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("object-src 'none'");
    expect(config).toContain("base-uri 'self'");
    expect(config).toContain("form-action 'self'");
  });

  it('impede cache persistente do service worker', () => {
    expect(config).toContain("source: '/sw.js'");
    expect(config).toContain('no-cache, no-store, must-revalidate');
  });
});
