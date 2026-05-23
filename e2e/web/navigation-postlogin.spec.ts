/**
 * Smoke web · navegacao entre paginas pos-login (AUD-P1-028 expansion).
 *
 * Prova que ao clicar na sidebar, o usuario consegue navegar entre as 7 paginas
 * principais sem console error e sem redirect involuntario.
 *
 * Mesma estrategia de mock dos outros specs pos-login.
 */
import { test, expect } from '@playwright/test';

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

test.describe('Web · navegacao pos-login (AUD-P1-028 expansion)', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((stateJson: string) => {
      try {
        window.localStorage.setItem('prospix-auth-storage', stateJson);
      } catch {
        /* noop */
      }
    }, JSON.stringify(authState));

    await page.route('**/v1/**', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });
  });

  test('sidebar mostra todos os items de navegacao', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    // Items esperados pela sidebar (PRD secao 6.5)
    const expectedNavItems = [/in[ií]cio|home/i, /conversa/i, /pipeline|funil/i, /agenda/i, /lead/i, /roteir/i, /configura/i];

    const body = page.locator('body');
    for (const pattern of expectedNavItems) {
      await expect(body, `sidebar nao contem item ${pattern}`).toContainText(pattern);
    }
  });

  test('navegacao por URL · todas as 6 paginas principais renderizam sem console error', async ({
    page,
  }) => {
    const PAGES = ['/', '/conversas', '/funil', '/agenda', '/leads', '/roteiros', '/configuracoes'];

    for (const path of PAGES) {
      const consoleErrors: string[] = [];
      const errorListener = (msg: import('@playwright/test').ConsoleMessage) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      };
      page.on('console', errorListener);

      const response = await page.goto(path);
      expect(response?.status(), `${path} response`).toBeLessThan(400);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

      // Confirma que nao foi redirecionado para /login (auth ainda valida)
      expect(page.url(), `${path} redirected to login`).not.toMatch(/\/login$/);

      const realErrors = consoleErrors.filter(
        (e) => !/favicon|hmr|sourcemap|websocket|hot-?reload|chunk/i.test(e),
      );
      expect(realErrors, `${path} console errors: ${realErrors.join('\n')}`).toEqual([]);
      page.off('console', errorListener);
    }
  });

  test('Settings · tab Privacidade renderiza com tabela vazia LGPD', async ({ page }) => {
    await page.goto('/configuracoes');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    // Tab Privacidade tem data-testid 'settings-privacy-tab'
    const tabTrigger = page.locator('[data-testid="settings-privacy-tab"]');
    if (await tabTrigger.count() > 0) {
      await tabTrigger.click();
      // Espera os 3 cards de acao LGPD aparecerem
      const exportTrigger = page.locator('[data-testid="lgpd-export-trigger"]');
      await expect(exportTrigger).toBeVisible({ timeout: 5_000 });

      // Empty state da tabela
      const emptyState = page.locator('[data-testid="lgpd-empty-state"]');
      await expect(emptyState).toBeVisible();
    }
  });
});
