import { test, expect } from '@playwright/test';

/**
 * Smoke web · /login publico.
 * Form renderiza, validacao basica reage, submit faz POST /v1/auth/login.
 *
 * Mock da API: intercepta /v1/auth/login e retorna 200.
 */
test.describe('Web · /login publico', () => {
  test('form de login renderiza sem console error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(400);

    // Espera-se um campo de e-mail e um botao de submit
    await expect(page.locator('body')).toContainText(/e-?mail|senha|acesso|prospix/i);

    // Permite carregar widgets async
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { /* networkidle timeout is non-fatal for smoke tests */ });

    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('submit do login chama POST /v1/auth/login', async ({ page }) => {
    let loginRequested = false;

    await page.route('**/v1/auth/login', async (route) => {
      loginRequested = true;
      let body: unknown = null;
      try {
        body = route.request().postDataJSON();
      } catch {
        body = null;
      }
      expect(body).not.toBeNull();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'test-user-id',
            tenant_id: 'test-tenant-id',
            name: 'Test User',
            email: 'test@test.com',
            role: 'OWNER',
          },
          must_change_password: false,
        }),
      });
    });

    await page.goto('/login');

    // Input de e-mail
    const emailInput = page
      .locator('input[type="email"]')
      .first();
    await expect(emailInput).toBeVisible({ timeout: 5_000 });
    await emailInput.fill('test@corretora.com.br');

    // Input de senha
    const passwordInput = page
      .locator('input[type="password"]')
      .first();
    await expect(passwordInput).toBeVisible({ timeout: 5_000 });
    await passwordInput.fill('password123');

    const submitButton = page.getByRole('button', { name: /entrar|acessar|login|continuar/i });
    await submitButton.click();

    // Aguarda o request ter sido feito
    await expect.poll(() => loginRequested, { timeout: 5_000 }).toBe(true);
  });
});
