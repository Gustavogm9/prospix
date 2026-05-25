import { test, expect } from '@playwright/test';
import { runAxe } from '../helpers/axe';

/**
 * A11y smoke · landing publica (AUD-P3-035).
 *
 * Politica:
 *  - falha em `critical` e `serious` (WCAG 2.1 AA bloqueante)
 *  - reporta `moderate` e `minor` no console mas nao falha (polish incremental)
 *
 * Cobertura: home, planos, paginas legais (termos, privacidade, lgpd).
 */
/* runAxe imported from shared helper (L-17) */

test.describe('Landing · A11y (AUD-P3-035)', () => {
  test('home sem violacoes critical/serious', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    const { blocking } = await runAxe(page, 'landing/');
    expect(
      blocking,
      `blocking a11y violations: ${blocking.map((v) => `${v.id} (${v.impact})`).join(', ')}`,
    ).toHaveLength(0);
  });

  test('/planos sem violacoes critical/serious', async ({ page }) => {
    await page.goto('/planos');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    const { blocking } = await runAxe(page, 'landing/planos');
    expect(blocking).toHaveLength(0);
  });

  test('paginas legais sem violacoes critical/serious', async ({ page }) => {
    for (const path of ['/termos', '/privacidade', '/lgpd']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });
      const { blocking } = await runAxe(page, `landing${path}`);
      expect(
        blocking,
        `blocking violations on ${path}: ${blocking.map((v) => v.id).join(', ')}`,
      ).toHaveLength(0);
    }
  });
});
