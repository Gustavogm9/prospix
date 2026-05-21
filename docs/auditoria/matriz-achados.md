# Matriz Inicial de Achados

Status da auditoria inicial: preliminar. Nao expor segredos reais neste arquivo.

| ID | Achado | Squad | Severidade | Prioridade | Confianca | Status | Evidencia | Recomendacao | Criterio de aceite |
|---|---|---|---|---|---|---|---|---|---|
| AUD-P0-001 | RLS pode nao manter `app.tenant_id` durante queries comuns porque `set_config(..., true)` foi chamado fora de transacao explicita no middleware e no base worker. | 1 | Critica | P0 | Media | Aberto | `apps/api/src/middlewares/tenant-context.ts`, `apps/api/src/workers/_base-worker.ts` | Validar com teste DB-backed e corrigir para transacao por operacao, contexto por transaction client ou abordagem segura equivalente. | Teste multi-tenant prova tenant vazio, tenant A, tenant B e escrita cross-tenant bloqueada. |
| AUD-P0-002 | Suite agregada `npm test` nao esta verde; `@prospix/shared-types` roda Vitest sem arquivos de teste. | 5 | Alta | P0 | Alta | Aberto | `npm test`; `packages/shared-types/package.json` | Separar scripts ou configurar Vitest para passar sem testes quando intencional. | `npm test` ou comando oficial de CI passa sem falso negativo. |
| AUD-P0-003 | Teste RLS/multi-tenant exige Postgres local e falha fora de ambiente preparado. | 1 | Critica | P0 | Alta | Aberto | `apps/api/tests/multi-tenant/rls.test.ts`; erro `localhost:5432` indisponivel | Separar `test:unit` e `test:multi-tenant`; documentar dependencia de DB; CI deve subir Postgres, migrar, aplicar RLS e seed. | `pnpm test:unit` passa sem DB; `pnpm test:multi-tenant` passa com DB provisionado. |
| AUD-P1-004 | `SET ROLE guilds_admin` usa pool Prisma e depende de `RESET ROLE` em `onSend`, com risco de estado persistente em conexao se erro ocorrer fora do fluxo esperado. | 1 | Alta | P1 | Media | Aberto | `apps/api/src/routes/admin/index.ts` | Conter role bypass em transacao/conexao controlada ou cliente separado; garantir reset em todos os caminhos. | Teste prova que request tenant apos admin nao herda role/bypass. |
| AUD-P1-005 | CORS esta configurado como `origin: '*'`, inadequado para producao autenticada. | 2 | Alta | P1 | Alta | Aberto | `apps/api/src/index.ts` | Usar allowlist por ambiente e negar origens desconhecidas em producao. | Teste/config mostra origens permitidas por env e wildcard apenas em dev se aceito. |
| AUD-P1-006 | Error handler retorna `error.message` para cliente em erro interno, podendo vazar detalhe tecnico. | 2 | Alta | P1 | Alta | Aberto | `apps/api/src/index.ts` | Padronizar mensagens publicas genericas e log interno com correlation id. | Teste de erro 500 retorna mensagem generica sem stack/detalhe interno. |
| AUD-P1-007 | Busca indicou logs com `messageContent`, `body`, erros externos e possiveis payloads sensiveis. | 3 | Alta | P1 | Media | Aberto | `apps/api/src/ai/classifier.ts`, `apps/api/src/routes/webhooks/evolution.ts`, logs observados nos testes | Classificar campos sensiveis, mascarar payloads e limitar conteudo de logs. | Testes/log snapshots nao exibem texto completo de lead, token, body cru ou segredo. |
| AUD-P1-008 | `executeRawUnsafe` interpola valores em RLS/admin helpers. | 1 | Alta | P1 | Alta | Aberto | `apps/api/src/middlewares/tenant-context.ts`, `apps/api/src/routes/admin/index.ts` | Substituir por query parametrizada ou validar estritamente UUID/role antes de executar. | Grep nao encontra interpolacao insegura em SQL raw sensivel. |
| AUD-P2-009 | `docs/agents/README.md` ainda registrava implementacao como nao iniciada apesar de codigo real existir. | 5 | Media | P2 | Alta | Resolvido | `docs/agents/README.md` | Atualizar estado atual e incluir auditoria oficial. | Documento reflete baseline atual. |
| AUD-P2-010 | `docs/dev-plan.md` ainda continha partes sem a camada Codex Auditor Oficial. | 5 | Media | P2 | Alta | Resolvido | `docs/dev-plan.md` | Inserir papel do auditor, gates e squads de auditoria. | Documento aponta para `docs/auditoria`. |

## Regras de uso

- Nunca remover achado sem registrar criterio de aceite.
- Para marcar `Resolvido`, incluir PR/commit ou evidencia equivalente.
- Para marcar `Aceito com risco`, preencher [template-aceite-risco.md](template-aceite-risco.md), incluir aprovador Gustavo, data, escopo, prazo de revisita e revisao Claude quando severidade for Alta ou Critica.
- Achados P0 bloqueiam merge/release.
- Achados P1 bloqueiam go-live e podem bloquear merge se tocarem area critica.
