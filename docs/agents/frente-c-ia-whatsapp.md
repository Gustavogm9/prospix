# Frente C · Motor de IA & WhatsApp (Evolution API)

## Objetivo

O cérebro do produto: fazer a IA conversar como o corretor (voice_profile customizado por tenant) via Evolution API, sem alucinação financeira, com aquecimento WhatsApp respeitado.

## Contexto mínimo

- Schema: models `Conversation`, `Message`, `Script`, `ScriptVariation`, `Optout`, `PromptVersion`, `TenantAIConfig` em [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)
- Algoritmo aquecimento: [PRD D.2](../PRD.md)
- Classificador de intent: [PRD D.3](../PRD.md)
- Guardrails: [PRD E.2](../PRD.md) (6 validações pre-send)
- Prompts: [PRD E.1](../PRD.md) (template Jinja-like)
- Mocks: [packages/mocks/src/evolution.ts](../../packages/mocks/src/evolution.ts), [openai.ts](../../packages/mocks/src/openai.ts)
- Voice profiles ficam em `Tenant.aiVoiceProfile` (JSONB)

## Contratos que entrega

```typescript
// Endpoints
GET    /v1/tenant/conversations
GET    /v1/tenant/conversations/:id/messages
POST   /v1/tenant/conversations/:id/messages (só se ai_handling=false)
PATCH  /v1/tenant/conversations/:id (assumir/liberar IA)
GET    /v1/tenant/scripts
POST   /v1/tenant/scripts/clone (de templates Guilds)
PATCH  /v1/tenant/scripts/:id
POST   /v1/tenant/scripts/:id/variations
POST   /v1/tenant/scripts/:id/test (preview)

// Webhooks
POST   /v1/webhooks/evolution/inbound
POST   /v1/webhooks/evolution/status
POST   /v1/webhooks/evolution/instance

// Worker contracts
worker:send-messages (event-driven · 1 concurrency por tenant)
worker:process-inbound (event-driven · lock por conversation_id)
worker:health-check (cron 5min · monitora Quality Rating)
worker:followup (cron diário 10h · D+3, D+7, D+14)
worker:cold-reactivation (cron mensal)

// AI provider abstraction
class AIRouter {
  async call(params: AICallParams): Promise<AICallResult>;
  // Lê TenantAIConfig do tenant atual, escolhe provider+model por use_case,
  // tenta fallback chain se primário falha.
}
```

## Limites (NÃO TOCAR)

- `packages/*` (Frente A)
- `apps/api/src/middlewares/*` (Frente A)
- `apps/api/src/integrations/{google-maps,brasilapi,google-calendar}.ts` (Frentes B/D)
- `apps/api/src/workers/{capture,enrich,schedule-meeting,usage-aggregation,daily-digest}` (Frentes B/D)
- `apps/api/prisma/schema.prisma` (Frente A revisa)
- **Aprovação obrigatória do Eng. IA + PM:** mudança em prompts em produção

## Tarefas

### C1 · Integração Evolution API

**Arquivo:** `apps/api/src/integrations/evolution.ts`

**Funções:**
```typescript
export interface EvolutionClient {
  sendText(params: { instance: string; apiKey: string; baseUrl: string; number: string; text: string }): Promise<Result<{ messageId: string }>>;
  checkNumbers(params: { instance: string; apiKey: string; baseUrl: string; numbers: string[] }): Promise<Result<Array<{ number: string; exists: boolean }>>>;
  getConnectionState(params: { instance: string; apiKey: string; baseUrl: string }): Promise<Result<{ state: 'open' | 'connecting' | 'close' }>>;
}

export function createEvolutionClient(secrets: TenantSecret): EvolutionClient;
// secrets já vêm descriptografados via Frente A
```

**Critério de aceite:**
- [ ] Mock MSW em `@prospix/mocks/evolution`
- [ ] HMAC validation nos webhooks recebidos
- [ ] Retry com backoff em 5xx
- [ ] Logs sem conteúdo de mensagem (privacidade)

### C2 · AI Router (multi-provider)

**Arquivo:** `apps/api/src/ai/router.ts`

**Lógica:**
1. Lê `TenantAIConfig` do tenant atual (cache 5min em Redis)
2. Para cada `use_case` (system / classifier / guardrail):
   - Provider primário: configurado no tenant ou fallback Guilds-shared
   - Se primário falha (5xx, timeout > 10s): tenta próximo da `fallback_chain`
3. Custo registrado em `Message.llm_*` (input/output tokens + cost cents)
4. Latência registrada em `Message.llm_latency_ms`

**Providers suportados:**
- `openai` (default: `gpt-4o-mini`)
- `anthropic` (default: `claude-3-5-haiku-20241022`)
- `google` (default: `gemini-1.5-flash`)

**Critério de aceite:**
- [ ] Trocar provider por config sem mudar código (test: muda `system_provider` no tenant → próxima call usa outro)
- [ ] Custo bate com pricing oficial ± 5%
- [ ] Test: provider primário fora → fallback assume

### C3 · Prompt builder

**Arquivo:** `apps/api/src/ai/prompt-builder.ts`

**Lógica:** PRD E.1 (template com `voice_profile`, contexto do lead, histórico, script atual, regras absolutas).

**Critério de aceite:**
- [ ] Output JSON sempre estruturado (não free-text)
- [ ] Variáveis `{{NOME}}`, `{{PROFISSAO}}`, `{{CIDADE}}`, `{{HORARIO_1}}`, `{{HORARIO_2}}` substituídas
- [ ] Quando voice_profile tem `signature_phrases`, inclui no prompt
- [ ] Test snapshot: prompt gerado é estável (não muda por mudança de horário etc)

### C4 · Classificador de intenção

**Arquivo:** `apps/api/src/ai/classifier.ts`

**Spec:** PRD D.3 — 12 categorias + fallback rule-based.

**Critério de aceite:**
- [ ] `temperature: 0.0` (consistência)
- [ ] Coverage 100% das 12 categorias em testes
- [ ] Fallback rule-based quando IA falha
- [ ] Confidence < 0.4 em 2 mensagens consecutivas → escala humano

### C5 · Guardrails (6 validações pre-send)

**Arquivo:** `apps/api/src/ai/guardrails.ts`

**Spec:** PRD E.2 (exato).

**Critério de aceite:**
- [ ] 6 guardrails implementados
- [ ] Quando falha: re-tenta 1× com prompt corretivo, depois escala humano
- [ ] Teste: cada guardrail rejeita um caso conhecido
- [ ] Test: mensagem com `R$ 500` é rejeitada (mentions_specific_money)

### C6 · Script engine (state machine)

**Arquivo:** `apps/api/src/ai/script-engine.ts`

**Lógica:**
- Carrega `Script.flow` (JSON) e `Conversation.currentNodeId`
- Executa próximo node baseado em intent classificado
- Transições: trigger → wait → message → decision → ...
- Tracking: `Message.scriptNodeId` e `scriptVariationId`

**Critério de aceite:**
- [ ] Suporta os 6 tipos de node do PRD 8.1 (trigger, wait, message, decision, action, end)
- [ ] State persistido em `Conversation.currentNodeId`
- [ ] A/B/C variations sorteadas por `weight`

### C7 · Worker `process-inbound`

**Arquivo:** `apps/api/src/workers/process-inbound.ts`

**Lógica:**
1. Lock por `conversation_id` (TTL 60s)
2. Carrega histórico de mensagens
3. Detecta opt-out (regex hard-coded antes da IA) → insere em `optouts`, encerra
4. Classificador → intent
5. Script engine + prompt builder + AI router → resposta
6. Guardrails → valida resposta
7. Enfileira `send-messages`

**Critério de aceite:**
- [ ] Lock previne race condition (2 mensagens em 5s do mesmo lead)
- [ ] Opt-out detectado em ≤ 1min
- [ ] Test E2E: webhook inbound → resposta enviada no mock Evolution

### C8 · Worker `send-messages` (com aquecimento)

**Arquivo:** `apps/api/src/workers/send-messages.ts`

**Spec:** PRD D.2 (cronograma de aquecimento exato).

**Função-chave:**
```typescript
async function canSendMessage(tenant: Tenant): Promise<{ allowed: boolean; reason?: string }>;
```

**Critério de aceite:**
- [ ] Cronograma D1-D30 respeitado (5 → 200 msgs/dia)
- [ ] Jitter 40-90s entre mensagens
- [ ] Pausa 18h-9h
- [ ] Sem envio domingo · sábado tarde
- [ ] Quality Rating RED → pausa todas campaigns automaticamente

### C9 · Webhook handlers Evolution

**Arquivos:**
- `apps/api/src/routes/webhooks/evolution/inbound.ts`
- `apps/api/src/routes/webhooks/evolution/status.ts`
- `apps/api/src/routes/webhooks/evolution/instance.ts`

**Critério de aceite:**
- [ ] HMAC validation (rejeita 401 se inválido)
- [ ] Resolve tenant via `instance_name` (busca em `tenant_secrets`)
- [ ] Idempotência: mesmo `messageId` 2× = 200 + duplicate flag
- [ ] ACK em < 5s (enfileira processamento, não processa síncrono)

### C10 · Worker `health-check`

**Arquivo:** `apps/api/src/workers/health-check.ts`

**Cron 5min:**
- Para cada tenant ACTIVE, chama `getConnectionState`
- Se `state != 'open'` por > 10min → alerta crítico
- Quality Rating monitor (Evolution expõe via webhook ou polling)

### C11 · Scripts CRUD + templates clone

**Arquivos:**
- `apps/api/src/routes/tenant/scripts/*.ts`

**Critério de aceite:**
- [ ] GET `/tenant/scripts/templates` lista master library
- [ ] POST `/tenant/scripts/clone` clona template → cria Script com `clonedFromTemplateId`
- [ ] Variations CRUD funcional

### C12 · Test cases CI obrigatórios

**Arquivo:** `apps/api/tests/ai/prompt-validation.test.ts`

**Spec:** PRD E.4 (≥ 30 test cases cobrindo intents + guardrails).

**Critério de aceite:**
- [ ] Test "não cita R$ específico" passa
- [ ] Test "escala humano quando lead pede ligação" passa
- [ ] Test "opt-out detectado" passa
- [ ] Coverage 100% das categorias de intent

## Comandos de validação

```bash
pnpm --filter @prospix/api test src/integrations/evolution.test.ts
pnpm --filter @prospix/api test src/ai/
pnpm --filter @prospix/api test src/workers/process-inbound.test.ts
pnpm --filter @prospix/api test src/workers/send-messages.test.ts
pnpm --filter @prospix/api test tests/ai/prompt-validation.test.ts
```

## Definition of Done

- [ ] IA responde corretamente ≥ 95% em testes (50 contatos reais ou simulados)
- [ ] Zero alucinação de valores em testes de aceite
- [ ] Opt-out efetivo ≤ 1min
- [ ] Aquecimento respeitado (Quality Rating verde após 30d)
- [ ] AI Router troca provider por config (test prova)

## Changelog

- v1.0 (21/05/2026): spec inicial.
