# Protocolo de Conflitos Multiagente

Conflito e qualquer divergencia que impeça uma tarefa de seguir com confianca: ownership, evidencia, contrato, comportamento, risco, prioridade ou interpretacao de spec.

## Tipos de conflito

| Tipo | Exemplo | Arbitro |
|---|---|---|
| Ownership | Dois agentes precisam editar o mesmo arquivo. | Codex |
| Evidencia | Teste local passa, CI falha, ou comando nao reproduz. | Codex |
| Contrato | OpenAPI/shared-types divergem do backend/frontend. | Squad 2 + Codex |
| Seguranca | RLS/auth/logs/secrets com risco P0/P1. | Squad 1 + Codex + Claude |
| Produto | PRD e implementacao indicam comportamentos diferentes. | Gustavo + Codex |
| Compliance | LGPD, opt-out, retencao ou consentimento indefinido. | Squad 6 + Gustavo |
| Go-live | Risco residual antes de release. | Codex + Gustavo |

## Regra de congelamento

Quando um conflito envolve RLS, auth, secrets, billing, opt-out, dados pessoais, migracoes ou contrato compartilhado, o arquivo afetado fica congelado para novos PRs ate haver decisao registrada.

## Como registrar

- ID: `CF-YYYYMMDD-NN`
- Tipo:
- Tarefa/PR:
- Arquivos afetados:
- Agentes envolvidos:
- Evidencias:
- Decisao necessaria:
- Arbitro:
- Prazo:
- Status: Aberto / Em analise / Resolvido / Aceito com risco / Cancelado

## SLA de decisao

- P0: mesmo dia.
- P1: ate 24h.
- P2: ate 3 dias uteis.
- P3: backlog.

## Ordem de autoridade

1. Evidencia tecnica reproduzivel.
2. PRD e contratos oficiais.
3. Specs em `docs/agents`.
4. Decisao Codex como auditor para risco tecnico.
5. Revisao Claude para achados altos/criticos.
6. Decisao Gustavo para tradeoff excepcional de produto/risco.

## Saidas possiveis

- `Resolvido por correcao`: codigo/docs alterados e evidencia registrada.
- `Resolvido por escopo`: tarefa reduzida ou dividida.
- `Aceito com risco`: exige [template-aceite-risco.md](template-aceite-risco.md).
- `Bloqueado`: nao pode seguir ate nova evidencia.
- `Nao determinado`: faltam evidencias para decisao.
