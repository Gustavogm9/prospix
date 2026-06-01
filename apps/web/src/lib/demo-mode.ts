const demoModeFlag = String(process.env.NEXT_PUBLIC_DEMO_MODE ?? '').toLowerCase();
const wantsDemoMode =
  demoModeFlag === 'true' ||
  demoModeFlag === '1' ||
  demoModeFlag === 'demo';

if (process.env.NODE_ENV === 'production' && wantsDemoMode) {
  throw new Error('Demo/mock fallbacks cannot be enabled in production builds.');
}

export const canUseMockFallbacks =
  process.env.NODE_ENV === 'development' ||
  (process.env.NODE_ENV !== 'production' && wantsDemoMode);
