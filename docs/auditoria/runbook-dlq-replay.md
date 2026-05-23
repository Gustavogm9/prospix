# Runbook DLQ e Replay

Atualizado em 23/05/2026.

## Estado atual

O Prospix possui **DLQ fisica habilitada** (`apps/api/src/lib/dlq.ts`). Cada worker
`worker_name` tem uma fila DLQ paralela `dlq-<worker_name>`. Jobs que esgotam
tentativas (`failed-exhausted`) sao automaticamente enfileirados na DLQ pelo
observer em `apps/api/src/lib/queue.ts`, idempotentes por `source_job_id`.

**Eventos auditaveis:**

- `queue:retry`: job falhou, mas ainda tem tentativas disponiveis.
- `queue:failed-exhausted`: job esgotou tentativas; movido para DLQ fisica.
- `queue:dlq-enqueued`: confirmacao de enqueue na DLQ (com `dlq_physical: true`).
- `queue:failure-orphaned`: evento de falha recebido, mas o job nao foi encontrado no Redis.
- `queue:dlq-replayed`: replay manual efetuado (registra `approved_by`, `reason`).
- `queue:dlq-replay-dry-run`: validacao sem efeito colateral.
- `queue:dlq-replay-blocked-by-allowlist`: tentativa de replay barrada pela allowlist.
- `queue:dlq-purged`: job removido manualmente (com `approved_by`, `reason`).

Esses eventos nao incluem payload bruto, corpo de mensagem, telefone, segredo
ou conteudo de lead — somente metadados de triagem.

## Endpoints admin

- `GET /v1/admin/dlq` · resumo + allowlist + runbook
- `GET /v1/admin/dlq/:worker` · lista jobs (filtros: `limit`, `offset`, `tenant_id`)
- `POST /v1/admin/dlq/:worker/:dlqJobId/replay` · replay (allowlist + `approved_by` + `reason`; `dry_run` opcional)
- `DELETE /v1/admin/dlq/:worker/:dlqJobId` · purge (sem replay; exige `approved_by` + `reason`)

## Triagem manual

1. Identificar o evento pelo log e coletar `queue`, `worker`, `job_id`, `tenant_id`, `trace_id`, `attempts_made` e `failed_reason`.
2. Consultar o job no Redis/BullMQ em ambiente controlado.
3. Confirmar se o job ainda existe. Se nao existir, classificar como `queue:failure-orphaned` e abrir achado operacional.
4. Verificar se o job e idempotente antes de qualquer acao manual.
5. Conferir se a repeticao pode gerar efeitos duplicados:
   - nova mensagem WhatsApp;
   - novo opt-out;
   - novo agendamento;
   - nova cobranca;
   - nova chamada paga de IA;
   - nova escrita cross-tenant.
6. Conferir se `tenant_id` do job bate com a entidade persistida.
7. Registrar decisao na matriz de achados ou handoff multiagente.

## Criterios antes de replay

Replay so pode ser habilitado depois que todos os itens abaixo estiverem provados:

- Redis real executando em ambiente de teste/staging.
- Postgres real com migrations e RLS aplicados.
- Teste de idempotencia para o worker afetado.
- Teste de tenant mismatch/IDOR quando houver entidade tenant-scoped.
- Alerta operacional para `queue:failed-exhausted`.
- Comando de replay com dry-run e allowlist por fila.
- Registro de quem aprovou, horario, motivo e resultado.

## Regras por tipo de worker

| Worker | Replay automatico | Condicao minima |
|---|---|---|
| `process-inbound` | Nao aprovado | Provar dedupe por `whatsappMessageId`, transacao inbound+contador e opt-out idempotente com DB real. |
| `send-messages` | Nao aprovado | Provar `jobId` deterministico, opt-out, janela de reagendamento e ausencia de duplicidade de envio. |
| `send-notification` | Nao aprovado | Provar preferencia de notificacao, canal e idempotencia por evento. |
| `schedule-meeting` | Nao aprovado | Provar ausencia de duplicidade de agenda e notificacoes. |
| `capture-google-maps` | Nao aprovado | Provar limite de quota/custo e dedupe de lead. |
| `enrich-leads` | Nao aprovado | Provar guardrails, quota IA e idempotencia de enriquecimento. |
| `daily-digest` | Nao aprovado | Provar scheduler tenant-scoped e uma execucao por janela. |
| `usage-aggregation` | Nao aprovado | Provar janela de agregacao e reprocessamento deterministico. |
| `billing-suspension` | Nao aprovado | Exigir revisao humana; impacto comercial direto. |
| `health-check` | Pode ser manual | Somente se nao alterar estado comercial ou mensagens externas. |

## Gate de go-live

`AUD-P1-021` passa de "Em mitigacao" para "Em mitigacao avancada" com DLQ
fisica habilitada + endpoints admin + allowlist por worker. Para `Resolvido`
no go-live ainda e necessario:

- Reproduzir prova Redis-backed (`evolution-idempotency.redis-db.test.ts`
  estilo) provando que `failed-exhausted` enfileira na DLQ.
- Adicionar workers a `DLQ_REPLAYABLE_WORKERS` conforme prova de idempotencia
  for sendo entregue.
- Conectar alerta operacional (Sentry/Slack) ao evento `queue:dlq-enqueued`.
