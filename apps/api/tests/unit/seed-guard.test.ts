import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function createPrismaMock() {
  return {
    $executeRawUnsafe: vi.fn(),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

let prismaMock: ReturnType<typeof createPrismaMock>;

function setEnv(env: Record<string, string>) {
  process.env = { ...env } as NodeJS.ProcessEnv;
}

function loggedErrors() {
  return vi.mocked(console.error).mock.calls.map((call) => call.join(' ')).join('\n');
}

async function importSeedScript(env: Record<string, string>) {
  vi.resetModules();

  prismaMock = createPrismaMock();
  vi.doMock('@prisma/client', () => ({
    PrismaClient: vi.fn(() => prismaMock),
  }));

  setEnv(env);
  await import('../../prisma/seed.js');
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
}

describe('database seed guard', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unmock('@prisma/client');
  });

  it.each(['staging', 'production'] as const)('refuses to seed %s before truncating tables', async (nodeEnv) => {
    await importSeedScript({
      NODE_ENV: nodeEnv,
      ALLOW_DESTRUCTIVE_SEED: '1',
      SEED_ADMIN_PASSWORD: 'strong-admin-password',
    });

    expect(loggedErrors()).toContain(`Refusing to seed a ${nodeEnv} database.`);
    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('refuses to seed development without the destructive seed flag', async () => {
    await importSeedScript({
      NODE_ENV: 'development',
      SEED_ADMIN_PASSWORD: 'strong-admin-password',
    });

    expect(loggedErrors()).toContain('Refusing to seed without ALLOW_DESTRUCTIVE_SEED=1');
    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('refuses to seed development without a strong seed admin password', async () => {
    await importSeedScript({
      NODE_ENV: 'development',
      ALLOW_DESTRUCTIVE_SEED: '1',
      SEED_ADMIN_PASSWORD: 'short',
    });

    expect(loggedErrors()).toContain('SEED_ADMIN_PASSWORD with at least 12 characters is required');
    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
