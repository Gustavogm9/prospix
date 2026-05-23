import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config · smoke E2E do Prospix.
 *
 * Cobertura inicial: as 3 superficies publicas (landing, web /login, admin /login).
 * Smoke pos-login com mock de JWT vira em fase 2 do mesmo escopo
 * (ver docs/agents/frente-e-frontend.md "Smoke E2E").
 *
 * Cada app tem seu proprio dev server espinhado em paralelo:
 *  - landing: Next.js em :3001
 *  - web: Vite em :5173
 *  - admin: Vite em :5174
 *
 * Em CI, browsers Chromium sao instalados via `pnpm exec playwright install`.
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: isCI
    ? [['list'], ['junit', { outputFile: 'e2e-results.junit.xml' }]]
    : [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'landing',
      testMatch: /e2e\/landing\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3001',
      },
    },
    {
      name: 'web',
      testMatch: /e2e\/web\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'admin',
      testMatch: /e2e\/admin\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5174',
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @prospix/landing dev',
      url: 'http://localhost:3001',
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @prospix/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @prospix/admin dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
