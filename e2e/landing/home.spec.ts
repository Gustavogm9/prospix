import { test, expect } from '@playwright/test';

/**
 * Smoke landing · prospix.com.br (Next.js).
 * Validacao basica de renderizacao + navegacao publica.
 * Sem console error, sem 404, sem campos vazios chave.
 */
test.describe('Landing · smoke publico', () => {
  test('home renderiza sem console error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);

    // Hero + nome do produto presentes
    await expect(page.locator('body')).toContainText(/prospix/i);

    // Navegacao basica (algum link interno deve existir)
    const internalLinks = page.locator('a[href^="/"]');
    expect(await internalLinks.count()).toBeGreaterThan(0);

    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('pagina de planos responde', async ({ page }) => {
    const response = await page.goto('/planos');
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(/plan/i);
  });

  test('paginas legais publicadas (termos, privacidade, lgpd)', async ({ page }) => {
    for (const path of ['/termos', '/privacidade', '/lgpd']) {
      const response = await page.goto(path);
      expect(response?.status(), `falha em ${path}`).toBeLessThan(400);
    }
  });
});
