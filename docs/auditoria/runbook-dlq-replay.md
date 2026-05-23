# Runbook DLQ e Replay

Atualizado em 22/05/2026.

## Estado atual

O Prospix ainda nao possui uma DLQ fisica nem replay automatizado aprovado para producao. O estado atual e de **inspecao auditavel de falhas BullMQ**:

- `queue:retry`: job falhou, mas ainda tem tentativas disponiveis.
- `queue:failed-exhausted`: job esgotou tentativas e ficou preservado em `removeOnFail: false`.
- `queue:failure-orphaned`: evento de falha recebido, mas o job nao foi encontrado no Redis.

Esses eventos nao significam que o replay e seguro. Eles registram metadados minimos para triagem: fila, worker, job id, nome do job, tenant id, trace id, tentativas, motivo da falha e este runbook. Payload bruto, corpo de mensagem, telefone, segredo e conteudo de lead nao devem ser logados.

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

Enquanto este runbook estiver em modo de inspecao, `AUD-P1-021` permanece em mitigacao, nao resolvido. Para go-live, e necessario provar falha esgotada, alerta, triagem, replay ou decisao explicita de nao replay por worker, com Redis real.
