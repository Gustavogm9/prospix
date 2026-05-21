# Checklists de Auditoria

## Checklist global por PR

- [ ] Frente e squad dono declarados.
- [ ] Arquivos tocados respeitam ownership ou possuem justificativa.
- [ ] Comandos executados registrados.
- [ ] Testes relevantes verdes ou lacuna justificada.
- [ ] Evidencias classificadas E0-E5.
- [ ] Gate Codex preenchido no PR quando tocar area sensivel.
- [ ] Nenhum segredo, token, senha, chave privada ou PII sensivel aparece em diff/log/doc.
- [ ] Mudancas de schema, RLS, OpenAPI, shared-types, auth, billing, prompts ou dependencias possuem revisao reforcada.
- [ ] Riscos residuais tem dono e prazo.
- [ ] Aceite de risco, quando usado, segue [template-aceite-risco.md](template-aceite-risco.md).

## Foundation/Security

- [ ] RLS habilitado em tabelas de dominio com `tenant_id`.
- [ ] RLS tem teste DB-backed com tenant A, tenant B e tenant vazio.
- [ ] `set_config` e transacoes mantem contexto durante queries protegidas.
- [ ] Pool Prisma nao reaproveita role ou tenant context indevido.
- [ ] Admin bypass e restrito a `GUILDS_ADMIN` e reseta estado de conexao.
- [ ] JWT usa algoritmo e chaves corretas.
- [ ] Refresh token e revogacao estao cobertos por teste.
- [ ] Secrets sao criptografados e nunca logados.
- [ ] Variaveis obrigatorias falham de forma segura.

## API/Contracts/Data

- [ ] Toda entrada externa passa por Zod ou equivalente.
- [ ] Rotas tenant usam `req.tenantId` e filtro por tenant quando aplicavel.
- [ ] Rotas admin exigem role no backend.
- [ ] Webhooks validam assinatura/segredo quando disponivel.
- [ ] Erros publicos nao retornam stack, mensagem interna ou payload sensivel.
- [ ] OpenAPI reflete endpoints reais.
- [ ] shared-types refletem Prisma/OpenAPI.
- [ ] Paginacao, filtros e status tem contrato consistente.

## Workers/IA/WhatsApp

- [ ] Todo job valida `tenant_id`.
- [ ] Fila tem nome por tenant ou isolamento equivalente.
- [ ] Worker registra `job_id`, `tenant_id`, duracao e resultado.
- [ ] Retry, backoff e DLQ estao definidos para falhas externas.
- [ ] Opt-out bloqueia envio e registra evento.
- [ ] Guardrails cobrem preco, promessa indevida, opt-out, baixa confianca e escalacao.
- [ ] Prompt injection e entrada indireta sao tratados como risco.
- [ ] Custos de IA e WhatsApp sao rastreados.

## Frontend/UX

- [ ] API client envia Authorization e `X-Tenant-Id` quando necessario.
- [ ] Refresh token nao cria loop infinito.
- [ ] Login/callback/logout tem estados de erro.
- [ ] Admin UI nao confia apenas em controle visual para autorizacao.
- [ ] Componentes respeitam responsividade e acessibilidade.
- [ ] Estados vazio/loading/erro existem em fluxos principais.
- [ ] Dados sensiveis nao aparecem em URL, console ou texto publico.

## DevEx/CI/CD/Docs

- [ ] `pnpm typecheck` roda por pacote.
- [ ] `test:unit` nao exige Postgres/Redis.
- [ ] `test:multi-tenant` sobe ou exige Postgres explicitamente.
- [ ] CI aplica migrations e RLS antes de teste DB-backed.
- [ ] `pnpm audit` ou equivalente roda e tem politica de falha.
- [ ] Docs indicam estado real do projeto.
- [ ] PR template exige evidencias, gate Codex e areas sensiveis.
- [ ] README permite subir dev local de forma reproduzivel.

## Produto/Compliance

- [ ] Opt-out tem texto, fluxo e SLA definidos.
- [ ] Termos e privacidade cobrem dados coletados.
- [ ] Retencao e exclusao de dados estao documentadas.
- [ ] Billing tem trilha de auditoria.
- [ ] Suspensao e churn preservam dados conforme regra.
- [ ] IA nao faz promessa comercial ou tecnica sem autorizacao.
- [ ] Logs e suporte nao expõem dados sensiveis do lead.

## Go-live

- [ ] Smoke E2E capturar -> enriquecer -> conversar -> agendar passou.
- [ ] RLS e auth aprovados pelo Squad 1.
- [ ] Observabilidade tem logs, metricas, alertas e runbooks.
- [ ] Backup/restore testado ou lacuna aceita formalmente.
- [ ] Riscos P0 zerados.
- [ ] P1 resolvidos ou aceitos por Gustavo + revisados por Claude.
- [ ] Relatorio final emitido por Codex.
