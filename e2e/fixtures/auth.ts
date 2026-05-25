/**
 * Shared E2E auth fixtures for mock authentication state.
 *
 * Consolidates duplicated mock auth objects (authState, adminAuthState)
 * and the common API route handler setup used across multiple E2E specs.
 *
 * L-16 audit finding.
 */
import type { BrowserContext, Page, Route } from '@playwright/test';

// ── Mock tokens ─────────────────────────────────────────────────────────────

export const MOCK_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtb2NrIn0.eyJzaWduYXR1cmUtbW9jay1mb3ItZTJlIn0=';

export const MOCK_ADMIN_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJndWlsZHMtYWRtaW4ifQ.eyJzaWduYXR1cmUtbW9jay1mb3ItZTJlIn0=';

export const MOCK_TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const MOCK_OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── Web (tenant) auth state ─────────────────────────────────────────────────

export const authState = {
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

// ── Admin (super-admin) auth state ──────────────────────────────────────────

export const adminAuthState = {
  state: {
    adminToken: MOCK_ADMIN_TOKEN,
    adminUser: {
      id: '99999999-9999-9999-9999-999999999999',
      name: 'Gustavo Macedo',
      email: 'gustavo.macedo@guilds.com.br',
      role: 'GUILDS_ADMIN',
    },
  },
  version: 0,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Inject the web tenant auth state into localStorage before navigation.
 */
export async function injectWebAuth(context: BrowserContext) {
  await context.addInitScript((stateJson: string) => {
    try {
      window.localStorage.setItem('prospix-auth-storage', stateJson);
    } catch {
      /* noop */
    }
  }, JSON.stringify(authState));
}

/**
 * Inject the admin auth state into localStorage before navigation.
 */
export async function injectAdminAuth(context: BrowserContext) {
  await context.addInitScript((stateJson: string) => {
    try {
      window.localStorage.setItem('prospix-admin-auth-storage', stateJson);
    } catch {
      /* noop */
    }
  }, JSON.stringify(adminAuthState));
}

/**
 * Generic catch-all API mock for /v1/** routes.
 * Returns { data: [] } for any unmatched route, preventing 4xx errors.
 */
export async function mockApiCatchAll(page: Page) {
  await page.route('**/v1/**', async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
}
