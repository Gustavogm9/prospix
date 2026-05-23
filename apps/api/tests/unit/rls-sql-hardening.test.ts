import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(dirname(__filename), '..', '..');
const rlsSqlPath = join(repoRoot, 'prisma', 'sql', '01_rls.sql');
const migrationPath = join(repoRoot, 'prisma', 'migrations', '20260522000000_init', 'migration.sql');

describe('RLS SQL hardening audit', () => {
  it('keeps a committed Prisma baseline migration', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE "tenants"');
    expect(migration).toContain('CREATE TABLE "leads"');
    expect(migration).toContain('CREATE TABLE "messages"');
  });

  it('keeps RLS policy bootstrap idempotent and admin role grantable', () => {
    const rlsSql = readFileSync(rlsSqlPath, 'utf8');
    const createPolicies = rlsSql.match(/CREATE POLICY tenant_isolation_[a-z_]+ ON [a-z_]+/g) ?? [];
    const dropPolicies = rlsSql.match(/DROP POLICY IF EXISTS tenant_isolation_[a-z_]+ ON [a-z_]+/g) ?? [];

    expect(createPolicies.length).toBeGreaterThan(20);
    expect(dropPolicies).toHaveLength(createPolicies.length);
    expect(rlsSql).toContain("GRANT guilds_admin TO %I");
  });

  it('does not expose Guilds admin users through tenant-scoped user policy', () => {
    const rlsSql = readFileSync(rlsSqlPath, 'utf8');
    const userPolicy = rlsSql.match(/CREATE POLICY tenant_isolation_users ON users\s+FOR ALL USING \(([^;]+)\);/m);

    expect(userPolicy?.[1]).toBe('tenant_id = current_tenant_id()');
    expect(userPolicy?.[1]).not.toContain('GUILDS_ADMIN');
  });
});
