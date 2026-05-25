import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      },
    },
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
