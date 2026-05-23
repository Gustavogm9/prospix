# Status de Cobertura da Auditoria

Atualizado em 23/05/2026 apos rodada Codex DB/Redis-backed, DLQ fisica/replay, CI gate local, LGPD migration e smoke E2E.

## Leitura rapida

Estamos em **aproximadamente 94% de prontidao tecnica auditavel local** e **aproximadamente 87% de prontidao formal para go-live**.

Esse numero nao significa que o produto esta pronto para go-live; significa que, ponderando os squads tecnicos, ha implementacao real e evidencia DB-backed/E2E relevante. A cobertura estatica de auditoria esta em torno de **94%**, porque os agentes mapearam e corrigiram parte relevante dos riscos por leitura de codigo, contratos e testes unitarios. A evidencia forte, com teste integrado/DB-backed/Redis/E2E, subiu para perto de **82%** depois das provas RLS/multi-tenant com Postgres real, Redis/BullMQ real, webhook Evolution duplicado concorrente com Postgres+Redis reais, admin-login com RLS ativo, DLQ fisica com replay Redis-backed e smoke Playwright 8/8.

## Percentuais por squad

| Squad | Frente | Estimativa | Gate | Motivo principal |
|---|---|---:|---|---|
| 0 | Auditoria Central | 90% | Parcial | Processo, docs, taxonomia, matrizes e prompts existem; falta relatorio final e rotina por PR rodando em ciclo real. |
| 1 | Foundation/Security | 88% | Parcial | Migration baseline + migration LGPD estao aplicadas, RLS SQL ficou idempotente, usuario app nao-superuser foi criado para prova real, `AUDIT_REQUIRE_DB=1` passou sem skips, admin-login usa bypass DB-role transacional e passou com RLS ativo; ainda falta ampliar RLS DB-backed para mais tabelas e auth refresh/logout integrada em Redis real. |
| 2 | API/Contracts/Data | 89% | Parcial | `/v1/auth`, `admin-login`, tenants admin, convites, templates, conversations/scripts, meetings, notification preferences, integrations, billing/admin, webhooks, leads/auth/admin criticos, LGPD tenant e header Asaas foram alinhados com testes focados; rotas fantasmas foram removidas; ainda falta expandir contrato para todos os endpoints nao criticos. |
| 3 | Workers/IA/WhatsApp | 95% | Bloqueado para go-live | Workers criticos foram registrados, opt-out confirmado, logs endurecidos, webhooks/envios com `jobId`, inbound com dedupe/P2002/transacao, HMAC obrigatorio, quota IA preventiva, prova Evolution DB/Redis-backed e DLQ fisica com alerta estruturado + replay Redis-backed passaram; ainda falta smoke E2E do fluxo WhatsApp real com provider. |
| 4 | Frontend/UX | 86% | Parcial | Links legais existem, mocks/sucesso fake ficaram restritos a dev/demo, Settings nao exibe dados financeiros fake fora de dev/demo, admin/web `ProtectedRoute` foram corrigidos e smoke Playwright passou 8/8 cobrindo landing, legal pages, web login, web pos-login, admin login e admin pos-login; ainda faltam fluxos reais de negocio e a11y/responsividade ampla. |
| 5 | DevEx/CI/CD/Docs | 93% | Parcial | Scripts, CI/deploy, docs, migration baseline/LGPD, gates anti-skip, OpenAPI/shared-types, `test:audit:db`, DB/Redis local e Playwright smoke estao configurados e verdes localmente; ainda falta observar primeiro GitHub Actions verde e tornar audit de dependencias bloqueante. |
| 6 | Produto/Compliance | 58% | Bloqueado para go-live | UX LGPD operacional existe com schema/API/frontend/migration, links legais existem e claims publicos foram suavizados; ainda falta revisao juridica, worker de fulfillment LGPD, retencao/subprocessadores e governanca comercial completa. |

## Calculo operacional

Peso usado para a estimativa global:

- Squad 1: 25%
- Squad 2: 20%
- Squad 3: 20%
- Squad 4: 15%
- Squad 5: 10%
- Squad 6: 10%

Resultado ponderado inicial: **aprox. 53%**, arredondado operacionalmente para **52%** por causa dos P0 abertos.

Atualizacao incremental: depois das rodadas anteriores, a continuacao de 23/05/2026 fechou os bloqueantes tecnicos mais fortes: CI local ganhou `test:audit:db` com Postgres/Redis e usuario `prospix_app`; DLQ fisica foi provada com Redis real, alerta estruturado `queue:dlq-enqueued` e replay allowlisted; LGPD ganhou migration real, RLS idempotente e Prisma Client gerado; typecheck API/web/admin passou; `npm test` passou com 35 arquivos/199 testes; e `pnpm test:e2e:smoke` passou com 8/8. Com isso, a prontidao tecnica auditavel local fica em **aprox. 94%**.

## P0 atuais

- Nenhum P0 tecnico aberto no recorte atual de RLS/multi-tenant/auth versionado. `AUD-P0-001`, `AUD-P0-003` e `AUD-P0-011` ficam fechados com evidencia local.
- `AUD-P0-011`: resolvido em 22/05/2026; mantido no historico como P0 fechado.

## O que falta para sustentar 94%

- Observar primeiro GitHub Actions verde reproduzindo `test:audit:db`, OpenAPI drift e smoke Playwright.
- RLS DB-backed cobrindo tabelas criticas alem de `leads`, incluindo LGPD, billing, sessions e audit log.
- Auth session hardening com prova integrada de expiracao/reuso negado/logout em Redis real; admin-login DB-backed ja passou.
- Smoke E2E do fluxo WhatsApp real capturar -> enriquecer -> conversar -> opt-out -> agendar com provider controlado.
- Termos/privacidade/LGPD alinhados por revisao juridica e fluxo real de retencao/subprocessadores.

## O que falta para 100%

- Nenhum P0 aberto.
- P1 resolvidos ou aceitos formalmente por Gustavo com revisao independente quando aplicavel.
- CI remoto reproduzindo DB-backed, contratos e smoke sem skips criticos.
- Browser/E2E validando fluxos principais: capturar, enriquecer, conversar, opt-out, agendar, billing/admin.
- Relatorio final de auditoria Codex com decisao formal.

## Evidencias desta rodada

- `npx tsc --noEmit --project apps/api/tsconfig.json` passou em 22/05/2026.
- Suite focada passou em 22/05/2026: `auth-session-hardening.test.ts`, `webhooks.test.ts`, `evolution.test.ts`, `idempotency.test.ts` e `tenant-contract.test.ts` com 18 testes.
- Suite focada adicional passou em 22/05/2026: `prompt-validation.test.ts` e `admin.test.ts` com 51 testes.
- Suite focada de quota IA passou em 22/05/2026: `ai-quota.test.ts`, `prompt-validation.test.ts`, `usage-aggregation.test.ts` e `tenant.test.ts` com 57 testes.
- Suite focada adicional passou em 22/05/2026: `process-inbound.test.ts`, `send-messages.test.ts` e `tenant-contract.test.ts`.
- Suite focada adicional passou em 22/05/2026: `queue.test.ts`, `workers/index.test.ts` e `tenant-contract.test.ts` com 14 testes, cobrindo classificacao de falha de fila e hardening de integrations.
- Suite focada adicional passou em 22/05/2026: `auth-admin-contract.test.ts`, `webhooks.test.ts` e `tenant-contract.test.ts` com 10 testes, cobrindo billing/admin, webhooks e sincronismo OpenAPI/shared-types.
- Typecheck web passou em 22/05/2026 apos restringir mocks financeiros de Settings a dev/demo.
- `npm test` passou em 22/05/2026: 32 arquivos, 162 testes.
- `git diff --check` passou em 22/05/2026, com avisos esperados de LF/CRLF no Windows e sem erros de whitespace.
- `docker --version` passou em 23/05/2026: Docker 29.4.3; `docker compose version` passou: v5.1.4.
- `docker compose up -d postgres redis` subiu Postgres 16 e Redis 7; `docker compose ps` mostrou ambos `healthy`; `pg_isready` retornou accepting connections e `redis-cli ping` retornou `PONG`.
- Banco isolado `prospix_test` foi criado; `pnpm --filter @prospix/api db:generate`, `db:migrate` e `db:seed` passaram. RLS aplicou 109 statements.
- `AUDIT_REQUIRE_DB=1` com `DATABASE_URL=postgresql://prospix_app:prospix_dev@localhost:5432/prospix_test?schema=public` passou em 23/05/2026: 2 arquivos, 5 testes, 0 skipped/todo; JSON `multi-tenant-results.json` confirmou `success=True`.
- Suite Workers/Redis/webhooks focada passou em 23/05/2026: `queue.test.ts`, `process-inbound.test.ts`, `send-messages.test.ts`, `billing-suspension.test.ts` e `webhooks.test.ts` com 5 arquivos/20 testes.
- `npx tsc --noEmit --project apps/api/tsconfig.json`, `pnpm --filter @prospix/shared-types typecheck` e `npm test` passaram em 23/05/2026; `npm test` manteve 32 arquivos/162 testes.
- Redis foi recriado com `maxmemory-policy noeviction`; `docker compose exec redis redis-cli CONFIG GET maxmemory-policy` retornou `noeviction` e `redis-cli ping` retornou `PONG`.
- Prova Redis/BullMQ real passou em 23/05/2026: `queue-dlq.redis.test.ts`, `queue.test.ts` e `workers/index.test.ts` com 3 arquivos/10 testes, cobrindo falha retida no Redis e audit event sem payload bruto.
- Prova Evolution DB/Redis-backed passou em 23/05/2026: `evolution-idempotency.redis-db.test.ts`, `queue-dlq.redis.test.ts`, `queue.test.ts` e `workers/index.test.ts` com 4 arquivos/11 testes; dois webhooks concorrentes com o mesmo `messageId` produziram um unico job BullMQ e uma unica mensagem inbound persistida com `messageCount = 1`.
- Prova DB-backed de auth admin passou em 23/05/2026: `auth-admin-login.rls-db.test.ts`, `auth-session-hardening.test.ts` e `auth-admin-contract.test.ts` com 3 arquivos/5 testes; `admin-login` criou sessao com `prospix_app` e RLS ativo usando bypass DB-role transacional sem imprimir tokens.
- Smoke browser publico passou em 23/05/2026: landing home, privacidade, termos, LGPD, web login e admin login renderizaram com conteudo e sem console error capturado.
- Suite DB/Redis final passou em 23/05/2026: `tests/multi-tenant`, `auth-admin-login.rls-db.test.ts`, `evolution-idempotency.redis-db.test.ts`, `queue-dlq.redis.test.ts`, `queue.test.ts` e `workers/index.test.ts` com 7 arquivos/17 testes.
- `npm test` passou novamente em 23/05/2026 com 32 arquivos/162 testes; `git diff --check` passou sem erros, apenas avisos esperados de LF/CRLF no Windows.
- Contratos auth/admin/tenant passaram em 23/05/2026: `auth-admin-contract.test.ts` e `tenant-contract.test.ts` com 2 arquivos/6 testes, incluindo `admin-login`, tenants admin, convites, templates e gate OpenAPI/shared-types.
- `pnpm --filter @prospix/shared-types typecheck` e `npx tsc --noEmit --project apps/api/tsconfig.json` passaram apos os novos contratos.
- DLQ fisica/replay Redis-backed passou em 23/05/2026: `queue-dlq.redis.test.ts` provou falha esgotada retida, `dlq-health-check` enfileirada com `alert=true`, dry-run e replay real com `_replay_metadata`.
- Migration LGPD passou em 23/05/2026: `20260523000000_lgpd_requests` aplicada em `prospix_test`, `db:migrate` aplicou 113 statements RLS, `db:generate` regenerou Prisma Client.
- `npx tsc --noEmit --project apps/api/tsconfig.json` passou em 23/05/2026 apos migration LGPD; `npm test` passou com 35 arquivos/199 testes.
- `pnpm --filter @prospix/web typecheck` e `pnpm --filter @prospix/admin typecheck` passaram em 23/05/2026 apos corrigir `ProtectedRoute`.
- `pnpm test:e2e:smoke` passou em 23/05/2026 com 8/8: landing home, planos, termos/privacidade/LGPD, web login, web magic-link mockado, web pos-login mockado, admin login e admin pos-login mockado.
- Dalton preparou smoke browser read-only com URLs locais: API `3000`, landing `3001`, web `5173`, admin `5174`, Mailhog `8025`; credencial admin seed `gustavo.macedo@guilds.com.br` e fluxo tenant dependente de magic link/Evolution.
- Evidencia estatica revisada: `apps/api/src/services/auth-service.ts`, `apps/api/src/routes/auth/index.ts`, `apps/api/src/routes/admin/index.ts`, `apps/api/src/routes/webhooks/evolution.ts`, `apps/api/src/routes/webhooks/index.ts`, `apps/api/src/ai/quota.ts`, `apps/api/src/ai/guardrails.ts`, `apps/api/src/ai/router.ts`, `apps/api/src/lib/logger.ts`, `apps/api/src/workers/index.ts`, `apps/api/src/workers/usage-aggregation.ts`, `apps/api/src/routes/tenant/dashboard.ts`, `apps/api/tests/unit/ai-quota.test.ts`, `apps/api/tests/unit/admin.test.ts`, `apps/api/tests/ai/prompt-validation.test.ts`, `apps/api/tests/unit/auth-session-hardening.test.ts` e `apps/api/tests/unit/webhooks.test.ts`.
- Prova forte ainda depende de primeiro CI remoto verde, E2E WhatsApp real com provider controlado, ampliacao RLS por tabela e aceite LGPD/compliance.
