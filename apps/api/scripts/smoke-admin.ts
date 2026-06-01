/**
 * Smoke local · valida que as 2 novas migrations + Supabase client + alert scanner
 * funcionam end-to-end sem precisar de JWT/auth flow.
 *
 * Executa:
 *  1. SELECT count das 3 tabelas novas (tenant_discoveries, feature_flags, operational_alerts)
 *  2. INSERT + SELECT round-trip em FeatureFlag (global + per-tenant) testando override
 *  3. runAlertScan() · valida que scanner roda contra DB real
 *  4. Lista alertas gerados
 *  5. Cleanup das flags de teste
 */
import { dbAdmin } from '../src/lib/db.js';
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
  const [discoveriesRes, flagsRes, alertsRes] = await Promise.all([
    dbAdmin.from('tenant_discoveries').select('*', { count: 'exact', head: true }),
    dbAdmin.from('feature_flags').select('*', { count: 'exact', head: true }),
    dbAdmin.from('operational_alerts').select('*', { count: 'exact', head: true }),
  ]);
  check('tenant_discoveries table', !discoveriesRes.error, `${discoveriesRes.count ?? 0} rows`);
  check('feature_flags table', !flagsRes.error, `${flagsRes.count ?? 0} rows`);
  check('operational_alerts table', !alertsRes.error, `${alertsRes.count ?? 0} rows`);

  // 2. Feature flags round-trip
  console.log(`\n${colors.info} testando feature flags · global + override per-tenant`);

  // Cleanup eventual leftovers
  await dbAdmin.from('feature_flags').delete().eq('key', 'smoke.test_flag');

  // Global flag = false
  await dbAdmin.from('feature_flags').insert({
    key: 'smoke.test_flag',
    tenant_id: null,
    enabled: false,
    reason: 'smoke test global',
  });
  invalidateFeatureFlagCache('smoke.test_flag');
  const globalCheck = await isFeatureEnabled('smoke.test_flag', undefined, true);
  check('flag global false respeitada', globalCheck === false, `got ${globalCheck}`);

  // Per-tenant override = true (precisa tenant real)
  const { data: tenant } = await dbAdmin.from('tenants').select('id').limit(1).single();
  if (tenant) {
    await dbAdmin.from('feature_flags').insert({
      key: 'smoke.test_flag',
      tenant_id: tenant.id,
      enabled: true,
      reason: 'smoke test override',
    });
    invalidateFeatureFlagCache('smoke.test_flag');
    const tenantCheck = await isFeatureEnabled('smoke.test_flag', tenant.id, false);
    check('override tenant true vence global false', tenantCheck === true, `tenant=${tenant.id.slice(0, 8)} got ${tenantCheck}`);

    const otherTenantCheck = await isFeatureEnabled('smoke.test_flag', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
    check('outro tenant cai no global false', otherTenantCheck === false, `got ${otherTenantCheck}`);
  } else {
    console.log(`${colors.info} sem tenant cadastrado · pulando teste de override`);
  }

  await dbAdmin.from('feature_flags').delete().eq('key', 'smoke.test_flag');
  console.log(`${colors.ok} cleanup das flags de teste`);

  // 3. Alert scanner
  console.log(`\n${colors.info} executando runAlertScan()`);
  const result = await runAlertScan({ autoResolve: false });
  check('runAlertScan executou', result.errors === 0, `scanned=${result.scanned} created=${result.created} updated=${result.updated} errors=${result.errors}`);

  // 4. Listar alertas
  const { data: openAlerts } = await dbAdmin
    .from('operational_alerts')
    .select('*')
    .is('resolved_at', null)
    .order('severity', { ascending: true })
    .limit(10);
  console.log(`\n${colors.info} ${(openAlerts ?? []).length} alertas abertos:`);
  for (const a of openAlerts ?? []) {
    console.log(`   [${a.severity}] ${a.type} · ${a.title}`);
  }

  // 5. Schema validation — check tables exist via Supabase
  const { data: tableCheck } = await dbAdmin.rpc('execute_sql' as any, {
    query: `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('tenant_discoveries', 'feature_flags', 'operational_alerts')
      ORDER BY table_name`,
  });
  const tableNames = Array.isArray(tableCheck) ? tableCheck : [];
  check('3 tabelas novas presentes', tableNames.length === 3, tableNames.map((t: any) => t.table_name).join(', '));

  console.log(`\n=== ${failures === 0 ? colors.ok + ' PASS' : colors.fail + ' FAIL · ' + failures + ' assertion(s) falharam'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`${colors.fail} smoke script falhou:`, err);
  process.exit(1);
});
