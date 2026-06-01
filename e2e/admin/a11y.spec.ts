import { test, expect } from '@playwright/test';
import { adminAuthState } from '../fixtures/auth';
import { runAxe } from '../helpers/axe';

/**
 * A11y smoke · super-admin Guilds (AUD-P3-035).
 * Login publico + dashboard pos-login mockado (Tenants list).
 */
/* Auth state and axe helper imported from shared fixtures (L-16, L-17) */



test.describe('Admin · A11y (AUD-P3-035)', () => {
  test('login publico sem violacoes critical/serious', async ({ page }) => {
    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    const { blocking } = await runAxe(page, 'admin/login');
    expect(blocking).toHaveLength(0);
  });

  test('tenants list pos-login (mocked) sem violacoes critical/serious', async ({
    context,
    page,
  }) => {
    await context.addInitScript((stateJson: string) => {
      try {
        window.localStorage.setItem('prospix-admin-auth-storage', stateJson);
      } catch {
        /* noop */
      }
    }, JSON.stringify(adminAuthState));

    await page.route('**/v1/admin/**', async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      if (pathname.endsWith('/admin/tenants') && route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                slug: 'giovane-metlife',
                name: 'Giovane Carrara · MetLife · SJRP',
                status: 'ACTIVE',
                plan: 'STANDARD',
                mrrCents: 49000,
                users: [
                  {
                    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    name: 'Giovane',
                    whatsapp: '+5517999990001',
                  },
                ],
              },
            ],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto('/admin');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    const { blocking } = await runAxe(page, 'admin/tenants');
    expect(blocking).toHaveLength(0);
  });
});
