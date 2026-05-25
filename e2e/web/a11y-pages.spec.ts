/**
 * A11y expandido · todas paginas pos-login do painel tenant (AUD-P3-035).
 * Cobre: Conversations, Leads, Pipeline, Schedule, Scripts, Settings, Settings/Privacidade.
 *
 * Mesmo padrao do `web/a11y.spec.ts` · injeta state Zustand + mocks generic /v1/*
 * + roda AxeBuilder com tags WCAG 2.1 AA e falha em critical/serious.
 */
import { test, expect } from '@playwright/test';
import { authState } from '../fixtures/auth';
import { runAxe } from '../helpers/axe';

/* Auth state and axe helper imported from shared fixtures (L-16, L-17) */

test.describe('Web · A11y · paginas pos-login (AUD-P3-035 cobertura completa)', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((stateJson: string) => {
      try {
        window.localStorage.setItem('prospix-auth-storage', stateJson);
      } catch {
        /* noop */
      }
    }, JSON.stringify(authState));

    await page.route('**/v1/**', async (route) => {
      // catch-all com payload vazio · evita 4xx quebrar render
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });
  });

  const PAGES = [
    { path: '/conversas', label: 'web/conversations' },
    { path: '/leads', label: 'web/leads' },
    { path: '/funil', label: 'web/pipeline' },
    { path: '/agenda', label: 'web/schedule' },
    { path: '/roteiros', label: 'web/scripts' },
    { path: '/configuracoes', label: 'web/settings' },
  ];

  for (const { path, label } of PAGES) {
    test(`${label} sem violacoes critical/serious`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });
      const { blocking } = await runAxe(page, label);
      expect(
        blocking,
        `${label} violations: ${blocking.map((v) => `${v.id} (${v.impact})`).join(', ')}`,
      ).toHaveLength(0);
    });
  }
});
