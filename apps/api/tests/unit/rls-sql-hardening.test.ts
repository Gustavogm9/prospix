import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(dirname(__filename), '..', '..', '..', '..');
const supabaseMigrationsDir = join(repoRoot, 'supabase', 'migrations');

describe('RLS SQL hardening audit', () => {
  it('keeps committed Supabase migration files', () => {
    expect(existsSync(supabaseMigrationsDir)).toBe(true);

    const files = readdirSync(supabaseMigrationsDir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('RLS migration defines tenant isolation policies', () => {
    const files = readdirSync(supabaseMigrationsDir).filter((f) => f.includes('rls'));
    expect(files.length).toBeGreaterThan(0);

    const rlsSql = readFileSync(join(supabaseMigrationsDir, files[0]!), 'utf8');
    expect(rlsSql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(rlsSql).toContain('CREATE POLICY');
    expect(rlsSql).toContain('tenant_id');
  });
});
