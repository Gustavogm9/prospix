import { test, expect } from '@playwright/test';

/**
 * Smoke admin · pos-login com mock de token + tenants list mockada.
 *
 * Estrategia identica a web/dashboard-postlogin.spec.ts:
 *  - injeta `prospix-admin-auth-storage` em localStorage
 *  - intercepta /v1/admin/tenants e devolve fixture
 */
const MOCK_ADMIN_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJndWlsZHMtYWRtaW4ifQ.eyJzaWduYXR1cmUtbW9jay1mb3ItZTJlIn0=';

const adminAuthState = {
  state: {
    adminToken: MOCK_ADMIN_TOKEN,
    adminUser: {
      id: '99999999-9999-9999-9999-999999999999',
      name: 'Gustavo Macedo',
      email: 'gustavo.macedo@guilds.com.br',
      role: 'GUILDS_ADMIN',
    },
  },
  version: 0,
};

test.describe('Admin · dashboard pos-login (mocked)', () => {
  test.beforeEach(async ({ context, page }) => {
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
              },
            ],
          }),
        });
      }

      if (pathname.endsWith('/admin/usage/consolidated')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { mrr_total: 49000, tokens_consumed_total: 1420000 } }),
        });
      }

      // Catch-all
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });
  });

  test('admin dashboard renderiza com tenant mockado', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    // Algum sinal de UI logada (sidebar/topbar/admin)
    await expect(page.locator('body')).toContainText(/tenant|admin|guilds|dashboard/i);

    const realErrors = consoleErrors.filter(
      (e) => !/favicon|hmr|sourcemap|websocket|hot-?reload/i.test(e),
    );
    expect(realErrors, `console errors: ${realErrors.join('\n')}`).toEqual([]);
  });
});
