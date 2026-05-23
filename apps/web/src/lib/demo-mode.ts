const demoModeFlag = String(import.meta.env.VITE_DEMO_MODE ?? import.meta.env.VITE_ENABLE_DEMO_MOCKS ?? '').toLowerCase();

export const canUseMockFallbacks =
  import.meta.env.DEV ||
  demoModeFlag === 'true' ||
  demoModeFlag === '1' ||
  demoModeFlag === 'demo';
