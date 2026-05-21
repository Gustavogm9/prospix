# Frente B · Captura & Enriquecimento

## Objetivo

Encher o funil: capturar leads via Google Maps + Receita Federal, validar WhatsApp, calcular fit score, e expor APIs `/tenant/leads` e `/tenant/campaigns`.

## Contexto mínimo

- Schema: models `Lead`, `Campaign`, `LeadEvent` em [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)
- Fit score algorithm: [PRD anexo D.1](../PRD.md) (fórmula com pesos)
- Mocks: [packages/mocks/src/google-maps.ts](../../packages/mocks/src/google-maps.ts), `brasilapi.ts` (criar)
- Base worker (Frente A): `apps/api/src/workers/_base-worker.ts`
- Evolution API (Frente C): só consumir endpoint `check-phone` via mock até S5

## Contratos que entrega

```typescript
// Endpoints REST (consumidos pela Frente E)
GET    /v1/tenant/leads
GET    /v1/tenant/leads/:id
POST   /v1/tenant/leads (manual)
PATCH  /v1/tenant/leads/:id
DELETE /v1/tenant/leads/:id (soft delete)
GET    /v1/tenant/campaigns
POST   /v1/tenant/campaigns
PATCH  /v1/tenant/campaigns/:id
POST   /v1/tenant/campaigns/:id/pause
POST   /v1/tenant/campaigns/:id/resume

// Worker contracts
worker:capture-google-maps
  Input:  { tenant_id, campaign_id, max_captures, trace_id }
  Output: insert N rows em leads (status: CAPTURED), lead_events, tenant_usage++

worker:enrich-leads
  Input:  { tenant_id, lead_ids[], trace_id }
  Output: update leads (whatsapp_valid, fit_score, status: ENRICHED), lead_events
```

## Limites (NÃO TOCAR)

- `packages/*` (Frente A)
- `apps/api/src/middlewares/*` (Frente A)
- `apps/api/src/ai/*` (Frente C)
- `apps/api/src/integrations/evolution.ts` (Frente C — só consumir contrato via interface)
- `apps/api/prisma/schema.prisma` (Frente A revisa)
- Schema changes (PR específico)

## Tarefas

### B1 · Integração Google Maps Places API

**Arquivo:** `apps/api/src/integrations/google-maps.ts`

**Funções esperadas:**
```typescript
export async function searchPlaces(params: {
  query: string;           // "cardiologista São José do Rio Preto"
  apiKey: string;          // do tenant_secrets
  maxResults?: number;
}): Promise<Result<PlaceResult[]>>;

export async function getPlaceDetails(params: {
  placeId: string;
  apiKey: string;
}): Promise<Result<PlaceDetailedResult>>;
```

**Critério de aceite:**
- [ ] Mock em testes via MSW (`@prospix/mocks/google-maps`)
- [ ] Rate limit respeitado (100 QPS · simulado em testes)
- [ ] Erro 403/billing identificado e propagado como `EXTERNAL_SERVICE_DOWN`
- [ ] Field mask configurado (só campos necessários, reduz custo)

### B2 · Integração BrasilAPI (CNPJ)

**Arquivo:** `apps/api/src/integrations/brasilapi.ts`

```typescript
export async function getCnpjInfo(cnpj: string): Promise<Result<CnpjInfo>>;
// Fallback: ReceitaWS se BrasilAPI falhar (mesma assinatura)
```

**Critério de aceite:**
- [ ] Cache em Redis (TTL 7 dias por CNPJ)
- [ ] Rate limit 3 req/s respeitado (token bucket)
- [ ] Fallback para ReceitaWS se BrasilAPI retornar 5xx

### B3 · Algoritmo Fit Score

**Arquivo:** `apps/api/src/domain/fit-score.ts`

**Spec:** PRD anexo D.1 (fórmula exata com pesos).

```typescript
export function calculateFitScore(
  lead: LeadInput,
  campaign: Campaign,
  tenant: { highValueAreas: string[] }
): number;
// retorna 0.0 a 10.0 (cap em ambos extremos)
```

**Critério de aceite (≥ 90% coverage):**
- [ ] Teste cada componente da fórmula isoladamente
- [ ] Teste cenários de penalty (-∞ → skip)
- [ ] Teste threshold mínimo configurável por campaign
- [ ] Teste edge cases: lead sem profissão, sem WhatsApp, sem rating

### B4 · Worker `capture-google-maps`

**Arquivo:** `apps/api/src/workers/capture-google-maps.ts`

**Frequência:** cron 1h em horário comercial (configurar com node-cron ou BullMQ repeat).

**Lógica:**
1. Para cada campaign ACTIVE no tenant:
   - Constrói query: `{profession} {city}` + neighborhoods
   - Para cada result, verifica se `place_id` não está em `leads.source_external_id` desse tenant
   - Insert em `leads` (status: CAPTURED) com dados brutos em `source_raw_data`
   - Insert em `lead_events` (event_type: `captured`)
   - Respeita `daily_limit` da campaign
2. Update `tenant_usage.google_maps_calls`

**Critério de aceite:**
- [ ] Lock distribuído `lock:capture:{tenant_id}:{campaign_id}` (TTL 10min)
- [ ] Idempotente: se rodar 2× consecutivamente, não duplica leads
- [ ] Logs estruturados com `tenant_id`, `campaign_id`, `captured_count`

### B5 · Worker `enrich-leads`

**Arquivo:** `apps/api/src/workers/enrich-leads.ts`

**Lógica:**
1. Carrega batch de até 100 leads `CAPTURED` do tenant
2. Para cada:
   - Valida WhatsApp via Evolution API (interface da Frente C)
   - Se profissão = ENTREPRENEUR e tem CNPJ no metadata: enriquece com BrasilAPI
   - Calcula `fit_score`
   - Update lead (status: ENRICHED ou ARCHIVED se fit < threshold)
3. Insert em `lead_events`

**Critério de aceite:**
- [ ] Processa até 5 jobs paralelos por tenant
- [ ] Retry com backoff (5×)
- [ ] DLQ funcional

### B6 · Routes `/tenant/leads`

**Arquivos:**
- `apps/api/src/routes/tenant/leads/list.ts` (GET com filtros + paginação cursor)
- `apps/api/src/routes/tenant/leads/get.ts`
- `apps/api/src/routes/tenant/leads/create.ts`
- `apps/api/src/routes/tenant/leads/update.ts`
- `apps/api/src/routes/tenant/leads/delete.ts`
- `apps/api/src/routes/tenant/leads/optout.ts`
- `apps/api/src/routes/tenant/leads/notes.ts`

**Schema validation:** Zod em cada handler.

**Critério de aceite:**
- [ ] Endpoints respondem conforme OpenAPI
- [ ] Filtros funcionam: `status`, `fit_score_gte`, `profession`, `campaign_id`, `search`
- [ ] Paginação cursor-based (não offset)
- [ ] Teste de isolamento multi-tenant: tenant A não vê leads de B (deve passar com RLS)

### B7 · Routes `/tenant/campaigns`

**Arquivos:**
- `apps/api/src/routes/tenant/campaigns/*.ts`

**Critério de aceite:**
- [ ] CRUD completo + pause/resume
- [ ] Validação: `cities[]` não vazio, `daily_limit` > 0, etc
- [ ] Soft delete (status: ARCHIVED, não DELETE físico)

## Comandos de validação

```bash
pnpm --filter @prospix/api test src/integrations/google-maps.test.ts
pnpm --filter @prospix/api test src/integrations/brasilapi.test.ts
pnpm --filter @prospix/api test src/domain/fit-score.test.ts
pnpm --filter @prospix/api test src/workers/capture-google-maps.test.ts
pnpm --filter @prospix/api test src/routes/tenant/leads.test.ts
pnpm --filter @prospix/api test src/routes/tenant/campaigns.test.ts
```

## Definition of Done

- [ ] Captura 100+ leads válidos no primeiro dia de produção (PRD 6.2)
- [ ] ≥ 90% leads enriquecidos com WhatsApp validado
- [ ] Zero duplicatas (constraint `(tenant_id, whatsapp)` respeitado)
- [ ] Fit score com testes cobrindo todos os componentes
- [ ] Endpoints batem 1:1 com OpenAPI

## Changelog

- v1.0 (21/05/2026): spec inicial.
