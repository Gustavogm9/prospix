# <!-- Título curto, imperativo (ex: "Add fit score calculation") -->

## Frente

<!-- Marque a frente principal · se atinge múltiplas, listar -->
- [ ] A · Foundation
- [ ] B · Captura
- [ ] C · IA + WhatsApp
- [ ] D · Calendar + Admin
- [ ] E · Frontend
- [ ] F · Landing + Auth
- [ ] Cross-cutting / governança

## Spec da frente

<!-- Link para a tarefa específica no spec, ex: docs/agents/frente-b-captura.md#b3 · algoritmo-fit-score -->

## Tarefa multiagente

<!-- ID MA-YYYYMMDD-NN e link para issue/pacote em docs/auditoria/template-pacote-tarefa.md, se aplicável -->

- ID:
- Issue:
- Pacote:

## Mudanças

<!-- Bullet points objetivos · o "o quê", não o "como" -->
-
-

## Contratos tocados (preencher se houver)

- [ ] Schema Prisma (`apps/api/prisma/schema.prisma`)
- [ ] RLS policies (`apps/api/prisma/sql/01_rls.sql`)
- [ ] OpenAPI (`docs/api/openapi.yaml`)
- [ ] Shared types (`packages/shared-types/`)
- [ ] Design tokens (`packages/ui/`)
- [ ] Variáveis de ambiente (`.env.example`)
- [ ] Prompts em produção (Frente C · requer Eng. IA)

> **Atenção:** mudança em qualquer item acima exige **2 reviewers** (CODEOWNERS + PM).

## Testes

- [ ] Unit tests adicionados/atualizados
- [ ] Integration tests (se workers/integrações)
- [ ] Multi-tenant isolation test (se toca dados de tenant)
- [ ] Manual test descrito abaixo (se UI)
- [ ] Evidências classificadas em E0-E5 quando o PR toca área auditável
- [ ] Lacunas ou testes não executados justificados abaixo

<details>
<summary>Manual test plan</summary>

<!-- Passos pra reproduzir + screenshot/gif se UI -->

</details>

## CI verifications

- [ ] `pnpm lint` passa
- [ ] `pnpm typecheck` passa
- [ ] `pnpm test` passa
- [ ] `pnpm test:multi-tenant` passa (se aplicável)
- [ ] CI verde no GitHub

## Gate de auditoria Codex

<!-- Obrigatório para PRs que tocam segurança, tenant isolation, auth, billing, LGPD, IA, workers, contratos, Prisma/RLS ou CI. -->

- Squad auditor dono:
- Achados relacionados (`AUD-*`):
- Evidência principal:
- Confiança: Baixa / Média / Alta
- Risco residual:
- Decisão esperada: Liberar / Liberar com ressalva / Bloquear / Não determinado

### Áreas sensíveis tocadas

- [ ] Prisma/schema/migrations
- [ ] RLS, tenant context ou admin bypass
- [ ] Auth, sessão, JWT, roles ou permissões
- [ ] Secrets, integrações externas ou webhooks
- [ ] Billing, cobrança, usage ou créditos
- [ ] Opt-out, consentimento, retenção ou LGPD
- [ ] Prompts de IA, guardrails ou automações de conversa
- [ ] Workers, filas, retries, DLQ ou idempotência
- [ ] Logs, erros públicos, observabilidade ou auditoria
- [ ] OpenAPI, shared-types ou contrato consumido por frontend

### Evidências anexadas

- Comandos executados:
- Testes que falharam e motivo:
- Arquivos/linhas críticas revisadas:
- Prints/GIFs ou artefatos, se UI:
- Itens não verificados:

> Se houver P0/P1 aberto, o PR deve declarar correção, mitigação ou aceite formal em `docs/auditoria/template-aceite-risco.md`.

## Notas pro revisor

<!-- Algo específico que precisa de atenção · ou "nada" -->
