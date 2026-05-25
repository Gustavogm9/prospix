import { test, expect } from '@playwright/test';

/**
 * Smoke admin · /login publico (super-admin Guilds).
 */
test.describe('Admin · login publico', () => {
  test('login admin renderiza sem console error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);

    // Espera-se um form de admin login (email + password ou similar)
    await expect(page.locator('body')).toContainText(/admin|guilds|prospix/i);

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    const realErrors = consoleErrors.filter(
      (e) => !/favicon|hmr|sourcemap|websocket|hot-?reload/i.test(e),
    );
    expect(realErrors, `console errors: ${realErrors.join('\n')}`).toEqual([]);
  });
});
