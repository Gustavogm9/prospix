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
    initialized: true,
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
 * Also marks `initialized: true` so the dashboard layout skips the
 * Supabase session check.
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
 * Mock Supabase auth endpoints so that `supabase.auth.getSession()` returns
 * a valid session during E2E tests (avoids clearSession redirect to /login).
 */
export async function mockSupabaseAuth(page: Page) {
  // Mock the Supabase token refresh endpoint
  await page.route('**/auth/v1/token**', async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: MOCK_JWT,
        refresh_token: 'mock-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: MOCK_OWNER_ID,
          email: 'giovane@seed.prospix.dev',
          role: 'authenticated',
          aud: 'authenticated',
        },
      }),
    });
  });

  // Mock the Supabase user endpoint
  await page.route('**/auth/v1/user**', async (route: Route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: MOCK_OWNER_ID,
        email: 'giovane@seed.prospix.dev',
        role: 'authenticated',
        aud: 'authenticated',
      }),
    });
  });
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
