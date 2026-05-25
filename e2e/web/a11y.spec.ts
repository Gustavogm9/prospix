import { test, expect } from '@playwright/test';
import { authState } from '../fixtures/auth';
import { runAxe } from '../helpers/axe';

/**
 * A11y smoke · painel web (AUD-P3-035).
 * Cobre login publico (sem auth) + dashboard pos-login mockado.
 */
/* Auth state and axe helper imported from shared fixtures (L-16, L-17) */



test.describe('Web · A11y (AUD-P3-035)', () => {
  test('login publico sem violacoes critical/serious', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    const { blocking } = await runAxe(page, 'web/login');
    expect(blocking).toHaveLength(0);
  });

  test('dashboard pos-login (mocked) sem violacoes critical/serious', async ({
    context,
    page,
  }) => {
    await context.addInitScript((stateJson: string) => {
      try {
        window.localStorage.setItem('prospix-auth-storage', stateJson);
      } catch {
        /* noop */
      }
    }, JSON.stringify(authState));

    await page.route('**/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      if (pathname.endsWith('/dashboard/today')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              meetings_today: 3,
              conversations_ready: 12,
              need_callback: 1,
              new_leads_today: 248,
              next_meeting: null,
            },
          }),
        });
      }
      if (pathname.endsWith('/dashboard/funnel')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              captured: 1847,
              whatsapp_valid: 1773,
              sent: 1243,
              responded: 348,
              qualified: 89,
              scheduled: 23,
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    const { blocking } = await runAxe(page, 'web/dashboard');
    expect(blocking).toHaveLength(0);
  });
});
