# Auditoria Oficial Prospix

Este diretorio centraliza a auditoria oficial do Prospix. O Codex atua como Auditor Oficial com gate bloqueante; Claude atua como revisor independente para achados altos e criticos; Gustavo decide aceitacao excepcional de risco.

## Mandato

- Bloquear merge para `staging` ou `main` quando houver falha critica de evidencia, isolamento tenant, autenticacao, autorizacao, secrets, billing, opt-out, LGPD, CI ou testes obrigatorios.
- Exigir preenchimento do gate de auditoria no template de PR quando houver area sensivel tocada.
- Tratar trabalho de qualquer agente como contribuicao sob auditoria, nao como aprovacao final.
- Registrar achados com evidencia, severidade, confianca, impacto, causa e criterio de aceite verificavel.
- Nunca expor segredos reais, tokens, senhas, chaves privadas ou dados pessoais sensiveis nos documentos.
- Marcar explicitamente o que e fato, inferencia, hipotese, lacuna de evidencia ou item nao verificado.

## Documentos

| Documento | Uso |
|---|---|
| [auditor-codex.md](auditor-codex.md) | Papel oficial, autoridade, regras e formato de decisao do auditor. |
| [roadmap.md](roadmap.md) | Fases da auditoria, gates e entregaveis por etapa. |
| [squads.md](squads.md) | Squads de auditoria, ownership e fluxo multiagente. |
| [checklists.md](checklists.md) | Checklists por dominio tecnico/produto. |
| [matriz-achados.md](matriz-achados.md) | Registro inicial de achados, riscos e evidencias. |
| [template-aceite-risco.md](template-aceite-risco.md) | Modelo obrigatorio para aceitar risco sem corrigir antes do marco. |
| [prompts-operacionais.md](prompts-operacionais.md) | Prompts para auditoria por PR, por squad e revisao independente. |
| [catalogo-prompts-pdf.md](catalogo-prompts-pdf.md) | Catalogo completo dos prompts e diretrizes extraidos do PDF de 154 paginas. |
| [prompts-auditores-pdf-completo.md](prompts-auditores-pdf-completo.md) | Conversao Markdown completa do PDF original, preservada pagina a pagina. |

Artefato operacional fora desta pasta:

- [../../.github/pull_request_template.md](../../.github/pull_request_template.md): template de PR com gate Codex, evidencias, areas sensiveis e riscos residuais.

## Taxonomia obrigatoria

| Classe | Definicao | Como registrar |
|---|---|---|
| Fato | Confirmado por arquivo, comando, teste ou artefato observado. | `Fato: ... Evidencia: <arquivo/comando>` |
| Evidencia | Saida, trecho, arquivo, teste ou comportamento observado. | `Evidencia E0-E5: ...` |
| Inferencia | Conclusao tecnica derivada de evidencia, mas nao diretamente provada. | `Inferencia: ... Base: ...` |
| Hipotese | Possibilidade ainda nao comprovada. | `Hipotese: ... Evidencia necessaria: ...` |
| Lacuna | Evidencia ausente ou insuficiente. | `Lacuna: Nao determinado com as evidencias disponiveis.` |
| Nao verificado | Item fora do teste executado nesta rodada. | `Status: Nao verificado. Motivo: ...` |

## Escalas

### Forca da evidencia

- `E0`: sem evidencia; apenas alegacao ou ausencia de material.
- `E1`: evidencia documental sem validacao tecnica.
- `E2`: evidencia de codigo/configuracao observada.
- `E3`: comando local, teste ou build executado uma vez.
- `E4`: teste seguro reproduzido ou validacao tecnica controlada.
- `E5`: evidencia independente confirmada por multiplas fontes.

### Confianca

- `Alta`: sustentada por E4 ou E5.
- `Media`: sustentada por E2 ou E3.
- `Baixa`: sustentada por E0 ou E1.

### Severidade

- `Critica`: risco de vazamento cross-tenant, execucao indevida, perda de dados, indisponibilidade grave, billing incorreto material ou exposicao sensivel.
- `Alta`: impacto relevante em seguranca, operacao, privacidade, conformidade, continuidade ou confiabilidade.
- `Media`: falha importante, mas com mitigacao, escopo restrito ou impacto nao imediato.
- `Baixa`: melhoria, inconsistencia documental ou risco operacional pequeno.

### Prioridade

- `P0`: bloqueia merge/release.
- `P1`: corrigir antes de homologacao ampla.
- `P2`: corrigir antes do go-live.
- `P3`: acompanhar no backlog.

## Gates bloqueantes

Nenhum PR deve avancar para `staging` ou `main` se:

- quebrar ou reduzir evidencia de isolamento multi-tenant;
- tocar em Prisma, RLS, auth, session, admin bypass, secrets, billing, prompts de IA em producao ou dependencias sem revisao reforcada;
- deixar CI, typecheck, lint ou testes obrigatorios sem status explicado;
- introduzir log com segredo, token, payload sensivel ou PII desnecessaria;
- retornar erro interno bruto para cliente;
- alterar contrato OpenAPI/shared-types sem declarar consumidores afetados;
- remover opt-out, idempotencia, auditoria ou rastreabilidade de fluxo critico.

## Baseline atual

Fato observado em 21/05/2026:

- O repo tem implementacao real em `apps/api`, `apps/web`, `apps/admin`, `apps/landing`, `packages/ui`, `packages/shared-types`, `packages/mocks`, Prisma, RLS e testes.
- Typecheck passou por pacote para API, web, admin, landing, shared-types e UI.
- `npm test` falhou porque `@prospix/shared-types` executa Vitest sem arquivos de teste.
- A API teve 121 testes passando; a suite falhou no teste RLS/multi-tenant por ausencia de Postgres local em `localhost:5432`.
- Os achados iniciais oficiais ficam em [matriz-achados.md](matriz-achados.md).

## Proxima acao

Antes de qualquer feature nova: resolver ou aceitar formalmente os achados `AUD-P0-001` a `AUD-P1-007` da matriz. Aceitacao de risco exige Gustavo como aprovador e Claude como revisor independente quando a severidade for Alta ou Critica.
