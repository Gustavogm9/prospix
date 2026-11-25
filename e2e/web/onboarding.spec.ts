import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { authState, MOCK_OWNER_ID, MOCK_TENANT_ID } from '../fixtures/auth';

test.describe('Primeiros passos · dados fictícios e rede interceptada', () => {
  test.describe.configure({ timeout: 90_000 });
  let connected = false;
  let unavailable = false;
  let saveSuccess = false;
  let created = false;
  let icpSaved = false;
  let contextSaved = false;
  let scriptSaved = false;
  let posts: string[];
  test.beforeEach(async ({ context, page }) => {
    connected = false; unavailable = false; saveSuccess = false; created = false; icpSaved = false; contextSaved = false; scriptSaved = false; posts = [];
    await page.routeWebSocket('**', socket => socket.close());
    await context.addInitScript(({ state, ownerId }) => {
      localStorage.setItem('prospix-auth-storage', JSON.stringify(state));
      localStorage.setItem('prospix-supabase-auth', JSON.stringify({ access_token: 'mock-user-access-token', refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: ownerId, aud: 'authenticated', role: 'authenticated' } }));
      localStorage.setItem('prospix-onboarding-state-v1', JSON.stringify({ dismissed: true, completed: { whatsapp: true, firstLead: true, agenda: true, firstScript: true } }));
    }, { state: authState, ownerId: MOCK_OWNER_ID });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.includes('/rest/v1/')) {
        const count = (created && url.pathname.endsWith('/leads')) || (icpSaved && url.pathname.endsWith('/icps')) || (scriptSaved && url.pathname.endsWith('/scripts')) ? 1 : 0;
        return route.fulfill({ status: 200, headers: { 'content-range': `*/${count}`, 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'content-range' }, json: url.pathname.endsWith('/tenant_business_context') ? contextSaved ? { persona_name: 'Assistente', business_description: 'Empresa fictícia', tone_of_voice: 'Consultivo' } : null : [] });
      }
      if (url.pathname.includes('/auth/v1/')) return route.fulfill({ status: 200, json: { id: MOCK_OWNER_ID, aud: 'authenticated', role: 'authenticated' } });
      if (url.pathname === '/api/integrations/whatsapp/status') return route.fulfill({ status: 200, json: { status: unavailable ? 'unavailable' : connected ? 'connected' : 'disconnected' } });
      if (url.pathname === '/api/onboarding/client') {
        posts.push(request.headers()['idempotency-key']);
        if (saveSuccess) { created = true; return route.fulfill({ status: 200, json: { id: posts[posts.length - 1] } }); }
        return route.fulfill({ status: 503, json: { erro: { mensagem: 'Não foi possível confirmar o cadastro.' } } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, json: {} });
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
  });

  async function login(page: Page) {
    const profile = { ...authState.state.user, name: 'Cliente de teste', email: 'cliente@example.test', deleted_at: null };
    await page.route('**/rest/v1/users*', route => route.fulfill({ status: 200, json: profile }));
    await page.route('**/auth/v1/token*', route => route.fulfill({ status: 200, json: {
      access_token: 'mock-user-access-token', refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600,
      user: { id: MOCK_OWNER_ID, email: profile.email, aud: 'authenticated', role: 'authenticated', user_metadata: {} },
    } }));
    await page.goto('/login');
    const ownKey = `prospix-onboarding:v2:${MOCK_TENANT_ID}:${MOCK_OWNER_ID}`;
    const otherKey = 'prospix-onboarding:v2:outra-organizacao:outra-pessoa';
    await page.evaluate(({ ownKey, otherKey }) => {
      localStorage.setItem(ownKey, 'minimized');
      localStorage.setItem(otherKey, 'minimized');
    }, { ownKey, otherKey });
    await page.locator('input[type=email]').fill(profile.email);
    await page.locator('input[type=password]').fill('fictional-test-password');
    await page.getByRole('button', { name: 'Entrar no Prospix' }).click();
    await expect(page).toHaveURL(/\/inicio$/);
  }

  test('começa pelo WhatsApp, ignora marcação antiga e avança após confirmar conexão', async ({ page }) => {
    await page.goto('/inicio');
    await expect(page.getByRole('link', { name: 'Conectar WhatsApp' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cadastrar cliente', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sua máquina de prospecção autônoma.' })).toHaveCount(0);
    connected = true;
    await page.getByRole('button', { name: 'Conferir etapas' }).click();
    await expect(page.getByRole('link', { name: 'Cadastrar cliente', exact: true })).toBeVisible();
    unavailable = true;
    await page.getByRole('button', { name: 'Conferir etapas' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível confirmar' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cadastrar cliente', exact: true })).toHaveCount(0);
  });

  test('valida campos, preserva rascunho e reutiliza pedido após falha', async ({ page }) => {
    await page.goto('/leads/novo');
    await page.getByRole('button', { name: 'Salvar cliente e continuar' }).click();
    await expect(page.getByLabel('Nome do cliente')).toBeFocused();
    await page.getByLabel('Nome do cliente').fill('Contato fictício');
    await page.getByLabel('WhatsApp com DDD').fill('(55) 99999-1234');
    await page.getByLabel('E-mail (opcional)').fill('incorreto');
    await page.getByRole('button', { name: 'Salvar cliente e continuar' }).click();
    await expect(page.getByText('Confira o e-mail informado.')).toBeVisible();
    expect(posts).toHaveLength(0);
    await page.getByLabel('E-mail (opcional)').fill('');
    await page.getByRole('button', { name: 'Salvar cliente e continuar' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível confirmar' })).toBeVisible();
    await expect(page.getByLabel('Nome do cliente')).toHaveValue('Contato fictício');
    await page.getByRole('button', { name: 'Salvar cliente e continuar' }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[0]).toBe(posts[1]);
  });

  test('novo login reabre o guia minimizado somente da própria conta', async ({ page }) => {
    await login(page);
    const dialog = page.getByRole('dialog', { name: 'Vamos configurar sua conta' });
    await expect(dialog.getByRole('link', { name: 'Conectar WhatsApp' })).toBeVisible();
    const otherKey = 'prospix-onboarding:v2:outra-organizacao:outra-pessoa';
    expect(await page.evaluate(key => localStorage.getItem(key), otherKey)).toBe('minimized');
  });

  test('pop-up acompanha as cinco etapas confirmadas e retoma após recarregar', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('link', { name: 'Conectar WhatsApp' }).click();
    await expect(page).toHaveURL(/tab=integracoes/, { timeout: 30_000 });
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Ver próxima etapa' })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    connected = true;
    await page.evaluate(() => window.dispatchEvent(new Event('prospix-onboarding-refresh')));
    await dialog.getByRole('link', { name: 'Cadastrar cliente', exact: true }).click();
    saveSuccess = true;
    await page.getByLabel('Nome do cliente').fill('Contato fictício');
    await page.getByLabel('WhatsApp com DDD').fill('11999991234');
    await page.getByRole('button', { name: 'Salvar cliente e continuar' }).click();
    await dialog.getByRole('link', { name: 'Definir ICP' }).click();
    icpSaved = true;
    await page.evaluate(() => window.dispatchEvent(new Event('prospix-onboarding-refresh')));
    await dialog.getByRole('link', { name: 'Preencher perfil comercial' }).click();
    contextSaved = true;
    await page.evaluate(() => window.dispatchEvent(new Event('prospix-onboarding-refresh')));
    await dialog.getByRole('link', { name: 'Preparar roteiro' }).click();
    scriptSaved = true;
    await page.evaluate(() => window.dispatchEvent(new Event('prospix-onboarding-refresh')));
    await expect(page.getByRole('dialog', { name: 'Configuração inicial concluída' })).toBeVisible();
    await dialog.getByRole('link', { name: 'Ir para o painel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('dispensar o pop-up não o reabre por atualização automática', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Conectar WhatsApp' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    connected = true;
    await page.evaluate(() => window.dispatchEvent(new Event('prospix-onboarding-refresh')));
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  for (const [width, height] of [[320, 568], [375, 812], [812, 375]]) {
    test(`pop-up acessível em ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await login(page);
      const dialog = page.getByRole('dialog');
      const action = dialog.getByRole('link', { name: 'Conectar WhatsApp' });
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box && box.y + box.height <= height).toBeTruthy();
      await action.focus(); await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Fechar primeiros passos' })).toBeFocused();
      await dialog.getByRole('region', { name: 'Detalhes das etapas' }).focus();
      await page.keyboard.press('End');
      await expect(dialog.getByText('Prepare e ative seu roteiro', { exact: true })).toBeInViewport();
      const result = await new AxeBuilder({ page }).include('dialog').analyze();
      expect(result.violations.filter(issue => ['serious', 'critical'].includes(issue.impact || ''))).toEqual([]);
      await page.screenshot({ path: `.local/onboarding-qa/popup-${width}x${height}.png` });
    });
  }

  test('cadastro confirmado retorna ao guia na próxima etapa', async ({ page }) => {
    connected = true; saveSuccess = true;
    await page.goto('/leads/novo');
    await page.getByLabel('Nome do cliente').fill('Contato fictício');
    await page.getByLabel('WhatsApp com DDD').fill('11999991234');
    await page.getByRole('button', { name: 'Salvar cliente e continuar' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('link', { name: 'Definir ICP' })).toBeVisible();
    expect(posts).toHaveLength(1);
  });

  test('guia e cadastro sem violações sérias de acessibilidade', async ({ page }) => {
    for (const path of ['/onboarding', '/leads/novo']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: path === '/onboarding' ? 'Vamos preparar seu primeiro atendimento' : 'Cadastre seu primeiro cliente' })).toBeVisible();
      if (path === '/onboarding') await expect(page.getByRole('link', { name: 'Conectar WhatsApp' })).toBeVisible();
      const result = await new AxeBuilder({ page }).include('section[aria-labelledby]').analyze();
      expect(result.violations.filter(issue => ['serious', 'critical'].includes(issue.impact || ''))).toEqual([]);
    }
  });

  for (const width of [320, 390, 1280]) {
    test(`guia e formulário cabem em ${width}px`, async ({ page }) => {
      connected = true;
      await page.setViewportSize({ width, height: 812 });
      for (const path of ['/onboarding', '/leads/novo']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: path === '/onboarding' ? 'Vamos preparar seu primeiro atendimento' : 'Cadastre seu primeiro cliente' })).toBeVisible();
        if (path === '/onboarding') await expect(page.getByRole('link', { name: 'Cadastrar cliente', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (path === '/onboarding') await page.screenshot({ path: `.local/onboarding-qa/onboarding-${width}.png`, fullPage: true });
      }
    });
  }
});
