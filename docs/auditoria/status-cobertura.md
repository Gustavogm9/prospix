# Status de Cobertura da Auditoria

Atualizado em 23/05/2026 apos rodada multiagente DB-backed, Redis/BullMQ e contratos OpenAPI/shared-types.

## Leitura rapida

Estamos em **aproximadamente 89% de prontidao auditavel para aprovacao 100%**.

Esse numero nao significa que o produto esta pronto para go-live; significa que, ponderando os squads, ha implementacao real e evidencia DB-backed relevante, mas ainda existem P1 que bloqueiam uma aprovacao oficial ampla. A cobertura estatica de auditoria esta em torno de **90%**, porque os agentes mapearam e corrigiram parte relevante dos riscos por leitura de codigo, contratos e testes unitarios. A evidencia forte, com teste integrado/DB-backed/E2E, subiu para perto de **70%** depois das provas RLS/multi-tenant com Postgres real, Redis/BullMQ real, webhook Evolution duplicado concorrente com Postgres+Redis reais, admin-login com RLS ativo e smoke browser publico.

## Percentuais por squad

| Squad | Frente | Estimativa | Gate | Motivo principal |
|---|---|---:|---|---|
| 0 | Auditoria Central | 90% | Parcial | Processo, docs, taxonomia, matrizes e prompts existem; falta relatorio final e rotina por PR rodando em ciclo real. |
| 1 | Foundation/Security | 84% | Parcial | Migration baseline foi gerada, RLS SQL ficou idempotente, policy `users` perdeu o bypass por role, usuario app nao-superuser foi criado para prova real, `AUDIT_REQUIRE_DB=1` passou com 5/5 e 0 skips; admin-login agora usa bypass DB-role transacional e passou em prova DB-backed com RLS ativo; ainda falta ampliar RLS DB-backed para mais tabelas e auth refresh/logout integrada em Redis real. |
| 2 | API/Contracts/Data | 86% | Parcial | `/v1/auth`, `admin-login`, tenants admin detalhe/update/suspend/resume/churn, convites, templates, conversations/scripts, meetings, notification preferences, integrations, billing/admin, webhooks, leads/auth/admin criticos e header Asaas documentado foram alinhados com testes focados; rotas fantasmas foram removidas do OpenAPI; ainda falta validacao OpenAPI/shared-types completa por geracao e smoke real pos-login. |
| 3 | Workers/IA/WhatsApp | 91% | Bloqueado para go-live | Workers criticos foram registrados, `send-notification` ganhou consumidor, schedulers recorrentes foram adicionados, opt-out foi confirmado, logs de envio/IA/guardrails/router foram endurecidos, webhooks e envio WhatsApp ganharam `jobId` deterministico, inbound ganhou dedupe/P2002/transacao local, falhas de fila ganharam classificacao retry/esgotada/orfa, HMAC obrigatorio entrou em producao e quota IA preventiva entrou antes do provider; suite focada Workers/Redis/webhooks passou, a prova Redis/BullMQ real de falha retida passou com Redis `noeviction`, e a prova Evolution DB/Redis-backed confirmou dois webhooks concorrentes virando um unico job e uma unica mensagem persistida; ainda faltam DLQ fisica/replay/alerta e smoke E2E do fluxo WhatsApp completo. |
| 4 | Frontend/UX | 74% | Bloqueado para homologacao ampla | Endpoints web principais foram alinhados, links legais existem e mocks/sucesso fake ficaram restritos a dev/demo; Settings nao exibe mais Pix/faturas/chave fake fora de dev/demo; smoke browser publico passou para landing home, legal pages, web login e admin login sem console error capturado; ainda faltam smoke pos-login, estados estruturais amplos e a11y/responsividade. |
| 5 | DevEx/CI/CD/Docs | 86% | Parcial | Scripts, CI/deploy, docs, migration baseline, gates anti-skip, matriz OpenAPI/shared-types, execucao local DB-backed e Redis `noeviction` melhoraram; ainda falta reproduzir o gate em CI, audit de dependencias bloqueante e geracao/validacao OpenAPI/shared-types completa. |
| 6 | Produto/Compliance | 50% | Bloqueado para go-live | Links legais existem e claims publicos foram suavizados; ainda falta revisao juridica, UX LGPD operacional, retencao/subprocessadores e governanca comercial completa. |

## Calculo operacional

Peso usado para a estimativa global:

- Squad 1: 25%
- Squad 2: 20%
- Squad 3: 20%
- Squad 4: 15%
- Squad 5: 10%
- Squad 6: 10%

Resultado ponderado anterior: **aprox. 53%**, arredondado operacionalmente para **52%** por causa dos P0 abertos.

Atualizacao incremental: `AUD-P0-011` foi resolvido com teste focado, elevando a prontidao operacional para **aprox. 55%**. Depois, `AUD-P1-012` e `AUD-P1-023` tambem receberam fixes com testes focados, e `AUD-P1-020` entrou em mitigacao parcial. A rodada seguinte adicionou migration baseline, hardening idempotente de RLS, correcoes de contrato web/API, observabilidade de retry/DLQ nominal, mascaramento do destino de WhatsApp em logs e rotas legais publicas, chegando a **aprox. 63%**. A rodada atual adicionou gate DB obrigatorio, seed nos deploy checks, consumidor `send-notification`, fail-closed para mocks/admin e gate minimo OpenAPI/shared-types para contratos criticos, chegando a **aprox. 67%**. A rodada recente adicionou hash de refresh token, `accessTokenId` separado do refresh token, `jobId` deterministico em webhooks Evolution/Asaas, HMAC obrigatorio para Evolution em producao, schedulers recorrentes tenant-scoped, alinhamento do header Asaas documentado, `credentialState` seguro no admin sem secret bruto, hardening de logs de IA/guardrails/router e quota IA preventiva antes do provider. A rodada multiagente atual adicionou `jobId` deterministico para envios/reagendamentos WhatsApp, endureceu inbound com dedupe/P2002/transacao local/retry consciente, alinhou contratos reais de meetings, notification preferences e integrations em OpenAPI/shared-types/teste, removeu vazamento publico de mensagens externas em integrations e criou runbook/classificacao auditavel de falhas de fila. A continuacao alinhou billing/admin e webhooks em OpenAPI/shared-types/teste, removeu rotas fantasmas do OpenAPI e impediu que Settings exiba Pix/faturas/chaves mockadas fora de dev/demo. Em 23/05/2026, Docker/Postgres/Redis foram provisionados, `apply-rls.ts` foi corrigido para executar statements separadamente, `01_rls.sql` passou a usar `pg_has_role` e criar `prospix_app` nao-superuser para prova real, o seed recebeu UUID valido para admin, `AUDIT_REQUIRE_DB=1` passou com 5/5 e 0 skips, a suite Workers/Redis/webhooks passou com 20/20, `npm test` passou com 32 arquivos/162 testes e typechecks de API/shared-types passaram. A continuacao da rodada em 23/05/2026 adicionou prova Redis/BullMQ real para falha retida e audit event redigido, mudou Redis para `noeviction`, alinhou contratos criticos de `admin-login`, tenants admin, convites e templates no OpenAPI/shared-types, e `auth-admin-contract.test.ts` + `tenant-contract.test.ts` passaram com 6/6. Com isso, a prontidao recomendada fica em **aprox. 85%**.

## P0 atuais

- Nenhum P0 tecnico aberto no recorte atual de RLS/multi-tenant/auth versionado. `AUD-P0-001`, `AUD-P0-003` e `AUD-P0-011` ficam fechados com evidencia local.
- `AUD-P0-011`: resolvido em 22/05/2026; mantido no historico como P0 fechado.

## O que falta para sustentar 89%

- Reproduzir `test:multi-tenant` DB-backed em CI com Postgres/Redis provisionados e 0 skips.
- RLS DB-backed cobrindo tabelas criticas alem de `leads`.
- DLQ fisica com alerta e replay validado em Redis real.
- Auth session hardening com prova integrada de expiracao/reuso negado/logout em Redis real; admin-login DB-backed ja passou.
- Reproduzir a prova de webhook duplicado DB/Redis-backed no CI.
- Smoke web/admin/landing principal executado em browser.
- Termos/privacidade/LGPD alinhados ao PRD e ao fluxo real.

## O que falta para 100%

- Nenhum P0 aberto.
- P1 resolvidos ou aceitos formalmente por Gustavo com revisao independente quando aplicavel.
- CI reproduzindo DB-backed, contratos e smoke sem skips criticos.
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
- Smoke browser publico passou em 23/05/2026: landing home, privacidade, termos, LGPD, web login e admin login renderizaram com conteudo e sem console error capturado. Smoke pos-login segue pendente.
- Suite DB/Redis final passou em 23/05/2026: `tests/multi-tenant`, `auth-admin-login.rls-db.test.ts`, `evolution-idempotency.redis-db.test.ts`, `queue-dlq.redis.test.ts`, `queue.test.ts` e `workers/index.test.ts` com 7 arquivos/17 testes.
- `npm test` passou novamente em 23/05/2026 com 32 arquivos/162 testes; `git diff --check` passou sem erros, apenas avisos esperados de LF/CRLF no Windows.
- Contratos auth/admin/tenant passaram em 23/05/2026: `auth-admin-contract.test.ts` e `tenant-contract.test.ts` com 2 arquivos/6 testes, incluindo `admin-login`, tenants admin, convites, templates e gate OpenAPI/shared-types.
- `pnpm --filter @prospix/shared-types typecheck` e `npx tsc --noEmit --project apps/api/tsconfig.json` passaram apos os novos contratos.
- Dalton preparou smoke browser read-only com URLs locais: API `3000`, landing `3001`, web `5173`, admin `5174`, Mailhog `8025`; credencial admin seed `gustavo.macedo@guilds.com.br` e fluxo tenant dependente de magic link/Evolution.
- Evidencia estatica revisada: `apps/api/src/services/auth-service.ts`, `apps/api/src/routes/auth/index.ts`, `apps/api/src/routes/admin/index.ts`, `apps/api/src/routes/webhooks/evolution.ts`, `apps/api/src/routes/webhooks/index.ts`, `apps/api/src/ai/quota.ts`, `apps/api/src/ai/guardrails.ts`, `apps/api/src/ai/router.ts`, `apps/api/src/lib/logger.ts`, `apps/api/src/workers/index.ts`, `apps/api/src/workers/usage-aggregation.ts`, `apps/api/src/routes/tenant/dashboard.ts`, `apps/api/tests/unit/ai-quota.test.ts`, `apps/api/tests/unit/admin.test.ts`, `apps/api/tests/ai/prompt-validation.test.ts`, `apps/api/tests/unit/auth-session-hardening.test.ts` e `apps/api/tests/unit/webhooks.test.ts`.
- Prova forte ainda depende de CI DB-backed, E2E browser, DLQ/replay fisico, concorrencia real de webhooks duplicados e aceite LGPD/compliance.
