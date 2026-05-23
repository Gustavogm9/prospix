import { test, expect } from '@playwright/test';

/**
 * Smoke web · /login publico.
 * Form renderiza, validacao basica reage, submit faz POST /v1/auth/magic-link.
 *
 * Mock da API: intercepta /v1/auth/magic-link e retorna 200.
 */
test.describe('Web · /login publico', () => {
  test('form de login renderiza sem console error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(400);

    // Espera-se um campo de WhatsApp e um botao de submit
    await expect(page.locator('body')).toContainText(/whatsapp|telefone|celular/i);

    // Permite carregar widgets async
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('submit do magic link chama POST /v1/auth/magic-link', async ({ page }) => {
    let magicLinkRequested = false;

    await page.route('**/v1/auth/magic-link', async (route) => {
      magicLinkRequested = true;
      const body = await route.request().postDataJSON().catch(() => null);
      expect(body).not.toBeNull();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { sent_to: 'whatsapp', expires_in: 600 } }),
      });
    });

    await page.goto('/login');

    // Heuristica robusta: input com type tel/text rotulado como WhatsApp/Telefone
    const whatsappInput = page
      .locator('input[type="tel"], input[name*="whats" i], input[name*="phone" i], input[placeholder*="whats" i], input[placeholder*="telefone" i], input[placeholder*="55" i]')
      .first();
    await expect(whatsappInput).toBeVisible({ timeout: 5_000 });
    await whatsappInput.fill('+55 17 99876-4422');

    const submitButton = page.getByRole('button', { name: /enviar|entrar|continuar|receber/i });
    await submitButton.click();

    // Aguarda o request ter sido feito ou um indicador de "enviado" aparecer
    await expect.poll(() => magicLinkRequested, { timeout: 5_000 }).toBe(true);
  });
});
