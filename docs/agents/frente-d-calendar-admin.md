# Frente D · Agendamento, Usage, Billing & Super-Admin

## Objetivo

Fechar o loop (Google Calendar agenda automática) + visibilidade (usage/billing Asaas) + ferramenta Guilds (super-admin com onboarding wizard, tenants, custos consolidados).

## Contexto mínimo

- Schema: models `Meeting`, `TenantUsage`, `TenantBilling`, `TenantInvitation`, `Notification` em [schema.prisma](../../apps/api/prisma/schema.prisma)
- Mocks: [packages/mocks/src/google-calendar.ts](../../packages/mocks/src/google-calendar.ts), `asaas.ts`
- Tool-call `schedule_meeting` vem da Frente C via BullMQ
- Onboarding wizard: PRD G.2 (6 passos)

## Contratos que entrega

```typescript
// Endpoints tenant
GET    /v1/tenant/meetings
GET    /v1/tenant/meetings/:id
PATCH  /v1/tenant/meetings/:id (outcome pós-reunião)
POST   /v1/tenant/meetings/:id/reschedule
GET    /v1/tenant/dashboard/today
GET    /v1/tenant/dashboard/funnel
GET    /v1/tenant/dashboard/performance
GET    /v1/tenant/dashboard/ai-usage
POST   /v1/tenant/integrations/google/oauth
GET    /v1/tenant/integrations/google/callback
GET    /v1/tenant/notifications

// Endpoints admin
GET/POST/PATCH  /v1/admin/tenants
POST            /v1/admin/tenants/:id/suspend|resume|churn
POST            /v1/admin/tenants/:id/invitations
GET             /v1/admin/usage?tenant_id?
GET             /v1/admin/usage/consolidated
GET/POST/PATCH  /v1/admin/templates
GET             /v1/admin/billing

// Webhooks
POST   /v1/webhooks/google/calendar
POST   /v1/webhooks/asaas

// Worker contracts
worker:schedule-meeting (event-driven)
worker:usage-aggregation (cron horário)
worker:daily-digest (cron 8h)
worker:billing-recurring (cron diário · checa Asaas vencimentos)
```

## Limites (NÃO TOCAR)

- `packages/*` (Frente A)
- `apps/api/src/middlewares/*` (Frente A)
- `apps/api/src/ai/*`, `integrations/{evolution,openai,anthropic,google-ai}.ts` (Frente C)
- `apps/api/src/integrations/{google-maps,brasilapi}.ts`, `workers/{capture,enrich}` (Frente B)
- `apps/web/*`, `apps/admin/*`, `apps/landing/*` (Frentes E/F)

## Tarefas

### D1 · Integração Google Calendar

**Arquivo:** `apps/api/src/integrations/google-calendar.ts`

**Funções:**
```typescript
export async function listEvents(params: {
  calendarId: string;
  refreshToken: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<Result<CalendarEvent[]>>;

export async function createEvent(params: {
  calendarId: string;
  refreshToken: string;
  event: { summary: string; start: Date; end: Date; description?: string; attendees?: Array<{ email: string }> };
}): Promise<Result<{ id: string }>>;

export async function watchChannel(...): Promise<Result<{ channelId: string }>>;
```

**Critério de aceite:**
- [ ] OAuth refresh token funciona (rotaciona quando expira)
- [ ] Mock MSW em `@prospix/mocks/google-calendar`
- [ ] Channel watch renovado antes de expirar (cron)

### D2 · OAuth Google flow

**Arquivos:**
- `apps/api/src/routes/tenant/integrations/google/oauth.ts` (POST · gera URL)
- `apps/api/src/routes/tenant/integrations/google/callback.ts` (GET · troca code por tokens)

**Critério de aceite:**
- [ ] Refresh token armazenado encrypted em `tenant_secrets.googleOauthRefreshEncrypted`
- [ ] Scopes solicitados: `calendar.events`, `calendar.readonly`
- [ ] State CSRF token validado

### D3 · Worker `schedule-meeting`

**Arquivo:** `apps/api/src/workers/schedule-meeting.ts`

**Lógica:**
1. Recebe tool-call da Frente C: `{ tenant_id, lead_id, scheduled_for, duration, location? }`
2. Verifica disponibilidade via Calendar (re-check)
3. Cria evento no Calendar do tenant
4. Insert em `meetings` com `google_event_id`
5. Insert em `lead_events`
6. Agenda lembretes D-1 e 1h antes (BullMQ delayed jobs)

**Critério de aceite:**
- [ ] Buffer de 15min respeitado
- [ ] Conflito de horário → retorna 2 horários alternativos
- [ ] Idempotente (mesmo `idempotency_key` não duplica)

### D4 · Routes `/tenant/meetings`

**Arquivos:** `apps/api/src/routes/tenant/meetings/*.ts`

**Critério de aceite:**
- [ ] Outcome update (closed/second_meeting/not_interested) registra `policy_value_cents`, `commission_cents`, `referrals_collected`
- [ ] Reschedule cria novo meeting + linka com `rescheduledFromId`
- [ ] Mudança status sincroniza com Calendar

### D5 · Dashboard endpoints

**Arquivos:**
- `apps/api/src/routes/tenant/dashboard/today.ts`
- `apps/api/src/routes/tenant/dashboard/funnel.ts`
- `apps/api/src/routes/tenant/dashboard/performance.ts`
- `apps/api/src/routes/tenant/dashboard/ai-usage.ts`

**Cache:** Redis 1min com SWR (stale-while-revalidate).

**Critério de aceite:**
- [ ] Today retorna meetings_today, conversations_ready, need_callback, new_leads_today
- [ ] Funnel retorna captured → whatsapp_valid → sent → responded → qualified → scheduled
- [ ] AI usage compara consumido vs franquia (alerta visual 70/90/100%)

### D6 · Worker `usage-aggregation`

**Arquivo:** `apps/api/src/workers/usage-aggregation.ts`

**Cron horário:**
- Agrega `messages.llm_*` por tenant + período
- Update `tenant_usage` (upsert por `(tenant_id, period_month)`)
- Se passa 70/90/100% da franquia → dispara `notifications`

**Critério de aceite:**
- [ ] Bate com custo real OpenAI/Anthropic/Google ± 5%
- [ ] Alertas disparados no threshold correto

### D7 · Worker `daily-digest`

**Arquivo:** `apps/api/src/workers/daily-digest.ts`

**Cron 8h da manhã (timezone do tenant):**
- Envia resumo WhatsApp via Evolution Guilds-master
- Conteúdo: meetings hoje, leads quentes, alertas, captura noite passada

### D8 · Super-admin API · tenants

**Arquivos:**
- `apps/api/src/routes/admin/tenants/{list,create,get,update,suspend,resume,churn}.ts`
- `apps/api/src/routes/admin/tenants/invitations/{create,revoke,list}.ts`

**Crítico:** super-admin usa connection role `guilds_admin` (BYPASSRLS).

**Critério de aceite:**
- [ ] Criar tenant via API leva ≤ 10min (com wizard frontend) → critério PRD 6.5b
- [ ] Suspend pausa todas campaigns (sem deletar)
- [ ] Churn inicia grace period 7 dias
- [ ] Audit log em todas operações

### D9 · Super-admin API · usage & billing

**Arquivos:**
- `apps/api/src/routes/admin/usage/*.ts`
- `apps/api/src/routes/admin/billing/*.ts`

**Critério de aceite:**
- [ ] Usage consolidado: tokens × custo × MRR por tenant → margem
- [ ] Lista billings vencidos
- [ ] Mark-as-paid manual (caso de boleto offline)

### D10 · Super-admin API · templates master library

**Arquivos:**
- `apps/api/src/routes/admin/templates/*.ts` (CRUD)

**Critério de aceite:**
- [ ] Listar templates por segmento
- [ ] Editar template (afeta apenas novos clones, não scripts existentes)
- [ ] Marcar template como `active: false` esconde dos tenants

### D11 · Integração Asaas (billing)

**Arquivos:**
- `apps/api/src/integrations/asaas.ts`
- `apps/api/src/workers/billing-recurring.ts`
- `apps/api/src/routes/webhooks/asaas.ts`

**Funções:**
```typescript
export async function createAsaasCustomer(...): Promise<Result<{ id: string }>>;
export async function createSubscription(...): Promise<Result<{ id: string }>>;
export async function createOneOffPayment(...): Promise<Result<{ id: string; invoiceUrl: string }>>;
```

**Critério de aceite:**
- [ ] Webhook valida assinatura `ASAAS_WEBHOOK_SECRET`
- [ ] `PAYMENT_CONFIRMED` → update `tenant_billing.status = PAID`
- [ ] `PAYMENT_OVERDUE` → dispara régua (D+3, D+7, D+15)
- [ ] Régua D+15 → suspende tenant automaticamente

### D12 · Notifications API

**Arquivos:**
- `apps/api/src/routes/tenant/notifications/*.ts`
- `apps/api/src/services/notification-service.ts`

**Critério de aceite:**
- [ ] Push (Fase 2), email (Resend), WhatsApp (Evolution) — config por user em `notification_preferences`
- [ ] Mark read individual + all
- [ ] Realtime: nova notification via Supabase Realtime

## Comandos de validação

```bash
pnpm --filter @prospix/api test src/integrations/google-calendar.test.ts
pnpm --filter @prospix/api test src/integrations/asaas.test.ts
pnpm --filter @prospix/api test src/workers/schedule-meeting.test.ts
pnpm --filter @prospix/api test src/workers/usage-aggregation.test.ts
pnpm --filter @prospix/api test src/routes/tenant/dashboard/
pnpm --filter @prospix/api test src/routes/admin/
```

## Definition of Done

- [ ] 100% das reuniões aceitas pelo lead criam evento no Calendar (PRD 6.4)
- [ ] Buffers 15min respeitados
- [ ] Usage bate com custo real ± 5%
- [ ] Criar Tenant #2 via admin leva ≤ 10min
- [ ] Asaas billing recorrente funcional (boleto + PIX + cartão)

## Changelog

- v1.0 (21/05/2026): spec inicial.
