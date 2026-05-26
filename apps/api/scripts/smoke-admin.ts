/**
 * Smoke local · valida que as 2 novas migrations + Prisma client + alert scanner
 * funcionam end-to-end sem precisar de JWT/auth flow.
 *
 * Executa:
 *  1. SELECT count das 3 tabelas novas (tenant_discoveries, feature_flags, operational_alerts)
 *  2. INSERT + SELECT round-trip em FeatureFlag (global + per-tenant) testando override
 *  3. runAlertScan() · valida que scanner roda contra DB real
 *  4. Lista alertas gerados
 *  5. Cleanup das flags de teste
 */
import { prisma } from '../src/lib/prisma.js';
import { runAlertScan } from '../src/lib/alert-scanner.js';
import { isFeatureEnabled, invalidateFeatureFlagCache } from '../src/lib/feature-flags.js';

const colors = {
  ok: '\x1b[32m✓\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
  info: '\x1b[36mi\x1b[0m',
};

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`${colors.ok} ${label}${detail ? ` · ${detail}` : ''}`);
  } else {
    console.log(`${colors.fail} ${label}${detail ? ` · ${detail}` : ''}`);
    failures += 1;
  }
}

async function main() {
  console.log('\n=== smoke admin · validação local sem JWT ===\n');

  // 1. Tables exist
  const [discoveriesCount, flagsCount, alertsCount] = await Promise.all([
    prisma.tenantDiscovery.count(),
    prisma.featureFlag.count(),
    prisma.operationalAlert.count(),
  ]);
  check('tenant_discoveries table', true, `${discoveriesCount} rows`);
  check('feature_flags table', true, `${flagsCount} rows`);
  check('operational_alerts table', true, `${alertsCount} rows`);

  // 2. Feature flags round-trip
  console.log(`\n${colors.info} testando feature flags · global + override per-tenant`);

  // Cleanup eventual leftovers
  await prisma.featureFlag.deleteMany({ where: { key: 'smoke.test_flag' } });

  // Global flag = false
  await prisma.featureFlag.create({
    data: { key: 'smoke.test_flag', tenantId: null, enabled: false, reason: 'smoke test global' },
  });
  invalidateFeatureFlagCache('smoke.test_flag');
  const globalCheck = await isFeatureEnabled('smoke.test_flag', undefined, true);
  check('flag global false respeitada', globalCheck === false, `got ${globalCheck}`);

  // Per-tenant override = true (precisa tenant real)
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (tenant) {
    await prisma.featureFlag.create({
      data: { key: 'smoke.test_flag', tenantId: tenant.id, enabled: true, reason: 'smoke test override' },
    });
    invalidateFeatureFlagCache('smoke.test_flag');
    const tenantCheck = await isFeatureEnabled('smoke.test_flag', tenant.id, false);
    check('override tenant true vence global false', tenantCheck === true, `tenant=${tenant.id.slice(0, 8)} got ${tenantCheck}`);

    const otherTenantCheck = await isFeatureEnabled('smoke.test_flag', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
    check('outro tenant cai no global false', otherTenantCheck === false, `got ${otherTenantCheck}`);
  } else {
    console.log(`${colors.info} sem tenant cadastrado · pulando teste de override`);
  }

  await prisma.featureFlag.deleteMany({ where: { key: 'smoke.test_flag' } });
  console.log(`${colors.ok} cleanup das flags de teste`);

  // 3. Alert scanner
  console.log(`\n${colors.info} executando runAlertScan()`);
  const result = await runAlertScan({ autoResolve: false });
  check('runAlertScan executou', result.errors === 0, `scanned=${result.scanned} created=${result.created} updated=${result.updated} errors=${result.errors}`);

  // 4. Listar alertas
  const openAlerts = await prisma.operationalAlert.findMany({
    where: { resolvedAt: null },
    orderBy: { severity: 'asc' },
    take: 10,
  });
  console.log(`\n${colors.info} ${openAlerts.length} alertas abertos:`);
  for (const a of openAlerts) {
    console.log(`   [${a.severity}] ${a.type} · ${a.title}`);
  }

  // 5. Schema migrations completas
  const tableNames = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('tenant_discoveries', 'feature_flags', 'operational_alerts')
    ORDER BY table_name
  `);
  check('3 tabelas novas presentes', tableNames.length === 3, tableNames.map((t) => t.table_name).join(', '));

  const enumNames = await prisma.$queryRawUnsafe<Array<{ typname: string }>>(`
    SELECT typname FROM pg_type
    WHERE typname IN ('DiscoveryStatus', 'AlertSeverity')
    ORDER BY typname
  `);
  check('2 enums novos presentes', enumNames.length === 2, enumNames.map((e) => e.typname).join(', '));

  console.log(`\n=== ${failures === 0 ? colors.ok + ' PASS' : colors.fail + ' FAIL · ' + failures + ' assertion(s) falharam'} ===\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`${colors.fail} smoke script falhou:`, err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
