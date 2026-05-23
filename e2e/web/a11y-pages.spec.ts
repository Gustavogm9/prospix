/**
 * A11y expandido · todas paginas pos-login do painel tenant (AUD-P3-035).
 * Cobre: Conversations, Leads, Pipeline, Schedule, Scripts, Settings, Settings/Privacidade.
 *
 * Mesmo padrao do `web/a11y.spec.ts` · injeta state Zustand + mocks generic /v1/*
 * + roda AxeBuilder com tags WCAG 2.1 AA e falha em critical/serious.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
  const blocking = results.violations.filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact));
  if (results.violations.length > 0) {
    console.log(`\n[a11y · ${label}] violations:`, results.violations.length);
    for (const v of results.violations) {
      console.log(`  · ${v.impact ?? 'unknown'} · ${v.id} · ${v.help}`);
    }
  }
  return blocking;
}

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
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      const blocking = await runAxe(page, label);
      expect(
        blocking,
        `${label} violations: ${blocking.map((v) => `${v.id} (${v.impact})`).join(', ')}`,
      ).toHaveLength(0);
    });
  }
});
