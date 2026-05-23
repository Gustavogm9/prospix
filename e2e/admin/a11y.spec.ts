import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11y smoke · super-admin Guilds (AUD-P3-035).
 * Login publico + dashboard pos-login mockado (Tenants list).
 */
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

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

async function runAxe(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact && BLOCKING_IMPACTS.has(v.impact),
  );

  if (results.violations.length > 0) {
    console.log(`\n[a11y · ${label}] total violations:`, results.violations.length);
    for (const v of results.violations) {
      console.log(`  · ${v.impact ?? 'unknown'} · ${v.id} · ${v.help}`);
    }
  }

  return { blocking, all: results.violations };
}

test.describe('Admin · A11y (AUD-P3-035)', () => {
  test('login publico sem violacoes critical/serious', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

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

    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    const { blocking } = await runAxe(page, 'admin/tenants');
    expect(blocking).toHaveLength(0);
  });
});
