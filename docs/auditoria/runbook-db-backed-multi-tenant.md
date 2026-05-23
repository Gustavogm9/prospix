# Runbook DB-backed multi-tenant

Este runbook fecha a lacuna operacional de `AUD-P0-003`: a evidencia de isolamento multi-tenant so e aceita quando Postgres esta disponivel, RLS foi aplicado, o seed foi carregado e `test:multi-tenant` terminou sem skips.

## CI

O job `test` em `.github/workflows/ci.yml` deve executar nesta ordem:

1. Subir o service `postgres:16-alpine` com database `prospix_test`.
2. Verificar que `localhost:5432` esta aceitando conexoes TCP.
3. Falhar se `apps/api/prisma/migrations` nao existir no commit.
4. Gerar Prisma Client.
5. Rodar `pnpm --filter @prospix/api db:migrate`, que executa `prisma migrate deploy` e aplica `prisma/sql/01_rls.sql`.
6. Rodar `pnpm --filter @prospix/api db:seed`.
7. Rodar `pnpm test`.
8. Rodar a suite `tests/multi-tenant` com reporter JSON e falhar se houver qualquer teste skipped/todo.

Se qualquer passo de preparo do banco falhar, o CI deve parar antes da suite multi-tenant. Resultado com skip nao e evidencia valida para RLS.

## Execucao local

Use um banco de teste separado. Nao rode este fluxo contra banco de desenvolvimento com dados manuais.

```powershell
docker compose up -d postgres redis
docker compose exec postgres createdb -U prospix prospix_test
$env:NODE_ENV = "test"
$env:DATABASE_URL = "postgresql://prospix:prospix_dev@localhost:5432/prospix_test"
$env:REDIS_URL = "redis://localhost:6379"
$env:SECRETS_ENCRYPTION_KEY = "dGVzdF9rZXlfMzJfYnl0ZXNfbG9uZ19wYWRfeHh4eA=="
$env:EVOLUTION_GUILDS_API_KEY = "test-evolution-key"
pnpm --filter @prospix/api db:generate
pnpm --filter @prospix/api db:migrate
pnpm --filter @prospix/api db:seed
pnpm --filter @prospix/api exec vitest run tests/multi-tenant --reporter=default --reporter=json --outputFile=../../multi-tenant-results.json
node -e "const r=require('./multi-tenant-results.json'); const skipped=Number(r.numPendingTests||0)+Number(r.numTodoTests||0); if (skipped) { console.error('test:multi-tenant had '+skipped+' skipped/todo test(s)'); process.exit(1); }"
```

Se `createdb` retornar que `prospix_test` ja existe, continue apenas se esse banco puder ser reusado para teste. Para recomecar limpo, remova e recrie o banco de teste antes de migrar e seedar.

As chaves JWT de teste devem vir de `apps/api/.env.test` ou de variaveis equivalentes em PEM valido. Nao substitua por strings placeholder, porque a API registra JWT com `RS256`.

## Criterio de aceite

- `db:migrate` precisa aplicar migrations e RLS sem erro.
- `db:seed` precisa carregar os tenants ficticios usados pela suite.
- `tests/multi-tenant` precisa passar com 0 skipped e 0 todo.
- Logs com `[DATABASE OFFLINE]` invalidam a evidencia.

## Lacuna conhecida

No snapshot atual, `apps/api/prisma/migrations/20260522000000_init` existe. O CI DB-backed deve continuar falhando explicitamente se a pasta de migrations sumir ou se alguem tentar substituir migrations por `db push`.
