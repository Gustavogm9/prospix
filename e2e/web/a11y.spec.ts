import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11y smoke · painel web (AUD-P3-035).
 * Cobre login publico (sem auth) + dashboard pos-login mockado.
 */
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

const MOCK_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MOCK_OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MOCK_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtb2NrIn0.eyJzaWduYXR1cmUtbW9jay1mb3ItZTJlIn0=';
const authState = {
  state: {
    accessToken: MOCK_JWT,
    refreshToken: 'mock-refresh',
    tenantId: MOCK_TENANT_ID,
    user: {
      id: MOCK_OWNER_ID,
      name: 'Giovane Carrara',
      email: 'giovane@seed.prospix.dev',
      role: 'OWNER',
      tenant_id: MOCK_TENANT_ID,
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

test.describe('Web · A11y (AUD-P3-035)', () => {
  test('login publico sem violacoes critical/serious', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

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
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    const { blocking } = await runAxe(page, 'web/dashboard');
    expect(blocking).toHaveLength(0);
  });
});
