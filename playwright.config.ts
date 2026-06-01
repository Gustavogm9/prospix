import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config · smoke E2E do Prospix.
 *
 * Unified app: all 3 surfaces (landing, web dashboard, admin) run on the
 * same Next.js server at :3001.
 *
 * - Landing pages: / , /planos, /cases, /contato, etc.
 * - Web dashboard: /login, /cadastro, / (protected), /conversas, etc.
 * - Admin panel: /admin/login, /admin/ (protected), /admin/tenants, etc.
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
    baseURL: 'http://localhost:3001',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'landing',
      testMatch: /e2e\/landing\/.*\.spec\.ts/,
    },
    {
      name: 'web',
      testMatch: /e2e\/web\/.*\.spec\.ts/,
    },
    {
      name: 'admin',
      testMatch: /e2e\/admin\/.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'pnpm --filter @prospix/web dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
