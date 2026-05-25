const demoModeFlag = String(import.meta.env.VITE_DEMO_MODE ?? import.meta.env.VITE_ENABLE_DEMO_MOCKS ?? '').toLowerCase();
const wantsDemoMode =
  demoModeFlag === 'true' ||
  demoModeFlag === '1' ||
  demoModeFlag === 'demo';

if (import.meta.env.PROD && wantsDemoMode) {
  throw new Error('Demo/mock fallbacks cannot be enabled in production builds.');
}

export const canUseMockFallbacks =
  import.meta.env.DEV ||
  (!import.meta.env.PROD && wantsDemoMode);
