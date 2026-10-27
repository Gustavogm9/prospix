import { test, expect } from '@playwright/test';

const admin = {
  id: '99999999-9999-9999-9999-999999999999',
  name: 'Gustavo Teste',
  email: 'admin@example.test',
  role: 'GUILDS_ADMIN',
};

test('cabeçalho admin não corta texto em larguras intermediárias', async ({ context, page }) => {
  await context.addInitScript((user) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    window.sessionStorage.setItem('prospix-admin-supabase-auth', JSON.stringify({
      access_token: 'mock-admin-access-token',
      refresh_token: 'mock-admin-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: {
        id: user.id,
        email: user.email,
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
      },
    }));
  }, admin);

  await page.route('**/rest/v1/users*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([admin]) });
  });
  await page.route('**/v1/admin/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });

  await page.setViewportSize({ width: 768, height: 812 });
  await page.goto('/admin');
  const header = page.locator('header').first();
  await expect(header).toBeVisible();
  await expect(header.getByRole('searchbox', { name: 'Busca universal' })).toBeVisible();

  for (const width of [320, 375, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    const metrics = await header.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const greeting = element.querySelector('h2')?.parentElement;
      const greetingBounds = greeting?.getBoundingClientRect();
      const greetingVisible = greeting && window.getComputedStyle(greeting).display !== 'none';
      return {
        overflow: element.scrollWidth > element.clientWidth + 1,
        greetingClipped: Boolean(greetingVisible && greetingBounds && (
          greetingBounds.top < bounds.top - 1 || greetingBounds.bottom > bounds.bottom + 1
        )),
      };
    });
    expect(metrics.overflow, `header transborda em ${width}px`).toBe(false);
    expect(metrics.greetingClipped, `saudação é cortada em ${width}px`).toBe(false);
  }
});
