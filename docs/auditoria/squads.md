# Squads de Auditoria

## Modelo operacional

Cada squad audita uma faixa do sistema e responde por evidencias, achados, criterios de aceite e comunicacao com as frentes implementadoras. Codex coordena a matriz; Claude revisa achados altos e criticos; Gustavo decide risco excepcional.

## Squad 0 - Auditoria Central

Responsaveis:

- Codex: Auditor Oficial e gate bloqueante.
- Claude: revisor independente para achados altos/criticos.
- Gustavo: decisor de risco excepcional e prioridade de negocio.

Escopo:

- Matriz de achados.
- Decisoes `APROVADO`, `APROVADO COM RESSALVAS`, `BLOQUEADO`, `NAO DETERMINADO`.
- Evidencia, severidade, confianca e aceite de risco.
- Conflitos entre squads.

## Squad 1 - Foundation/Security

Escopo:

- Prisma, migrations, RLS e seed.
- Auth, JWT, refresh, session e revogacao.
- Tenant isolation, `X-Tenant-Id`, admin bypass e roles.
- Secrets vault, criptografia, variaveis de ambiente.

Gates:

- RLS DB-backed verde.
- Nenhum admin bypass sem reset provado.
- Nenhum segredo exposto.
- Nenhuma query critica sem tenant guard ou justificativa.

## Squad 2 - API/Contracts/Data

Escopo:

- OpenAPI, shared-types, DTOs e schemas Zod.
- Rotas tenant, admin, auth e webhooks.
- Contratos consumidos por web/admin/landing.
- Erros publicos e shape de resposta.

Gates:

- OpenAPI e implementacao sem divergencia critica.
- Erros internos nao vazam para cliente.
- Inputs validam no boundary.
- Mudanca breaking tem consumidores atualizados.

## Squad 3 - Workers/IA/WhatsApp

Escopo:

- BullMQ, filas por tenant, retries, locks, DLQ e idempotencia.
- Evolution API, Google/AI providers, guardrails e prompt versions.
- Opt-out, warmup, health-check e custos.
- Processamento inbound/outbound e agenda via fila.

Gates:

- Workers sempre recebem e validam `tenant_id`.
- Opt-out bloqueia envio em ate 1 minuto.
- Guardrails impedem valores/promessas indevidas.
- Falha externa tem retry, fallback ou escalacao humana.

## Squad 4 - Frontend/UX

Escopo:

- `apps/web`, `apps/admin`, `apps/landing`.
- Auth flow, estados de erro/vazio/loading, responsividade e acessibilidade.
- API clients, token refresh, envio de `X-Tenant-Id`.
- Consistencia visual com design-system e prototipo aprovado.

Gates:

- Fluxos criticos navegaveis sem placeholder.
- Acessibilidade WCAG AA para telas principais.
- UI nao vaza tenant id ou dados sensiveis desnecessarios.
- Admin UI exige token e role adequados no backend.

## Squad 5 - DevEx/CI/CD/Docs

Escopo:

- Scripts pnpm/npm, turbo, CI, Docker e setup local.
- Separacao unit/integration/multi-tenant.
- Docs de agentes, PRD, README e encoding.
- Evidencia de comandos e reproducibilidade.

Gates:

- `pnpm typecheck` por pacote documentado.
- Testes com infra nao misturados no comando unitario.
- README sobe ambiente local de forma reproduzivel.
- Docs nao declaram estado antigo ou falso.

## Squad 6 - Produto/Compliance

Escopo:

- LGPD, consentimento, opt-out, retencao e privacidade.
- Billing, suspensao, churn, notificacoes e comunicacao com cliente.
- Termos, landing, proposta e material comercial.
- Risco de IA em conversa com leads.

Gates:

- Opt-out e base legal documentados.
- Termos/privacidade cobrem fluxos reais.
- Billing nao pode cobrar, suspender ou reativar sem auditoria.
- IA nao promete preco, condicao ou cobertura sem regra autorizada.

## Fluxo multiagente

1. Implementador abre PR com frente, escopo, arquivos, testes e riscos.
2. Squad dono revisa evidencias tecnicas.
3. Codex consolida achados e decide gate.
4. Claude revisa achados altos/criticos.
5. Gustavo decide somente risco excepcional ou tradeoff de produto.

O PR deve usar [../../.github/pull_request_template.md](../../.github/pull_request_template.md). Se houver risco aceito sem correcao imediata, usar [template-aceite-risco.md](template-aceite-risco.md) e manter o achado na matriz ate a revisita.
