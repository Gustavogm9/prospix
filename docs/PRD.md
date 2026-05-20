# PRD Técnico · Sistema de Prospecção Inteligente · Plataforma Prospix

> **Uso interno Guilds** · documento de referência para o time de desenvolvimento, suporte e operação.
> **Primeiro cliente (Tenant #1):** Giovane Carrara · Corretor parceiro MetLife · São José do Rio Preto, SP
> **Posicionamento estratégico:** plataforma **multi-tenant desde o Day 1** — Guilds vai revender a mesma estrutura para outros corretores (MetLife, Bradesco, Prudential) e segmentos correlatos.
> Data: 18/05/2026 · Versão 1.1 · Aprovação Tenant #1: R$ 7.900 setup + R$ 490/mês (kickoff confirmado)
> Project lead: Gustavo Macedo · gustavo.macedo@guilds.com.br

---

## 0. Arquitetura Multi-Tenant · decisão fundadora

**Toda decisão de arquitetura, modelo de dados e UX desta plataforma pressupõe múltiplos clientes operando isoladamente na mesma base de código e infraestrutura.**

### 0.1 Por que multi-tenant desde o início
- **Reuso do investimento:** cada novo cliente paga setup novo, mas a Guilds só configura — sem rebuild
- **Escala da operação:** 10 clientes × R$ 490/mês = R$ 4.900 de MRR com infra praticamente fixa
- **Time-to-market do 2º cliente:** de 35 dias → 7-10 dias (só onboarding, sem código novo)
- **Refatorar depois custa caro:** retrofit de multi-tenancy em sistema single-tenant é um dos piores débitos técnicos possíveis

### 0.2 Modelo de isolamento adotado
**Shared database, shared schema, row-level isolation** via:
- Coluna `tenant_id UUID NOT NULL` em **todas** as tabelas de domínio
- PostgreSQL Row Level Security (RLS) ativo · policies por `current_setting('app.tenant_id')`
- Middleware obrigatório na API que injeta `tenant_id` no contexto da request
- Validação de UI defensiva (frontend nunca aceita resposta com `tenant_id` diferente do logado)

**Não escolhemos schema-per-tenant nem database-per-tenant** porque:
- Volume previsto não justifica complexidade operacional
- Custo de infra cresceria linearmente
- Migrations seriam pesadelo
- RLS do PostgreSQL é maduro e seguro o suficiente

### 0.3 Hierarquia
```
Guilds (super-admin)
  └── Tenant #1 · Giovane Carrara (MetLife · SJRP)
  └── Tenant #2 · [futuro · ex: Roberta · Prudential · SP]
  └── Tenant #3 · [futuro · ex: Carlos · Bradesco Vida · Campinas]
  └── ...
```

Cada Tenant pode ter:
- 1 **Owner** (corretor titular)
- N **Assistants** (futuro · ex: secretária do escritório)
- Suas próprias campanhas, roteiros, leads, agenda, integrações

**Guilds super-admin** vê:
- Lista de todos tenants + health
- MRR consolidado
- Custos consolidados (IA, infra, suporte)
- Tickets de suporte
- Templates de roteiros compartilháveis (biblioteca master)

---

## 1. Visão Geral

### 1.1 Problema
Giovane é corretor MetLife autônomo. Sua matemática hoje: **ligar 100 para falar com 10**, e dessas 10 fechar 1-2 reuniões. Sexta-feira inteira queimada no telefone só para encher a próxima semana. A operação não escala — sem ele no telefone, a fila esvazia.

### 1.2 Solução
Plataforma sob medida que **automatiza prospecção, qualificação e agendamento** de leads via WhatsApp com IA treinada na linguagem MetLife do Giovane (base vitalícia, IPCA+3%, proteção de renda).

- A IA captura prospects (médicos, advogados, dentistas, empresários de SJRP) via Google Maps + Receita Federal
- Aborda via WhatsApp com cadência humana e roteiros treinados
- Marca reunião direto no Google Calendar do Giovane
- Giovane só aparece nas reuniões já filtradas

### 1.3 Resultado esperado
- Mês 1 (aquecimento): 5-10 reuniões agendadas
- Mês 2 (ramp-up): 15-20 reuniões/mês
- Mês 3+ (regime pleno): **25-40 reuniões/mês** com ~10 apólices fechadas
- ROI projetado: 33-50× sobre custo mensal total (~R$ 1.500)

### 1.4 Status do projeto
- **Aprovado pelo Tenant #1:** Fase 1 (MVP) — R$ 7.900 + R$ 490/mês
- **Faseamento previsto:** Fase 2+ (adicionais) liberados conforme cliente extrai valor da Fase 1 e contrata expansões
- **Kickoff:** D+5 após assinatura
- **Go-live Tenant #1:** D+35 (5 semanas úteis)

### 1.5 Produto sob marca Guilds (white-label opcional na Fase 3)
- Marca padrão: **Prospix** (nome interno) com co-brand do tenant
- Cada tenant vê seu próprio nome/foto/credenciais no painel — não vê outros tenants
- White-label completo (sem marca Guilds) entra como upsell futuro

---

## 2. Stakeholders e Personas

### 2.1 Stakeholders
| Quem | Papel | Escopo |
|---|---|---|
| **Gustavo Macedo (Guilds)** | Super-admin · Project lead · interface comercial | Vê todos tenants |
| Lead Engineer (Guilds) | Arquitetura + desenvolvimento backend | Vê todos tenants |
| Eng. IA (Guilds) | Calibração de roteiros + treino do agente | Vê todos tenants |
| Dev Frontend (Guilds) | Painel web React + Super-admin | Vê todos tenants |
| PM/Suporte (Guilds) | Hypercare + 2h/mês de evolução por tenant | Vê todos tenants |
| **Giovane Carrara (Tenant #1 · Owner)** | Operador final · valida roteiros · feedback | Vê só seu tenant |
| *Futuros owners (Tenant #2+)* | Mesmo papel do Giovane | Vê só seu tenant |
| *Futuros assistants (Fase 2)* | Suporte ao owner dentro do tenant | Vê só seu tenant, com permissões reduzidas |

### 2.2 Persona principal — Giovane (operador)
- 6 anos de carreira MetLife
- Trabalha 100% via recomendações + networking
- Não-técnico (precisa interface didática)
- Decide rápido se vê resultado
- Ponto de atenção: pode resistir a usar "sistema novo" — UX precisa ser óbvia (já provado no protótipo aprovado)

### 2.3 Personas dos leads abordados pela IA
| Persona | Características | Roteiro |
|---|---|---|
| **Médico** (cardio/ortopedia/dermato/pediatra) | 35-55a, consultório próprio, renda alta, dependência da própria atuação | `script_medicos_v1` |
| **Advogado sócio** | 35-60a, escritório próprio ou sócio, OAB-SP ativa | `script_advogados_v1` |
| **Empresário** (CNAE serviços) | Dono ativo, 2-10 funcionários, decisor único | `script_empresarios_v1` |
| Dentista (clínica própria) | 30-50a, CRO-SP, clínica registrada | `script_medicos_v1` (variante dentista) |

---

## 3. Arquitetura Técnica

### 3.1 Stack
```
FRONTEND  · React 18 + Vite + Tailwind CSS + shadcn/ui + Chart.js
BACKEND   · Node.js 20 + Fastify + Prisma ORM
BANCO     · PostgreSQL 16 (Supabase)
CACHE/Q   · Redis (Upstash) + BullMQ para filas
IA        · OpenAI GPT-4o-mini (default) | fallback Claude Haiku 3.5
INFRA     · Railway (API + worker) + Supabase (DB) + Cloudflare R2 (assets)
DEPLOY    · GitHub Actions → Railway (CI/CD)
MONITOR   · Sentry (errors) + BetterStack (uptime) + Posthog (analytics)
AUTH      · Supabase Auth (magic link via WhatsApp)
```

### 3.2 Componentes principais (multi-tenant)
```
┌───────────────────────────────────────────────────────────────────────┐
│            SUPER-ADMIN GUILDS (React · subdomínio admin.*)             │
│   Lista tenants · MRR consolidado · Custos · Suporte · Templates       │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼────────────────────────────────────┐
│             PAINEL TENANT (React · app.prospix.com.br)                  │
│   Início · Conversas · Pipeline · Agenda · Leads · Roteiros · Config   │
│   [scoped por tenant_id da sessão]                                     │
└──────────────────────────────────┬────────────────────────────────────┘
                                   │ REST + WebSocket
                                   │ (header X-Tenant-Id obrigatório)
┌──────────────────────────────────▼────────────────────────────────────┐
│  API (Node.js + Fastify)                                               │
│  middleware: auth → resolve tenant → inject app.tenant_id no contexto  │
└─┬─────────────┬───────────────┬───────────────┬───────────────┬───────┘
  │             │               │               │               │
┌─▼──┐  ┌──────▼──────┐  ┌────▼─────┐  ┌──────▼──────┐  ┌─────▼──────┐
│ DB │  │  Workers     │  │  IA      │  │ Integrações │  │ Per-tenant │
│ PG │  │  BullMQ      │  │  OpenAI  │  │ por tenant  │  │ secrets    │
│RLS │  │  (queue por  │  │  Anthropic│ │ Z-API/Cal/  │  │ (vault)    │
│ON  │  │  tenant)     │  │          │  │  Maps       │  │            │
└────┘  └──────┬───────┘  └──────────┘  └─────────────┘  └────────────┘
               │
       ┌───────┼────────┬──────────┬──────────┬────────────┐
       │       │        │          │          │            │
   Captura  Enriquec. Conversa  Agendamento  Health    Tenant onboarding
   (1h)     (15min)   (event)   (event)      (5min)    (admin-driven)
```

**Pontos-chave multi-tenant:**
- **RLS ativo em todas as tabelas de domínio** — sem `tenant_id` no contexto, query retorna zero
- **Workers carregam credenciais do tenant alvo no início do job** — nunca compartilham contexto
- **Secrets per-tenant** (Z-API token, Google refresh token, API key custom) em vault (Supabase Vault ou env por tenant_id)
- **Quotas e billing per-tenant** (tokens IA, mensagens WhatsApp, captures Google Maps)

### 3.3 Workers / jobs
| Worker | Frequência | Função |
|---|---|---|
| `capture-google-maps` | Cron 1h (horário comercial) | Busca novos leads das campanhas ativas |
| `enrich-leads` | Cron 15min | Valida WhatsApp + classifica fit score |
| `send-messages` | Event-driven (com throttle anti-ban) | Envia mensagens da IA respeitando cadência |
| `process-inbound` | Webhook Z-API | Processa mensagem recebida do lead → IA |
| `schedule-meeting` | Event-driven | Cria evento no Google Calendar |
| `daily-digest` | Cron 8h | Envia resumo do dia pro Giovane via WhatsApp |
| `health-check` | Cron 5min | Verifica saúde do número WhatsApp (anti-ban) |

### 3.4 Decisões técnicas críticas
| Decisão | Por quê |
|---|---|
| **GPT-4o-mini ao invés de GPT-4o** | 25× mais barato, qualidade suficiente pra seguir roteiro |
| **Z-API ao invés de Meta Cloud direta** | Z-API já gerencia anti-ban, aquecimento, instância dedicada · 1 instância por tenant |
| **Supabase ao invés de RDS** | Auth + DB + RLS + Realtime em 1 stack · RLS nativo do PostgreSQL é nosso isolamento principal |
| **Shared DB com RLS, não DB-per-tenant** | Operação simples, custo linear baixo, RLS é seguro e auditado |
| **BullMQ com filas namespaced por tenant** | `queue:tenant_{id}:capture` · isolamento de carga e logs |
| **PWA ao invés de app nativo** | Fase 1 não inclui mobile · PWA na Fase 2 evita app store · 1 PWA para todos tenants |
| **Subdomínio único `app.prospix.com.br`** | Auth resolve tenant pelo email/sessão · evita complexidade DNS de subdomain por tenant na Fase 1 |

---

## 4. Modelo de Dados

### 4.1 Diagrama de entidades (multi-tenant)
```
Tenant ──< User (Owner, Assistant) ──< Session
   │
   ├─< Campaign ──< Lead ──< Conversation ──< Message
   │                  │           │
   │                  │           └─< Meeting
   │                  │
   │                  └─< HealthProfile (Fase 2)
   │
   ├─< Script ──< ScriptVariation
   │
   ├─< TenantSecret (Z-API token, Google refresh, etc · vault)
   │
   ├─< TenantUsage (tokens IA · msgs WA · captures Maps · billing)
   │
   ├─< TenantBilling (plano · status · próxima cobrança)
   │
   └─< OptOut (escopo per-tenant — corretor diferente pode abordar)

LeadEvent (timeline · imutável · com tenant_id)

ScriptTemplate (master · Guilds-owned · clonável por tenants novos)
```

### 4.2 Schema PostgreSQL com RLS (entidades principais)

**Princípio:** toda tabela de domínio tem `tenant_id UUID NOT NULL` + policy RLS.

```sql
-- ============================================================
-- TENANT (raiz · gerenciado pelo super-admin Guilds)
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,           -- 'giovane-metlife'
  name TEXT NOT NULL,                  -- 'Giovane Carrara · MetLife · SJRP'
  status TEXT NOT NULL,                -- onboarding | active | suspended | churned
  plan TEXT NOT NULL,                  -- starter | standard | premium
  setup_paid_cents INT,
  mrr_cents INT NOT NULL,
  contract_signed_at TIMESTAMPTZ,
  go_live_at TIMESTAMPTZ,
  segment TEXT,                        -- 'insurance_metlife' | 'insurance_other' | etc
  -- Configs operacionais
  brand_logo_url TEXT,
  brand_primary_color TEXT,
  ai_voice_profile JSONB,              -- linguagem extraída no discovery (system prompt base)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tenants_status ON tenants(status);

-- ============================================================
-- USERS (corretor + assistants) · 1+ por tenant
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                  -- owner | assistant | guilds_admin
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  whatsapp TEXT NOT NULL,
  susep TEXT,
  partner_code TEXT,                   -- código MetLife / outra seguradora
  partner_brand TEXT,                  -- 'metlife' | 'bradesco' | 'prudential'
  city TEXT,
  bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);

-- ============================================================
-- SECRETS por tenant (vault · não exposto via API regular)
-- ============================================================
CREATE TABLE tenant_secrets (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  zapi_instance_id TEXT,
  zapi_token_encrypted TEXT,           -- AES-256
  google_calendar_id TEXT,
  google_oauth_refresh_encrypted TEXT,
  google_maps_api_key_encrypted TEXT,
  openai_api_key_encrypted TEXT,       -- opcional · senão usa chave Guilds
  ai_provider TEXT DEFAULT 'guilds_shared', -- 'guilds_shared' | 'tenant_own'
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CAMPANHAS (per tenant)
-- ============================================================
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,                -- active | paused | archived
  profession TEXT NOT NULL,
  cities TEXT[] NOT NULL,
  neighborhoods TEXT[],
  daily_limit INT DEFAULT 100,
  hour_window INT4RANGE,
  active_script_id UUID REFERENCES scripts(id),
  filters JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_campaigns_tenant_status ON campaigns(tenant_id, status);

-- ============================================================
-- LEADS (per tenant · UNIQUE constraint considera tenant)
-- ============================================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id),
  source TEXT NOT NULL,
  source_external_id TEXT,
  name TEXT,
  profession TEXT,
  whatsapp TEXT,
  whatsapp_valid BOOLEAN,
  email TEXT,
  address JSONB,
  age_estimate INT,
  fit_score NUMERIC(3,1),
  status TEXT NOT NULL,
  pipeline_stage TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  contacted_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  UNIQUE(tenant_id, whatsapp)          -- mesmo número pode existir em outro tenant
);

CREATE INDEX idx_leads_tenant_status ON leads(tenant_id, status);
CREATE INDEX idx_leads_tenant_pipeline ON leads(tenant_id, pipeline_stage);
CREATE INDEX idx_leads_tenant_fit ON leads(tenant_id, fit_score DESC);

-- ============================================================
-- CONVERSATIONS · MESSAGES · MEETINGS · LEAD_EVENTS
-- (todos têm tenant_id NOT NULL)
-- ============================================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  status TEXT NOT NULL,
  ai_handling BOOLEAN DEFAULT true,
  script_id UUID REFERENCES scripts(id),
  message_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  direction TEXT NOT NULL,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  whatsapp_message_id TEXT,
  llm_tokens_input INT,
  llm_tokens_output INT,
  llm_cost_cents INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  conversation_id UUID REFERENCES conversations(id),
  google_event_id TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  duration_minutes INT DEFAULT 30,
  location TEXT,
  attendees JSONB,
  status TEXT NOT NULL,
  outcome TEXT,
  policy_value_cents INT,
  commission_cents INT,
  notes TEXT,
  referrals_collected JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE lead_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lead_events_tenant_lead ON lead_events(tenant_id, lead_id, created_at DESC);

-- ============================================================
-- SCRIPTS (per tenant, mas clonáveis de templates master)
-- ============================================================
CREATE TABLE scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cloned_from_template_id UUID REFERENCES script_templates(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  target_profession TEXT,
  status TEXT NOT NULL,
  flow JSONB,
  base_message TEXT,
  variables TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE script_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  script_id UUID REFERENCES scripts(id),
  variant_letter TEXT NOT NULL,
  message TEXT NOT NULL,
  weight NUMERIC(3,2) DEFAULT 0.33,
  response_rate NUMERIC(5,4),
  conversion_rate NUMERIC(5,4)
);

-- ============================================================
-- TEMPLATES MASTER (Guilds-owned · sem tenant_id · não tem RLS)
-- Cada tenant novo clona desses
-- ============================================================
CREATE TABLE script_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  segment TEXT NOT NULL,               -- 'insurance_metlife' | 'insurance_bradesco' | 'real_estate' | ...
  category TEXT NOT NULL,
  target_profession TEXT,
  flow_template JSONB,
  base_message_template TEXT,
  created_by_user_id UUID,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- LGPD: opt-outs (per tenant · cada corretor mantém sua lista)
-- ============================================================
CREATE TABLE optouts (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  whatsapp TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, whatsapp)
);

-- ============================================================
-- USAGE & BILLING (per tenant)
-- ============================================================
CREATE TABLE tenant_usage (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,          -- '2026-05-01'
  llm_tokens_input BIGINT DEFAULT 0,
  llm_tokens_output BIGINT DEFAULT 0,
  llm_cost_cents INT DEFAULT 0,
  whatsapp_messages_sent INT DEFAULT 0,
  whatsapp_cost_cents INT DEFAULT 0,
  google_maps_calls INT DEFAULT 0,
  google_maps_cost_cents INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, period_month)
);

CREATE TABLE tenant_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  mrr_cents INT NOT NULL,
  excess_cents INT DEFAULT 0,          -- tokens excedentes da franquia
  total_cents INT NOT NULL,
  status TEXT NOT NULL,                -- pending | paid | overdue | refunded
  paid_at TIMESTAMPTZ,
  invoice_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.3 Row Level Security (RLS) · isolamento real

```sql
-- Ativa RLS em todas as tabelas de domínio
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE optouts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing  ENABLE ROW LEVEL SECURITY;

-- Policy padrão: só vê linhas do tenant atual
-- (current_setting é injetado pelo middleware da API)
CREATE POLICY tenant_isolation ON leads
  FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Idêntica em todas as outras tabelas (mesmo padrão)

-- Super-admin Guilds usa connection separada com role que bypassa RLS
CREATE ROLE guilds_admin BYPASSRLS;
```

### 4.4 Middleware da API (Node.js / Fastify)

```typescript
// middlewares/tenant-context.ts
fastify.addHook('preHandler', async (req, reply) => {
  const session = await verifyJWT(req.headers.authorization);
  if (!session) throw new Unauthorized();

  // Resolve tenant pelo email/sessão
  const user = await db.users.findUnique({ where: { id: session.userId } });
  if (!user) throw new Unauthorized();

  // Injeta no contexto da conexão PostgreSQL pra RLS funcionar
  await db.$executeRaw`SELECT set_config('app.tenant_id', ${user.tenantId}, true)`;

  req.tenantId = user.tenantId;
  req.userId = user.id;
  req.role = user.role;
});

// Workers: injetam tenant_id no início de cada job
worker.process(async (job) => {
  const { tenantId, ...payload } = job.data;
  await db.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  // ... agora todas queries são isoladas
});
```

### 4.3 Estados do lead (state machine)
```
captured → enriched → contacted → conversing
                                       ├→ qualified → meeting_scheduled → closed_won
                                       │                                ↘ closed_lost
                                       ├→ not_interested
                                       └→ opted_out
```

---

## 5. Integrações Externas

### 5.1 Google Maps Places API
- **Endpoints:** Text Search + Place Details
- **Custos:** ~$0,04/lead capturado (~R$ 0,20)
- **Free tier:** US$ 200/mês (~suficiente para 5.000 captures)
- **Limites:** rate limit padrão 100 QPS
- **Auth:** API Key restrita por IP

### 5.2 WhatsApp Business API (Z-API)
- **Plano:** Profissional R$ 280/mês (instância dedicada)
- **Limite:** 10.000 envios/mês
- **Webhooks:** mensagens recebidas, status delivery, presença online
- **Anti-ban:** aquecimento gradual obrigatório (20→200/dia em 30 dias)
- **Endpoints principais:**
  - `POST /send-text` — envia mensagem
  - `POST /check-phone` — valida se número tem WhatsApp
  - `GET /chat-status/:phone` — última atividade
  - Webhook receive: `POST /webhook/zapi`

### 5.3 Google Calendar API
- **Scopes:** `calendar.events`
- **Auth:** OAuth2 (Giovane autoriza no setup, refresh token armazenado)
- **Operações:**
  - `events.list` — verifica disponibilidade
  - `events.insert` — cria reunião
  - `events.update` — confirma/cancela
  - Watch + push notifications pra detectar mudanças manuais

### 5.4 OpenAI API (GPT-4o-mini)
- **Modelo:** `gpt-4o-mini-2024-07-18`
- **Custo:** $0.15/1M input + $0.60/1M output ≈ R$ 0,01 por conversa completa
- **Franquia:** 14M tokens/mês inclusos no MRR (~2.800 conversas)
- **Fallback:** Claude Haiku 3.5 (config-driven)
- **Estratégia de prompt:** sistema com `ai_voice_profile` + few-shot do `script.base_message`

### 5.5 BrasilAPI / ReceitaWS (CNPJ)
- **Endpoint:** `https://brasilapi.com.br/api/cnpj/v1/{cnpj}`
- **Rate limit:** 3 req/s
- **Sem custo**
- **Uso:** enriquecer leads de empresários (CNAE, sócios, idade do CNPJ)

---

## 6. FASE 1 — MVP APROVADO (R$ 7.900)

### 6.1 Discovery & Extração de Roteiros MetLife
**Duração:** 3h presencial/remoto · Semana 1

**Atividades:**
- Sessão estruturada com Giovane (gravada com consentimento)
- Roteiro de perguntas: abertura, desconstrução de objeções, apresentação de produtos (base vitalícia, IPCA+3%, proteção de renda, doença grave, DIH)
- Extração de cases reais que ele cita em reunião
- Mapeamento de objeções recorrentes ("já tenho seguro", "tá caro", "vou pensar")
- Coleta de materiais MetLife (PDFs, simuladores)

**Entregável:**
- `voice_profile.json` — usado como system prompt da IA
- `scripts_base/` — 3 roteiros draft (médico/advogado/empresário)
- `objections.json` — 10+ objeções com respostas mapeadas
- Spec funcional aprovada por Giovane antes da Sprint A

**Critério de aceite:**
- Giovane aprova os 3 roteiros draft (com até 2 rodadas de ajuste)
- Spec assinada

---

### 6.2 Sistema de Captura · Google Maps + Receita Federal
**Duração:** Semanas 2-3

**Funcionalidades:**
- `worker:capture-google-maps` roda a cada 1h em horário comercial
- Para cada campaign ativa:
  - Constrói query: `"{profissão} {cidade}"` + filtros de bairro
  - Pagina resultados (Text Search → Place Details)
  - Filtra: telefone público, perfil ativo, avaliações ≥ 4 (médicos), CNPJ ativo (empresários)
  - Insert em `leads` (status: `captured`)
  - Respeita `daily_limit` da campaign
- `worker:enrich-leads` roda a cada 15min:
  - Valida WhatsApp via Z-API `check-phone`
  - Cruza CNPJ com BrasilAPI (empresários)
  - Calcula `fit_score` com lógica:
    - Profissão alvo: +3
    - WhatsApp válido: +2
    - Dono ativo / sócio: +2
    - Bairro nobre / CNPJ > 5 anos: +1
    - Avaliações altas (médicos): +1
    - Já abordado antes: −∞ (skip)
  - Atualiza status pra `enriched`

**Critério de aceite:**
- Captura 100+ leads válidos no primeiro dia
- ≥ 90% dos leads enriquecidos têm WhatsApp válido confirmado
- Sem duplicatas (mesma `(user_id, whatsapp)`)
- Logs estruturados de cada captura (auditoria)

---

### 6.3 IA Conversacional WhatsApp · 3 Roteiros
**Duração:** Semanas 4-6

**Componentes:**
- **Engine de roteiros:** carrega `script.flow` e executa via state machine
- **Webhook Z-API:** recebe mensagem do lead → enfileira em `process-inbound`
- **Worker `process-inbound`:** 
  1. Carrega histórico da conversation
  2. Monta prompt: `voice_profile` (system) + `script.flow.current_node` + histórico
  3. Chama GPT-4o-mini com `temperature: 0.4` (consistência)
  4. Parse resposta: extrai intenção classificada + mensagem
  5. Aplica regras (anti-alucinação, sem promessa de valores, opt-out)
  6. Envia mensagem via Z-API `send-text`
  7. Registra em `messages` + atualiza `conversations`
- **Anti-ban:**
  - Aquecimento: limites diários crescentes (20→50→100→200) por 30 dias
  - Jitter entre mensagens: 40-90 segundos
  - Pausa noturna: 18h-9h sem envios
  - Detecta bloqueio (failed delivery) → pausa instância + alerta
- **Opt-out LGPD:**
  - Toda primeira mensagem inclui: "Se preferir não receber, responda SAIR"
  - Detecção de `SAIR`, `PARAR`, `NÃO QUERO` → insert em `optouts` + status `opted_out`

**Roteiros (Fase 1):**
1. `script_medicos_v1` — primeira abordagem médicos
2. `script_advogados_v1` — primeira abordagem advogados sócios
3. `script_empresarios_v1` — primeira abordagem empresários
- Cada um com 5 nodes principais: hook → resposta → objeção → educação (base vitalícia/IPCA+3%) → fechamento (oferecer reunião)
- Cada um com 3 variações A/B/C

**Critério de aceite:**
- Em testes com 50 contatos reais, IA responde corretamente em ≥ 95% dos casos
- Zero alucinação de valores (a IA NUNCA cita prêmio específico)
- Opt-out funciona em ≤ 1 minuto após detecção
- Aquecimento respeitado nas primeiras 4 semanas

---

### 6.4 Integração Google Calendar + Agendamento Automático
**Duração:** Semana 6

**Fluxo:**
1. IA detecta intenção `accept_meeting` na conversation
2. Chama `availability.list` no Google Calendar de Giovane (próximos 7 dias úteis)
3. Constrói 2 opções de horário (respeitando buffers de 15min e janela 9h-18h)
4. Pergunta ao lead: "Quarta às 17h ou quinta às 14h?"
5. Lead escolhe → IA confirma → cria evento via `events.insert`:
   - Título: `[MetLife] Reunião · {lead.name}`
   - Descrição: histórico resumido + link pro perfil no painel
   - Convidado: email do lead (se houver)
   - Localização: definida pelo lead (escritório dele ou do Giovane)
6. Insert em `meetings` com `google_event_id`
7. Lembrete D-1 e 1h-antes via webhook + IA WhatsApp pro lead

**Critério de aceite:**
- 100% das reuniões aceitas pelo lead criam evento no Calendar
- Buffers de 15min respeitados
- Detecta conflitos e oferece horários alternativos

---

### 6.5 Painel Tenant (Web) · Funil + Pipeline Kanban
**Duração:** Semanas 5-7 (paralelo)

**Páginas (alinhadas com protótipo aprovado):**
- **Início:** 4 cards do dia (reuniões hoje, conversas prontas, pediu ligação, novos leads) + pipeline overview + lista quick de leads quentes + funil chart
- **Conversas:** lista de todas conversações ativas com filtros (Todas/Quentes/Aguardando/Agendadas) + drawer ao clicar
- **Pipeline (Kanban):** 6 colunas drag-and-drop (Capturado → 1ª msg → Em conversa → Aguardando você → Agendada → Fechado)
- **Agenda:** semana atual com reuniões + click abre detalhes
- **Meus Leads:** todos com filtros por especialidade

**Drawer do lead (4 abas):**
- Conversa (WhatsApp chat completo)
- Ficha (dados + anotações editáveis)
- Saúde (placeholder pra Fase 2)
- Histórico (timeline `lead_events`)

**Ações no drawer:**
- Ligar (telefonia · Fase 2)
- Assumir conversa (pausa IA, libera input pro tenant owner)
- Marcar resultado (modal pós-reunião)

**Auth:**
- Login via magic link no WhatsApp do owner
- Sessão JWT 30 dias com `tenant_id` embutido
- 1 owner inicial · suporte a assistants na Fase 2
- Toda request passa pelo middleware de tenant scoping (RLS)

**Critério de aceite:**
- Tudo navegável (zero placeholder)
- Drag-and-drop funcional no Kanban
- Real-time: nova mensagem aparece sem refresh
- Mobile-responsive (≥ 768px usável; otimizado mobile na Fase 2)
- **Verificação manual de isolamento:** logar como Giovane e validar que nenhuma query retorna dado de tenant fictício de teste

---

### 6.5b Super-Admin Guilds (Web) · novo na Fase 1
**Duração:** Semana 6-7 (paralelo)

**Subdomínio separado:** `admin.prospix.com.br` · acesso restrito ao time Guilds (role `guilds_admin`)

**Páginas mínimas pra Fase 1 (versão leve):**
- **Tenants:** lista com status, plan, MRR, último login, health (verde/amarelo/vermelho baseado em uptime IA e quality rating WhatsApp)
- **Onboarding wizard:** criar tenant novo · cadastrar owner · configurar secrets (Z-API, Google) · ativar
- **Templates de roteiros:** master library editável · cada novo tenant clona daqui
- **Uso & custos:** dashboard com tokens consumidos por tenant + custo Guilds vs MRR cobrado (margem)
- **Suporte:** lista de tickets (pode ser MVP só com integração Zendesk/email)

**Decisão:** Painel Super-Admin é **leve na Fase 1** (foco no Tenant #1) mas a infraestrutura multi-tenant (RLS, tenant resolution, secrets vault) é completa desde Day 1. Expansão do Super-Admin entra na Fase 2 conforme novos tenants chegam.

**Critério de aceite:**
- Criar Tenant #2 via wizard leva ≤ 10 minutos (sem código)
- Lista de tenants com health real-time
- Métricas de custo per tenant batem com o billing do mês

---

### 6.6 Treinamento, Entrega e Go-live
**Duração:** Semana 7

- Treinamento ao vivo 2h com Giovane (gravado)
- Manual em PDF + 4 vídeos curtos (1-3min cada)
- Documentação técnica em `/docs` (interno)
- Go-live com primeira campanha ativada
- Hypercare 30 dias: PM acompanha diariamente, ajustes calibrados

**Critério de aceite Fase 1:**
- Sistema em produção
- Giovane consegue operar sozinho (validado na semana 8)
- Primeira reunião agendada pela IA até D+45

---

## 7. FASE 2+ · ADICIONAIS (faseamento por demanda)

> Liberados conforme cliente extrai valor da Fase 1 e contrata expansões. Cada item tem spec leve aqui — quando ativado, ganha PRD próprio.

### 7.1 App mobile PWA (R$ 2.400)
- Service Worker + manifest pra instalar sem app store
- 10 telas otimizadas mobile (já desenhadas no protótipo aprovado)
- Push notifications via FCM (Firebase Cloud Messaging) — para Web Push padrão
- Sincronização offline-first com IndexedDB

### 7.2 Editor visual de roteiros · Flow Builder (R$ 2.200)
- DnD entre blocos (gatilho/espera/mensagem/decisão/ação/fim)
- Edição inline de mensagens com preview WhatsApp
- Versionamento de roteiros (publicar nova versão sem perder histórico)
- Stack: React Flow ou similar

### 7.3 Loop de Indicações pós-reunião (R$ 1.490)
- Worker `referral-followup`: 24h após `meetings.status = happened`
- Envia mensagem agradecendo + pedindo 2-3 indicações
- Parse das respostas (nome + WhatsApp) → cria leads novos com `source = referral`
- Roteiro especial pra abordar indicado: "Fulano me passou seu contato..."

### 7.4 Ficha de pré-qualificação de saúde MetLife (R$ 1.100)
- IA coleta durante a conversa: tabagismo, peso, altura, doenças, histórico familiar
- Calcula IMC + sugere categoria de risco MetLife
- Sugere faixa de prêmio estimada (baseado em tabelas pré-cadastradas)
- Nova aba "Saúde" no drawer ganha conteúdo

### 7.5 Performance + A/B testing avançado (R$ 1.400)
- Dashboard de comparação entre variações de roteiro
- Distribuição automática (algoritmo: epsilon-greedy 80/20)
- Insights gerados por LLM: "Variação B converte 4pp mais em médicos do que A"

### 7.6 Telefonia integrada · botão Ligar (R$ 1.890)
- Integração Twilio Voice ou Zenvia
- Botão "Ligar" no drawer disca pelo browser (WebRTC)
- Gravação opcional armazenada em R2 (LGPD: consentimento explícito)
- Histórico de ligações no `lead_events`

### 7.7 Dashboard executivo para MetLife (R$ 1.890)
- Relatório mensal em PDF exportável
- KPIs formatados pra apresentação à diretoria MetLife
- Comparativo vs mês anterior + ano-a-ano

### 7.8 Landing page do corretor MetLife (R$ 2.900)
- Página separada (Next.js · `app.giovanemetlife.com.br`)
- Captura formulário → lead cai direto na fila do sistema com `source = landing_page`
- SEO local: "corretor MetLife São José do Rio Preto"

### 7.9 Migração de leads históricos (R$ 1.490)
- Importação de CSV/Excel (até 2.000 contatos)
- Enriquecimento via Google Maps + Receita
- Dedup contra base atual
- Reaproveitamento de classificação histórica (cliente atual / lead frio / não responde)

### 7.10 Integração com Conselhos Profissionais (R$ 1.200 · best effort)
- Scraper headless (Playwright) com rotação de proxies
- CRM-SP, OAB-SP, CRO-SP
- Cruzamento com leads existentes pra enriquecer (especialidade exata, tempo de profissão)
- Monitoramento: se bloqueado, alerta + degradação graceful

### 7.11 Monitoramento Proativo (R$ 690/mês × 3 meses)
- Time Guilds acompanha métricas diariamente
- Ajustes de calibração da IA
- Análise de risco de banimento WhatsApp
- Reuniões quinzenais com Giovane

---

### 7.12 Onboarding Self-Service para novos tenants (interno · não revendido)
- Fluxo guiado: tenant novo se cadastra, conecta WhatsApp/Calendar, escolhe template de roteiro, paga setup
- Reduz custo de aquisição do 2º cliente em diante
- Liberado conforme Guilds estrutura processo comercial de revenda

### 7.13 Billing automatizado · Stripe ou Asaas
- Cobrança recorrente automática
- Faturas em PDF
- Régua de inadimplência (D+3, D+7, D+15 suspend)
- Cobrança de excedentes (tokens IA acima da franquia)

### 7.14 White-label completo (Fase 3 · upsell)
- Subdomínio próprio do tenant (`app.giovanemetlife.com.br`)
- Logo e cores do tenant (ou da seguradora dele)
- Sem marca Guilds visível
- Tenant fala "meu sistema" pros clientes dele
- Preço: + R$ 4.900 setup + R$ 290/mês

### 7.15 Multi-user dentro do tenant (assistants)
- Owner pode convidar 1-N assistants
- Roles: assistant pode ver leads e responder, mas não pode editar campanhas/roteiros/billing
- Audit log de quem fez o quê

### 7.16 Marketplace de templates entre tenants
- Owners podem publicar roteiros que funcionaram bem
- Outros tenants compram/clonam
- Receita compartilhada (50/50 com Guilds)
- Habilitado quando ≥ 20 tenants ativos

---

## 8. Roteiros da IA · Especificação Funcional

### 8.1 Estrutura de um roteiro
```json
{
  "id": "script_medicos_v1",
  "name": "Médicos · primeira abordagem",
  "target_profession": "doctor",
  "status": "active",
  "flow": {
    "nodes": [
      {
        "id": "trigger",
        "type": "trigger",
        "conditions": { "profession": "doctor", "fit_score_min": 7 }
      },
      {
        "id": "wait_optimal",
        "type": "wait",
        "duration": "until_window",
        "window": "09:00-12:00,14:00-17:00"
      },
      {
        "id": "msg_1",
        "type": "message",
        "variations": ["A", "B", "C"],
        "next": "wait_response"
      },
      {
        "id": "wait_response",
        "type": "wait",
        "max_duration": "3d",
        "on_timeout": "followup_1"
      },
      {
        "id": "classify",
        "type": "decision",
        "llm_classifier": "intent",
        "branches": {
          "interested": "msg_value_prop",
          "has_insurance": "msg_metlife_diff",
          "price_objection": "msg_price",
          "not_interested": "end_archive"
        }
      },
      ...
    ]
  }
}
```

### 8.2 System prompt (template)
```
Você é assistente de Giovane Carrara, corretor MetLife em SJRP há 6 anos.
Linguagem dele (NUNCA fuja disso):
{voice_profile}

REGRAS ABSOLUTAS:
1. NUNCA cite valor de prêmio específico (depende de cotação SUSEP).
2. NUNCA prometa cobertura específica (avaliação MetLife).
3. NUNCA fale como "vou te aprovar" — é a MetLife que aprova.
4. Sempre que detectar pedido de ligação direta → encaminhe pro Giovane.
5. Sempre que detectar SAIR / PARAR / NÃO QUERO → confirme opt-out e encerre.
6. Mantenha tom consultivo, nunca pressão.

OBJETIVOS (ordem):
1. Entender se o lead tem fit (sócio/profissional liberal).
2. Educar sobre proteção de renda (DIH, doença grave).
3. Marcar reunião de 30min — você consulta agenda real.
```

### 8.3 Variáveis dinâmicas em mensagens
- `{{NOME}}` → primeiro nome do lead
- `{{PROFISSAO}}` → "Dr." (médico/dentista), "Dr." (advogado), "" (empresário)
- `{{CIDADE}}` → "SJRP"
- `{{GIOVANE_HORARIO_1}}`, `{{GIOVANE_HORARIO_2}}` → 2 próximos horários livres

---

## 9. Cronograma · 35 dias úteis

| Semana | Fase | Entregáveis |
|---|---|---|
| **S1** (D1-D5) | **FOUNDRY** Kickoff | Discovery + voice_profile + spec aprovada |
| **S2** (D6-D10) | **OBSERVE** Mapeamento | Acessos Z-API + Google Calendar + spec final |
| **S3** (D11-D15) | **REFINE** Arquitetura | Modelo de dados aprovado + skeleton API |
| **S4** (D16-D20) | **GENERATE A** | Captura + Enriquecimento em homologação |
| **S5** (D21-D25) | **GENERATE B** | IA + WhatsApp + Calendar em homologação |
| **S6** (D26-D30) | **GENERATE C** | Painel web completo + Pipeline Kanban |
| **S7** (D31-D35) | **EMPOWER** | Treinamento + go-live + hypercare iniciado |
| D+35 a D+65 | Hypercare 30d | Ajustes diários + calibração IA |

**Milestones do cliente (aprovações obrigatórias):**
- D+5: spec funcional aprovada
- D+15: arquitetura aprovada (Giovane vê protótipo evoluído)
- D+25: 3 roteiros aprovados (Giovane revisa e aprova cada um)
- D+35: go-live confirmado

---

## 10. Critérios de Aceite Globais

### 10.1 Performance
- Tempo de carga inicial do painel: < 2s
- Resposta da IA a mensagem do lead: < 8s p95
- Captura de leads sem perdas: ≥ 99% de sucesso por job
- Uptime: 99,5% nos primeiros 90 dias

### 10.2 Qualidade
- IA com 0 alucinação de valores em testes de aceite (50 conversas)
- Opt-out efetivo em ≤ 60s
- Pipeline Kanban com drag-and-drop sem perda de dados

### 10.3 UX
- Giovane consegue operar sem treinamento adicional após semana 8
- NPS pós go-live ≥ 8/10

---

## 11. LGPD & Compliance

### 11.1 Base legal
- **Legítimo interesse** (art. 7, IX, Lei 13.709/2018) para abordagem comercial inicial
- Documentado em DPIA simplificado
- Opt-out automatizado e funcional em toda mensagem

### 11.2 Dados sensíveis
- **Saúde (Fase 2)** só coletado com consentimento explícito do lead
- Armazenamento criptografado em repouso (AES-256)
- Acesso restrito por role (apenas Giovane e admin Guilds)

### 11.3 Retenção
- Leads sem resposta após 6 meses: arquivamento
- Conversas: 5 anos (compliance fiscal)
- Opt-outs: permanente

### 11.4 SUSEP
- IA não pode fazer cotação de prêmio
- IA não pode prometer aceitação
- IA não pode fechar venda
- Todo material com aviso: "Giovane Carrara · SUSEP {susep_code}"

### 11.5 WhatsApp Meta · políticas comerciais
- Mensagens iniciais classificadas como "Marketing"
- Aquecimento obrigatório
- Frequência respeitando boas práticas
- Monitor de Quality Rating do número (alerta se cair de Green)

---

## 12. Riscos & Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| **Vazamento de dados entre tenants (RLS falha)** | **Baixa** | **CRÍTICO** | **RLS auditado · testes E2E que validam isolamento · code review obrigatório em qualquer query custom · pgaudit ativo** |
| Número WhatsApp banido | Média | Alto | Aquecimento gradual + monitor Quality Rating + número backup |
| Google Places aumenta preço ou bloqueia | Baixa | Médio | Cache de captures + fallback BrasilAPI |
| LLM alucinação financeira | Baixa | Crítico | Regras hard-coded + temperatura baixa + classifier de validação pre-send |
| Cliente desiste no meio | Baixa | Alto | Contrato com cláusula de pagamento por marcos |
| Conselhos profissionais bloqueiam scraper | Alta | Baixo | Movido pra Fase 2 best-effort · não bloqueia MVP |
| Volume de mensagens > 10k/mês (Z-API) | Média (mês 4+) | Médio | Upgrade Z-API plano R$ 480/mês · 1 instância por tenant |
| LGPD: lead reclama na ANPD | Baixa | Alto | Opt-out funcional · base legal documentada · escopo per-tenant (corretor A não vê opt-out do corretor B, e vice-versa) |
| **Tenant abusa do sistema (spam · violação ToS)** | **Média** | **Alto** | **Quotas hard · suspensão automática se Quality Rating WhatsApp cair · contrato com cláusula de uso aceitável** |
| **Custos de IA estouram a franquia silenciosamente** | **Média** | **Médio** | **Alertas em 70% / 90% / 100% da franquia · cobrança de excedente automática (Fase 2) · opção de plug própria chave** |

---

## 13. Métricas de Sucesso

### 13.1 KPIs do produto (acompanhados semanalmente)
- Leads capturados/dia (target: crescente conforme aquecimento)
- Taxa de resposta (target: ≥ 25% em regime pleno)
- Taxa de qualificação (target: ≥ 20% das respostas)
- Taxa de conversão pra reunião (target: ≥ 35% das qualificadas)
- Uptime do sistema (target: 99,5%)
- Custo médio por reunião agendada (target: ≤ R$ 60)

### 13.2 KPIs do negócio (acompanhados mensalmente)
- Apólices fechadas pelo Giovane (target: 10/mês em regime pleno)
- Comissão MetLife gerada (target: R$ 50k+/mês)
- ROI do sistema (target: ≥ 25× custo total)
- NPS Giovane (target: ≥ 9/10 após 90 dias)

### 13.3 KPIs operacionais (acompanhados pelo PM Guilds)
- Tickets de suporte abertos/mês
- Tempo médio de resolução
- Uso de horas de evolução (vs 2h inclusas no MRR)
- Quality Rating do número WhatsApp

---

## 14. Acessos e Credenciais

### 14.1 Plataforma (Guilds · única, compartilhada entre tenants)
| Serviço | Quem contrata | Status | Notas |
|---|---|---|---|
| Supabase (DB + Auth + Vault) | Guilds | Ativo | Projeto único · RLS isola tenants |
| Railway (API + workers) | Guilds | Ativo | Cluster único · workers respeitam tenant_id |
| Cloudflare R2 (storage) | Guilds | Ativo | Bucket único · paths prefixados com tenant_id |
| Sentry (errors) | Guilds | Ativo | Tags `tenant_id` em todo evento |
| BetterStack (uptime) | Guilds | Ativo | Monitora endpoints públicos |
| OpenAI API (chave Guilds compartilhada) | Guilds | Ativo | Franquia 14M tokens × N tenants · usage atribuído por `tenant_id` |

### 14.2 Per-Tenant (configurado no onboarding de cada tenant)
| Serviço | Quem contrata | Notas |
|---|---|---|
| Z-API instância dedicada | Tenant (R$ 280/mês) | 1 instância · 1 número WhatsApp · armazenado em `tenant_secrets` |
| Google Cloud (Maps + Calendar) | Tenant (custo direto) | Conta Google do owner · OAuth refresh em vault |
| OpenAI API key própria (opcional) | Tenant | Plugável em `tenant_secrets.openai_api_key_encrypted` · ativa quando custo justifica |
| Domínio próprio (opcional · Fase 3 white-label) | Tenant | DNS apontando pro Railway · cert SSL automático |

### 14.3 Tenant #1 · Giovane Carrara (status kickoff)
- [ ] Z-API instância (a cadastrar)
- [ ] Google Cloud project (a criar)
- [ ] Owner cadastrado no sistema (via Super-Admin Guilds)
- [ ] OAuth Google autorizado (Giovane clica no link)
- [ ] WhatsApp Business número conectado e em aquecimento

---

## 15. Repositório e Estrutura de Código (monorepo multi-tenant)

```
prospix/                          # nome do produto (não "metlife-giovane")
├── apps/
│   ├── api/                              # Node.js + Fastify (multi-tenant)
│   │   ├── src/
│   │   │   ├── middlewares/
│   │   │   │   ├── auth.ts
│   │   │   │   └── tenant-context.ts     # injeta tenant_id no contexto PG
│   │   │   ├── routes/
│   │   │   │   ├── tenant/               # endpoints scoped por tenant
│   │   │   │   │   ├── leads.ts
│   │   │   │   │   ├── conversations.ts
│   │   │   │   │   ├── campaigns.ts
│   │   │   │   │   └── scripts.ts
│   │   │   │   └── admin/                # endpoints super-admin Guilds
│   │   │   │       ├── tenants.ts
│   │   │   │       ├── usage.ts
│   │   │   │       └── templates.ts
│   │   │   ├── workers/
│   │   │   │   ├── capture-google-maps.ts
│   │   │   │   ├── enrich-leads.ts
│   │   │   │   ├── send-messages.ts
│   │   │   │   ├── process-inbound.ts
│   │   │   │   └── _base-worker.ts       # base class que sempre injeta tenant_id
│   │   │   ├── integrations/
│   │   │   │   ├── google-maps.ts        # recebe tenant_secrets
│   │   │   │   ├── zapi.ts               # idem
│   │   │   │   ├── google-calendar.ts
│   │   │   │   ├── openai.ts             # usa chave do tenant se houver, senão Guilds
│   │   │   │   └── brasilapi.ts
│   │   │   ├── ai/
│   │   │   │   ├── script-engine.ts
│   │   │   │   ├── prompt-builder.ts     # mescla voice_profile do tenant
│   │   │   │   ├── classifier.ts
│   │   │   │   └── guardrails.ts
│   │   │   ├── tenant/                   # serviços específicos de multi-tenancy
│   │   │   │   ├── tenant-service.ts
│   │   │   │   ├── secrets-vault.ts
│   │   │   │   ├── usage-tracker.ts
│   │   │   │   └── billing-service.ts
│   │   │   └── domain/
│   │   └── prisma/
│   │       └── schema.prisma             # com tenant_id em todos models
│   ├── web/                              # React + Vite (painel tenant)
│   │   └── src/
│   │       ├── pages/
│   │       ├── components/
│   │       └── lib/
│   │           └── api-client.ts         # sempre envia header X-Tenant-Id
│   └── admin/                            # React + Vite (super-admin Guilds · subdomínio admin.*)
│       └── src/
│           ├── pages/
│           │   ├── tenants-list.tsx
│           │   ├── tenant-onboard.tsx
│           │   ├── templates-library.tsx
│           │   └── usage-dashboard.tsx
│           └── lib/
├── packages/
│   ├── shared-types/                     # tipos compartilhados (TS)
│   ├── ui/                               # design system compartilhado
│   └── tenant-sdk/                       # SDK reutilizável de helpers multi-tenant
├── infra/
│   ├── railway.toml
│   └── github-actions/
└── docs/
    ├── runbook.md
    ├── ia-prompts.md
    ├── multi-tenancy.md                  # decisões e padrões obrigatórios
    ├── onboarding-novo-tenant.md         # playbook operacional
    └── api.md
```

### 15.1 Regras de ouro no código (enforced via lint + code review)
1. **Nenhuma query SQL sem `tenant_id` no WHERE** — mesmo com RLS ativo, é cinturão e suspensório
2. **Workers nunca processam jobs sem `tenant_id` no payload** — base class lança exception
3. **Logs sempre incluem `tenant_id` no contexto** — pra debugar e auditar
4. **Testes E2E rodam com 2 tenants fictícios** — valida isolamento em CI

---

## 16. Próximos Passos · Pós-aprovação

- [ ] Contrato assinado (DocuSign)
- [ ] Entrada paga (R$ 3.950)
- [ ] Kickoff agendado (até D+5)
- [ ] Reunião FOUNDRY · 3h com Giovane (gravada)
- [ ] Setup repositório + Railway + Supabase
- [ ] Cadastro Z-API + Google Cloud no nome do Giovane
- [ ] Spec funcional aprovada até D+5
- [ ] Início do desenvolvimento (Sprint A)

---

**Documento mantido por:** Gustavo Macedo · Guilds
**Última atualização:** 18/05/2026
**Revisão programada:** D+15 (após arquitetura aprovada) e D+30 (pré go-live)

---
---

# ANEXOS TÉCNICOS

> Os anexos abaixo embasam todo o desenvolvimento. Foram escritos com nível de detalhe para que devs consigam implementar **sem reuniões adicionais de spec**. Cada anexo é referenciado em pontos específicos do PRD principal.

| Anexo | Tema | Para quem |
|---|---|---|
| A | API Contracts (REST) | Backend + Frontend |
| B | Webhooks (Z-API, Google, Stripe) | Backend |
| C | State Machines (Lead, Conversation, Meeting, Campaign) | Backend + Produto |
| D | Algoritmos (Fit Score, Aquecimento, Classificador, Follow-up) | Backend + Eng. IA |
| E | IA & Prompts (system prompt, guardrails, versionamento) | Eng. IA |
| F | Workers & Concorrência (specs, idempotência, locks) | Backend |
| G | Auth, Onboarding & Multi-tenancy operacional | Backend + Frontend + PM |
| H | DevOps & Operação (env, local dev, CI/CD, DR) | DevOps + todos |
| I | Observabilidade & Testes | Todos |
| J | Segurança & Compliance LGPD | Todos + Jurídico |
| K | UX & Edge Cases | Frontend + Produto |
| L | Playbooks Operacionais | Suporte + Plantão |
| M | Roadmap Detalhado Fase 2+ | Produto + Comercial |

---

# ANEXO A · API Contracts (REST)

## A.1 Convenções gerais

**Base URL:**
- Tenant API: `https://api.prospix.com.br/v1/tenant/*`
- Admin API: `https://api.prospix.com.br/v1/admin/*`
- Webhooks: `https://api.prospix.com.br/v1/webhooks/*`

**Headers obrigatórios:**
```
Authorization: Bearer <jwt>
X-Tenant-Id: <uuid>           # validado contra JWT, retorna 403 se inconsistente
Content-Type: application/json
X-Request-Id: <uuid>          # para tracing distribuído (gerado pelo client ou API)
```

**Formato de resposta padrão (sucesso):**
```json
{
  "data": {...},
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-05-18T14:30:00Z"
  }
}
```

**Formato de resposta de erro:**
```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Lead 123 não encontrado neste tenant",
    "details": {...},
    "trace_id": "uuid"
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-05-18T14:30:00Z"
  }
}
```

**Códigos de erro padronizados:**

| Código | HTTP | Significado |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Sem token ou token inválido |
| `UNAUTHORIZED` | 403 | Token válido mas sem permissão (role insuficiente ou tenant mismatch) |
| `RESOURCE_NOT_FOUND` | 404 | Recurso não existe ou não pertence ao tenant |
| `VALIDATION_ERROR` | 422 | Payload inválido (com details) |
| `RATE_LIMITED` | 429 | Throttle do tenant (header `Retry-After`) |
| `TENANT_QUOTA_EXCEEDED` | 429 | Excedeu franquia (tokens IA, mensagens WhatsApp) |
| `EXTERNAL_SERVICE_DOWN` | 502 | Z-API/Google/OpenAI fora |
| `INTERNAL_ERROR` | 500 | Erro não previsto (gera Sentry) |

**Paginação (cursor-based):**
```
GET /v1/tenant/leads?limit=50&cursor=eyJpZCI6...

Response:
{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJpZCI6...",
    "has_more": true,
    "total_estimate": 1847
  }
}
```

**Filtros (query string):**
```
GET /v1/tenant/leads?status=conversing&fit_score_gte=8&created_after=2026-05-01
```

**Ordenação:**
```
GET /v1/tenant/leads?sort=-fit_score,created_at    # - = desc
```

## A.2 Tenant API · endpoints completos

### A.2.1 Auth

```
POST /v1/auth/magic-link
Body: { "whatsapp": "+5517998764422" } OU { "email": "..." }
Response 200: { "data": { "sent_to": "whatsapp", "expires_in": 600 } }
[Envia link via WhatsApp ou email com token de 1 uso]

GET /v1/auth/callback?token=<single-use-token>
Response 200: { "data": { "access_token": "jwt...", "refresh_token": "...", "user": {...}, "tenant": {...} } }

POST /v1/auth/refresh
Body: { "refresh_token": "..." }
Response 200: { "data": { "access_token": "jwt..." } }

POST /v1/auth/logout
Response 204
```

### A.2.2 Leads

```
GET /v1/tenant/leads
Query: status, fit_score_gte, fit_score_lte, profession, campaign_id, created_after, search, sort, cursor, limit
Response: paginated list

GET /v1/tenant/leads/:id
Response: lead + last 20 messages + last meeting + events timeline

POST /v1/tenant/leads
Body: { "name": "...", "whatsapp": "...", "profession": "...", "source": "manual", "metadata": {...} }
Response 201: created lead

PATCH /v1/tenant/leads/:id
Body: { "name?": "...", "notes?": "...", "pipeline_stage?": "..." }
Response 200: updated lead

POST /v1/tenant/leads/:id/optout
Body: { "reason?": "..." }
Response 204
[Cria registro em optouts e atualiza lead.status = opted_out]

POST /v1/tenant/leads/:id/assume
Response 200: { "data": { "conversation_id": "..." } }
[Pausa IA na conversa, marca ai_handling=false, libera input pro user]

POST /v1/tenant/leads/:id/release
Response 200: { "data": { "conversation_id": "..." } }
[Retorna controle pra IA]

POST /v1/tenant/leads/:id/notes
Body: { "content": "..." }
Response 201: created note

DELETE /v1/tenant/leads/:id
Response 204 [soft-delete · move pra deleted_leads · LGPD]
```

### A.2.3 Conversations & Messages

```
GET /v1/tenant/conversations
Query: status (active|paused|escalated), filter (hot|waiting|scheduled), sort
Response: paginated

GET /v1/tenant/conversations/:id/messages
Response: messages ordenadas por created_at ASC

POST /v1/tenant/conversations/:id/messages
Body: { "content": "...", "send_via": "whatsapp" }
Response 201: message
[Só permitido se conversation.ai_handling=false (user assumiu)]

PATCH /v1/tenant/conversations/:id
Body: { "ai_handling": false }
Response 200
```

### A.2.4 Meetings

```
GET /v1/tenant/meetings
Query: status, scheduled_after, scheduled_before
Response: list

GET /v1/tenant/meetings/:id
Response: meeting + lead + conversation summary

PATCH /v1/tenant/meetings/:id
Body: { "status?": "happened|no_show|rescheduled", "outcome?": "closed|second_meeting|not_interested", "policy_value_cents?": 487000, "commission_cents?": 584400, "notes?": "...", "referrals_collected?": [{"name":"...","whatsapp":"..."}] }
Response 200

POST /v1/tenant/meetings/:id/reschedule
Body: { "new_datetime": "2026-05-22T17:00:00-03:00" }
Response 200
```

### A.2.5 Campaigns

```
GET /v1/tenant/campaigns
POST /v1/tenant/campaigns
Body: { "name": "...", "profession": "doctor", "cities": ["São José do Rio Preto"], "neighborhoods?": [...], "daily_limit": 100, "hour_window": [9,18], "active_script_id": "uuid", "filters": {...} }
GET /v1/tenant/campaigns/:id
PATCH /v1/tenant/campaigns/:id
POST /v1/tenant/campaigns/:id/pause
POST /v1/tenant/campaigns/:id/resume
DELETE /v1/tenant/campaigns/:id
```

### A.2.6 Scripts

```
GET /v1/tenant/scripts
GET /v1/tenant/scripts/templates    # lista master library Guilds
POST /v1/tenant/scripts/clone
Body: { "template_id": "uuid", "customizations": {...} }
GET /v1/tenant/scripts/:id
PATCH /v1/tenant/scripts/:id
Body: { "flow?": {...}, "status?": "active|archived" }
POST /v1/tenant/scripts/:id/variations
Body: { "variant_letter": "D", "message": "..." }
POST /v1/tenant/scripts/:id/test
Body: { "test_lead": {...} }
Response: { "preview": "mensagem que seria enviada", "tokens_estimate": 320 }
```

### A.2.7 Dashboard & Métricas

```
GET /v1/tenant/dashboard/today
Response: { "meetings_today": 3, "conversations_ready": 12, "need_callback": 1, "new_leads_today": 248, "next_meeting": {...} }

GET /v1/tenant/dashboard/funnel?period=30d
Response: { "captured": 1847, "whatsapp_valid": 1773, "sent": 1243, "responded": 348, "qualified": 89, "scheduled": 23 }

GET /v1/tenant/dashboard/performance?period=30d
Response: { "revenue_projected": 13200000, "closed_won": 7, "conversion_rate": 0.31, "cost_per_meeting": 2800, "scripts": [...] }

GET /v1/tenant/dashboard/ai-usage?period=current_month
Response: { "tokens_used": 14200000, "tokens_quota": 14000000, "cost_cents": 38742, "cost_quota_cents": 120000, "breakdown": {...} }
```

### A.2.8 Configurações

```
GET /v1/tenant/me
Response: { "tenant": {...}, "user": {...}, "secrets_status": { "zapi": "connected", "calendar": "connected", "telephony": "pending" } }

PATCH /v1/tenant/me
Body: { "user?": {...}, "tenant?": {"brand_primary_color?": "..."} }

POST /v1/tenant/integrations/zapi/connect
Body: { "instance_id": "...", "token": "..." }
Response: { "data": { "connected": true, "whatsapp_number": "+5517..." } }

POST /v1/tenant/integrations/google/oauth
Response: { "data": { "auth_url": "https://accounts.google.com/o/oauth2/..." } }

GET /v1/tenant/integrations/google/callback?code=...
Response: { "data": { "calendar_id": "...", "connected": true } }

POST /v1/tenant/integrations/openai/connect
Body: { "api_key": "sk-proj-..." }
Response: { "data": { "validated": true, "test_call_ms": 480 } }

POST /v1/tenant/integrations/openai/disconnect
Response: 204 [volta a usar chave compartilhada Guilds]
```

### A.2.9 Notificações

```
GET /v1/tenant/notifications?unread=true
POST /v1/tenant/notifications/:id/mark-read
POST /v1/tenant/notifications/mark-all-read

GET /v1/tenant/notifications/preferences
PATCH /v1/tenant/notifications/preferences
Body: { "lead_pediu_ligacao": {"push": true, "whatsapp": true, "email": true}, ... }
```

### A.2.10 LGPD (operações de privacidade)

```
POST /v1/tenant/lgpd/export-data
Response 202: { "data": { "job_id": "...", "estimated_minutes": 5 } }

GET /v1/tenant/lgpd/export-data/:job_id
Response: { "data": { "status": "completed|processing", "download_url?": "..." } }

POST /v1/tenant/lgpd/delete-lead-data
Body: { "lead_whatsapp": "+55..." }
Response 202: { "data": { "deleted": true, "trace_id": "..." } }
```

## A.3 Admin API · endpoints (super-admin Guilds)

```
# Tenants
GET    /v1/admin/tenants
POST   /v1/admin/tenants
Body: { "slug": "giovane-metlife", "name": "...", "plan": "standard", "segment": "insurance_metlife", "owner_email": "...", "owner_whatsapp": "..." }
GET    /v1/admin/tenants/:id
PATCH  /v1/admin/tenants/:id
POST   /v1/admin/tenants/:id/suspend
POST   /v1/admin/tenants/:id/resume
POST   /v1/admin/tenants/:id/churn
Body: { "reason": "..." }

# Usage
GET    /v1/admin/usage?tenant_id?&period=current_month
GET    /v1/admin/usage/consolidated   # totais across tenants

# Templates (master library)
GET    /v1/admin/templates
POST   /v1/admin/templates
PATCH  /v1/admin/templates/:id
DELETE /v1/admin/templates/:id

# Billing
GET    /v1/admin/billing?tenant_id?&status?
POST   /v1/admin/billing/:id/mark-paid
POST   /v1/admin/billing/:id/refund
```

## A.4 Rate limits

| Endpoint pattern | Limite |
|---|---|
| `/v1/auth/*` | 10 req/min por IP |
| `/v1/tenant/*` GETs | 600 req/min por tenant |
| `/v1/tenant/*` POSTs/PATCHs | 60 req/min por tenant |
| `/v1/webhooks/*` | sem limite (interno) |
| `/v1/admin/*` | sem limite (interno) |

**Resposta quando excede:**
```
HTTP 429
Retry-After: 30
{ "error": { "code": "RATE_LIMITED", "message": "...", "details": { "retry_after_seconds": 30 } } }
```

---

# ANEXO B · Webhooks

## B.1 Webhook: Z-API recebe mensagem do lead

**Endpoint:** `POST /v1/webhooks/zapi/inbound`

**Auth:** validação por HMAC-SHA256 do payload com `tenant_secrets.zapi_webhook_secret`

**Payload Z-API (recebido):**
```json
{
  "instanceId": "3DCCAB...",
  "messageId": "3EB0FA...",
  "phone": "5517998764422",
  "fromMe": false,
  "isGroup": false,
  "momment": 1715961234567,
  "type": "ReceivedCallback",
  "text": { "message": "Pode explicar sim, já tenho seguro de vida" },
  "senderName": "Rodrigo Maluf",
  "senderPhoto": "https://...",
  "broadcast": false
}
```

**Tratamento (pseudo-código):**
```typescript
// 1. Resolve tenant pelo instanceId
const tenant = await tenants.findByZapiInstance(payload.instanceId);
if (!tenant) return reply.status(404).send();

// 2. Verifica HMAC
const expected = hmacSha256(rawBody, tenant.zapi_webhook_secret);
if (expected !== req.headers['x-zapi-signature']) return reply.status(401).send();

// 3. Idempotência: já processou este messageId?
const exists = await messages.findOne({ tenant_id: tenant.id, whatsapp_message_id: payload.messageId });
if (exists) return reply.status(200).send({ duplicate: true });

// 4. Enfileira processamento
await queue.add('process-inbound', {
  tenant_id: tenant.id,
  whatsapp_message_id: payload.messageId,
  from_phone: payload.phone,
  content: payload.text.message,
  received_at: new Date(payload.momment)
});

// 5. ACK rápido (Z-API espera 200 em < 5s)
return reply.status(200).send({ queued: true });
```

## B.2 Webhook: Z-API status de delivery

**Endpoint:** `POST /v1/webhooks/zapi/status`

**Payload:**
```json
{
  "instanceId": "3DCCAB...",
  "messageId": "3EB0FA...",
  "status": "DELIVERED",  // SENT | DELIVERED | READ | FAILED
  "phone": "5517998764422",
  "momment": 1715961234567,
  "type": "MessageStatusCallback"
}
```

**Tratamento:**
- Atualiza `messages.delivery_status` e `delivered_at`/`read_at`
- Se `FAILED`: registra em `lead_events` + se for o 3º FAILED do dia, alerta time Guilds (risco de ban)

## B.3 Webhook: Z-API status da instância

**Endpoint:** `POST /v1/webhooks/zapi/instance`

```json
{
  "instanceId": "...",
  "status": "connected|disconnected|qr-required|banned",
  "qrCode?": "data:image/png;base64,..."
}
```

**Tratamento:**
- `banned`: pausa TODAS as campanhas do tenant + dispara alerta crítico
- `disconnected` por > 30min: alerta tenant + Guilds
- `qr-required`: envia QR pro tenant via email/WhatsApp alternativo

## B.4 Webhook: Google Calendar push notification

**Endpoint:** `POST /v1/webhooks/google/calendar`

**Setup:** `watch` API do Google envia headers, não payload completo:
```
X-Goog-Channel-ID: <channel_id_que_associamos_ao_tenant>
X-Goog-Resource-State: exists|sync|not_exists
X-Goog-Resource-ID: <google_resource_id>
X-Goog-Resource-URI: https://www.googleapis.com/calendar/v3/...
X-Goog-Channel-Token: <token_per_tenant>
```

**Tratamento:**
1. Resolve tenant pelo `X-Goog-Channel-Token`
2. Faz `events.list` com `updatedMin` da última sync
3. Pra cada evento alterado: se vinculado a algum `meeting.google_event_id`, atualiza status
4. Renova watch antes de expirar (válido por 7-30 dias)

## B.5 Webhook: Stripe (Fase 2 · billing)

**Endpoint:** `POST /v1/webhooks/stripe`

**Eventos relevantes:**
- `customer.subscription.created`
- `customer.subscription.updated`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`

**Validação:** `stripe.webhooks.constructEvent` com secret

---

# ANEXO C · State Machines

## C.1 Lead state machine

```
captured
   ↓ (worker enrich-leads)
enriched
   ↓ (worker send-messages)
contacted
   ↓ (webhook inbound)
conversing ──┐
   ↓         │
qualified    │
   ↓         │
meeting_scheduled
   ↓
{closed_won, closed_lost, no_show}

paralelos:
   * → opted_out (via webhook ou comando)
   * → archived (sem resposta 30d ou manual)
```

**Transições permitidas (validadas no service layer):**
```typescript
const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  captured: ['enriched', 'archived'],
  enriched: ['contacted', 'archived'],
  contacted: ['conversing', 'no_response', 'opted_out'],
  no_response: ['contacted', 'archived'],            // após follow-up
  conversing: ['qualified', 'not_interested', 'opted_out', 'escalated_human'],
  qualified: ['meeting_scheduled', 'lost_before_meeting'],
  meeting_scheduled: ['closed_won', 'closed_lost', 'no_show', 'rescheduled'],
  rescheduled: ['meeting_scheduled'],
  // estados terminais (sem saída):
  closed_won: [],
  closed_lost: [],
  opted_out: [],
  archived: [],
  not_interested: [],
  lost_before_meeting: []
};

function transitionLead(lead: Lead, to: LeadStatus, reason?: string) {
  if (!VALID_TRANSITIONS[lead.status].includes(to)) {
    throw new InvalidTransition(`${lead.status} → ${to}`);
  }
  // ... atualiza + log
}
```

## C.2 Conversation state machine

```
active ↔ paused (user assume / libera)
   ↓
escalated (IA detectou pedido humano)
   ↓
closed (lead opt-out, no_response > 30d, ou manual)
```

## C.3 Meeting state machine

```
scheduled
   ↓ (lembrete 1h antes)
confirmed
   ↓ (Giovane marca pós-reunião)
{happened, no_show, rescheduled, cancelled}

happened
   ↓
{closed_won, second_meeting_scheduled, not_interested, thinking}
```

## C.4 Campaign state machine

```
draft → active ↔ paused → archived
```

## C.5 Tenant lifecycle

```
onboarding (criado mas não pagou setup)
   ↓ (pagamento)
active
   ↓
suspended (inadimplência D+15) ↔ active (pagou)
   ↓ (cancelamento ou inadimplência D+45)
churned (dados retidos por 90d depois excluídos)
```

---

# ANEXO D · Algoritmos

## D.1 Fit Score (0.0 a 10.0)

**Fórmula:**
```
fit_score = (
  matches_target_profession * 3.0 +
  whatsapp_valid * 2.0 +
  is_owner_or_partner * 2.0 +
  high_value_area * 1.0 +
  cnpj_age_score * 1.0 +
  high_rating * 1.0
) - penalties

Cap: max 10.0, min 0.0
```

**Detalhamento:**

| Componente | Peso | Como calcular |
|---|---|---|
| `matches_target_profession` | +3.0 | profissão do lead bate com campanha (binário) |
| `whatsapp_valid` | +2.0 | validado via Z-API check-phone (binário) |
| `is_owner_or_partner` | +2.0 | médico com consultório próprio, advogado sócio, empresário ativo no CNPJ |
| `high_value_area` | +1.0 | bairros pré-cadastrados como "nobres" da cidade (config per-tenant) |
| `cnpj_age_score` | 0–1.0 | normalizado: 5+ anos = 1.0, 0 anos = 0.0 |
| `high_rating` | +1.0 | Google Maps rating ≥ 4.5 com ≥ 10 avaliações |

**Penalties:**
| Condição | Penalty |
|---|---|
| Já abordado nos últimos 90 dias por este tenant | -∞ (skip) |
| Já é cliente ativo deste tenant | -∞ (skip) |
| Em `optouts` deste tenant | -∞ (skip) |
| Profissão NÃO bate campanha | -5 |

**Threshold mínimo pra abordar:** `fit_score >= 6.0` (configurável per-tenant em `campaigns.filters.min_fit_score`)

**Implementação:**
```typescript
function calculateFitScore(lead: Lead, campaign: Campaign, tenant: Tenant): number {
  let score = 0;

  if (lead.profession === campaign.profession) score += 3.0;
  if (lead.whatsapp_valid) score += 2.0;
  if (lead.metadata?.is_owner || lead.metadata?.is_partner) score += 2.0;
  if (tenant.high_value_areas?.includes(lead.address?.neighborhood)) score += 1.0;

  const cnpjYears = lead.metadata?.cnpj_age_years || 0;
  score += Math.min(cnpjYears / 5, 1.0);

  const rating = lead.metadata?.google_rating;
  const reviews = lead.metadata?.google_reviews_count || 0;
  if (rating >= 4.5 && reviews >= 10) score += 1.0;

  return Math.max(0, Math.min(10, score));
}
```

## D.2 Programa de Aquecimento WhatsApp (cronograma diário)

**Premissa:** número novo no WhatsApp Business inicia "frio" — Meta monitora padrão de envio. Volume alto sem aquecimento = ban em ~3 dias.

**Cronograma oficial (executado por `worker:send-messages`):**

| Semana | Dia | Envios/dia | Estratégia |
|---|---|---|---|
| **1** | D1-D2 | 5 | Só replies para leads quentes (manual) |
| | D3-D5 | 15 | Replies + 10 cold msgs spread no dia |
| | D6-D7 | 20 | + leads de alta qualidade |
| **2** | D8-D10 | 30 | + balance replies/cold ~50/50 |
| | D11-D14 | 50 | Cold inicia em earnest |
| **3** | D15-D18 | 70 | Continua subindo gradual |
| | D19-D21 | 100 | Plateau temporário |
| **4** | D22-D25 | 130 | Subir se Quality Rating verde |
| | D26-D28 | 160 | |
| | D29-D30 | 200 | |
| **5+** | regime | 200/dia | Cap por padrão · pode ir a 300 se Quality continua verde por 2 semanas |

**Validações antes de cada envio:**
```typescript
async function canSendMessage(tenant: Tenant): Promise<{ allowed: boolean; reason?: string }> {
  const instance = await zapi.getInstanceStatus(tenant.zapi_instance_id);

  if (instance.status !== 'connected') return { allowed: false, reason: 'instance_not_connected' };
  if (instance.quality_rating === 'red') return { allowed: false, reason: 'quality_red' };

  const today = await usageTracker.getTodayCount(tenant.id);
  const dailyLimit = getAquecimentoLimit(tenant.zapi_warmup_day);
  if (today >= dailyLimit) return { allowed: false, reason: 'daily_limit_reached' };

  const lastMessageAt = await getLastMessageTimestamp(tenant.id);
  const secondsAgo = (Date.now() - lastMessageAt) / 1000;
  const minJitter = 40 + Math.random() * 50; // 40-90s
  if (secondsAgo < minJitter) return { allowed: false, reason: 'throttle' };

  const hour = new Date().getHours();
  if (hour < 9 || hour >= 18) return { allowed: false, reason: 'outside_hours' };

  const day = new Date().getDay();
  if (day === 0) return { allowed: false, reason: 'sunday' }; // sem envio domingo
  if (day === 6 && hour >= 12) return { allowed: false, reason: 'saturday_afternoon' };

  return { allowed: true };
}
```

## D.3 Classificador de Intenção (IA)

**Onde roda:** worker `process-inbound`, após receber mensagem do lead.

**Categorias possíveis (output do LLM):**
```
intent = one_of [
  "interested",              // "quero saber mais", "explica"
  "has_other_insurance",     // "já tenho Bradesco", "tenho seguro"
  "price_objection",         // "tá caro", "quanto custa"
  "no_time_now",             // "agora não posso", "te chamo depois"
  "asking_callback",         // "pode me ligar", pedido explícito
  "scheduling",              // "quarta às 17h tá bom"
  "rescheduling",            // "vamos remarcar"
  "not_interested",          // "não tenho interesse", "obrigado mas não"
  "optout_request",          // "SAIR", "PARAR", "não quero receber"
  "off_topic",               // pergunta fora do tema (saudação, dúvida geral)
  "complaint",               // reclamação, ameaça
  "unclear"                  // não consegue classificar
]
```

**Prompt do classificador (sistema):**
```
Você é classificador de intenção de mensagens de leads em conversa com corretor de seguros.
Receba a última mensagem do lead + contexto da conversa.
Responda APENAS com JSON: {"intent": "<categoria>", "confidence": 0.0-1.0, "rationale": "..."}.

Categorias possíveis: [lista acima]

Regras:
- Se mensagem contém palavras de opt-out (SAIR, PARAR, NÃO QUERO, NÃO RECEBER, DESCADASTRE), sempre intent=optout_request
- Se confiança < 0.6, retorne intent=unclear
- Em ameaças ou xingamentos: intent=complaint
```

**Modelo usado:** GPT-4o-mini com `temperature: 0.0` (consistência máxima)

**Fallback:** se classifier falha (timeout/error), enfileira fallback rule-based:
```typescript
function ruleBasedIntent(message: string): Intent {
  const lower = message.toLowerCase();
  if (/\b(sair|parar|não quero|descadastr|stop)\b/.test(lower)) return 'optout_request';
  if (/\b(quanto custa|preço|valor|caro)\b/.test(lower)) return 'price_objection';
  if (/\b(já tenho|tenho seguro|tenho plano)\b/.test(lower)) return 'has_other_insurance';
  if (/\b(liga|me liga|me ligue|telefone)\b/.test(lower)) return 'asking_callback';
  if (/\b(às \d+|hora|quarta|quinta|amanhã)\b/.test(lower)) return 'scheduling';
  return 'unclear'; // escalar pra humano
}
```

## D.4 Política de Follow-up

**Quando disparar:** lead em status `contacted` sem resposta após X dias.

| Tentativa | Quando | Conteúdo (template) |
|---|---|---|
| **1** | D+3 sem resposta | Quick reminder leve · "Oi {{NOME}}, ainda dá tempo? Posso te explicar em 30s." |
| **2** | D+7 sem resposta | Reframe + valor · "{{NOME}}, sei que correria. Mando um vídeo de 1min explicando?" |
| **3** | D+14 sem resposta | Última tentativa + soft optout · "{{NOME}}, se preferir que eu não insista mais, é só responder SAIR. Senão sigo disponível." |
| **(arquiva)** | D+21 sem resposta | Status → `archived` · pode ser reativado em campanha futura |

**Critérios de skip de follow-up:**
- Lead respondeu uma vez (mesmo "nao tenho interesse") → não follow-up
- Lead em `optouts`
- Tenant pausou campaign

## D.5 Critérios de Escalonamento Humano (IA → Giovane)

A IA passa controle ao Giovane (status → `escalated_human`, notificação push) quando:

| Trigger | Por quê |
|---|---|
| `intent: asking_callback` | Lead explicitamente pediu ligação |
| `intent: complaint` | Risco reputacional |
| Lead repetiu pergunta 3x sem a IA conseguir responder bem | IA perdida → humano resolve |
| Lead mandou áudio | IA não processa áudio na Fase 1 (text-only) |
| Lead enviou pergunta específica sobre apólice já existente (cliente atual) | Fora do escopo IA |
| Lead falou de valor de prêmio específico que ele já tem cotado | IA não confirma valores |
| Confidence do classifier < 0.4 em 2 mensagens seguidas | IA não entendeu |
| Lead em conversa há > 10 mensagens sem agendar reunião | Stuck — humano avalia |

## D.6 Política de Off-hours

**IA NÃO envia mensagens fora de:**
- Segunda a sexta: 9h-18h
- Sábado: 9h-12h
- Domingo: 0 (zero envios)
- Feriados nacionais (lista pré-cadastrada) + feriados municipais da cidade do tenant
- Janela personalizada per-tenant via `users.preferences.send_window`

**IA RESPONDE mensagens recebidas fora de horário?** Sim, mas com **delay programado** (cai na fila pra próxima janela útil). Cliente não percebe — apenas pensa que demorou um pouco.

**Comportamento:** se lead manda 22h, mensagem entra em `pending_outbound` com `scheduled_for = next_window_start + jitter(0-30min)`. Próximo worker run no dia útil dispara.

## D.7 Reativação de Leads Frios

**Quando rodar:** mensalmente (1º do mês), worker `cold-reactivation`.

**Elegíveis:**
- `lead.status = archived`
- Sem mensagem nas últimas 90 dias
- `fit_score >= 7.5`
- Nunca esteve em `opted_out`

**Mensagem:** template específico de "voltei ao assunto, surgiu uma novidade da MetLife..." (mais leve, sem pressão)

**Limite:** máximo 10% do volume mensal do tenant pra evitar fadiga

---

# ANEXO E · IA & Prompts

## E.1 Estrutura do system prompt (template Jinja)

```
Você é assistente do corretor {{user.name}} (MetLife, SJRP, há {{user.years_career}} anos).

== LINGUAGEM E TOM (extraída no discovery) ==
{{tenant.ai_voice_profile.tone_description}}

Exemplos do {{user.name}} falando (replique o estilo, não o conteúdo literal):
{% for example in tenant.ai_voice_profile.examples %}
- "{{example}}"
{% endfor %}

== CONTEXTO DO LEAD ==
- Nome: {{lead.name}}
- Profissão: {{lead.profession}}
- Cidade: {{lead.address.city}}
- Fit Score: {{lead.fit_score}}/10

== HISTÓRICO DA CONVERSA ==
{% for msg in conversation.messages %}
[{{msg.created_at}}] {{msg.sender}}: {{msg.content}}
{% endfor %}

== ROTEIRO ATUAL: {{script.name}} ==
Etapa atual: {{current_node.id}} ({{current_node.type}})
Próxima ação esperada: {{current_node.next_expected_action}}

== REGRAS ABSOLUTAS (nunca quebrar) ==
1. NUNCA cite valor de prêmio específico (depende de cotação SUSEP).
2. NUNCA prometa cobertura específica (avaliação MetLife).
3. NUNCA fale como "vou te aprovar" — é a MetLife que aprova.
4. Sempre que detectar pedido de ligação direta → encaminhe pro {{user.name}}.
5. Sempre que detectar SAIR/PARAR/NÃO QUERO → confirme opt-out e encerre conversa.
6. Mantenha tom consultivo, nunca pressão.
7. Máximo 4 linhas por mensagem. WhatsApp não tolera blocos longos.
8. Se não souber responder com certeza, escalone pro {{user.name}}.

== OBJETIVOS (ordem de prioridade) ==
1. Entender se o lead tem fit (sócio/profissional liberal com renda da própria atuação).
2. Educar sobre proteção de renda (DIH, doença grave) sem jargão técnico excessivo.
3. Marcar reunião de 30min — consulte agenda real via {{tools.check_calendar}}.

== FERRAMENTAS DISPONÍVEIS ==
- check_calendar(start, end): retorna horários livres do {{user.name}}
- schedule_meeting(datetime, lead_id, location): cria evento no Google Calendar
- send_pdf(material_id): envia PDF institucional MetLife
- escalate_to_human(reason): pausa IA e notifica {{user.name}}
- mark_optout(): registra opt-out

Responda apenas com JSON:
{
  "intent_detected": "<categoria>",
  "tool_calls": [...],
  "message_to_send": "<texto>",
  "should_transition_to": "<lead_status_target>"
}
```

## E.2 Guardrails (validação pre-send · obrigatória)

**Funções de validação rodadas antes de enviar resposta da IA:**

```typescript
const GUARDRAILS = [
  // Guardrail 1: Sem valores financeiros específicos
  (msg) => {
    const hasMoneyPattern = /R\$\s*\d|reais|mensalidade de \d|premio.*\d/i.test(msg);
    if (hasMoneyPattern) return { fail: true, reason: 'mentions_specific_money' };
  },

  // Guardrail 2: Sem promessa de cobertura
  (msg) => {
    if (/garantido|sem dúvida cobre|com certeza cobre|aprovado/i.test(msg)) {
      return { fail: true, reason: 'promised_coverage' };
    }
  },

  // Guardrail 3: Tamanho máximo
  (msg) => {
    if (msg.length > 800) return { fail: true, reason: 'too_long' };
    const lines = msg.split('\n').length;
    if (lines > 6) return { fail: true, reason: 'too_many_lines' };
  },

  // Guardrail 4: Sem links externos não-MetLife
  (msg) => {
    const urls = msg.match(/https?:\/\/\S+/g) || [];
    const invalid = urls.filter(u => !u.includes('metlife.com') && !u.includes('guilds.com.br'));
    if (invalid.length) return { fail: true, reason: 'unauthorized_link' };
  },

  // Guardrail 5: Linguagem proibida
  (msg) => {
    const blocked = ['ganhe dinheiro', 'urgente', 'última chance', 'oferta exclusiva', 'desconto'];
    if (blocked.some(w => msg.toLowerCase().includes(w))) {
      return { fail: true, reason: 'spam_language' };
    }
  },

  // Guardrail 6: Variáveis não substituídas
  (msg) => {
    if (/\{\{|\}\}/.test(msg)) return { fail: true, reason: 'unsubstituted_variable' };
  }
];

function validateAIResponse(msg: string): GuardrailResult {
  for (const guard of GUARDRAILS) {
    const result = guard(msg);
    if (result?.fail) return result;
  }
  return { ok: true };
}
```

**Comportamento se guardrail falha:**
1. Log do erro com contexto (Sentry)
2. Re-tenta com IA usando prompt corretivo ("Sua resposta anterior foi rejeitada porque {{reason}}. Tente novamente.")
3. Se 2ª tentativa também falha → escala pra humano

## E.3 Versionamento de Prompts

**Onde guardamos:** banco de dados na tabela `prompt_versions`:

```sql
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),    -- null = global Guilds
  prompt_type TEXT NOT NULL,                -- 'system' | 'classifier' | 'guardrail_corrective'
  version SERIAL,
  template TEXT NOT NULL,                   -- Jinja
  variables_required JSONB,
  test_cases JSONB,                         -- exemplos com expected outputs
  is_active BOOLEAN DEFAULT false,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT
);

-- Apenas 1 ativo por (tenant_id, prompt_type)
CREATE UNIQUE INDEX ON prompt_versions (tenant_id, prompt_type) WHERE is_active = true;
```

**Fluxo:**
1. Dev edita prompt → cria nova versão (`is_active=false`)
2. Roda test cases automaticamente em CI
3. Se passa todos: aprovar promoção pra `is_active=true`
4. Rollback é instantâneo (revert da flag)

## E.4 Test Cases obrigatórios da IA (CI)

Antes de qualquer prompt novo entrar em prod:

```typescript
// tests/ai/system-prompt.spec.ts
describe('System prompt v{N}', () => {
  test('não cita valor específico de prêmio mesmo quando questionado', async () => {
    const response = await ai.respond({
      prompt: latestSystemPrompt,
      lead_message: "Quanto fica a apólice pra mim? Me dá um valor pelo menos."
    });
    expect(response.message).not.toMatch(/R\$\s*\d/);
  });

  test('escalona para humano quando lead pede ligação', async () => {
    const response = await ai.respond({
      lead_message: "Prefiro que você me ligue, qual seu telefone?"
    });
    expect(response.tool_calls).toContainEqual(
      expect.objectContaining({ name: 'escalate_to_human' })
    );
  });

  test('reconhece e processa opt-out', async () => {
    const response = await ai.respond({
      lead_message: "Não quero mais receber mensagens, SAIR"
    });
    expect(response.intent_detected).toBe('optout_request');
    expect(response.tool_calls).toContainEqual(
      expect.objectContaining({ name: 'mark_optout' })
    );
  });

  // ~30 test cases cobrindo todas categorias de intent + guardrails
});
```

Coverage target: **100% dos cenários documentados** devem ter test case.

---

# ANEXO F · Workers & Concorrência

## F.1 Spec de cada worker

### F.1.1 `worker:capture-google-maps`

| Campo | Valor |
|---|---|
| Tipo | Cron job |
| Frequência | Cada 1h em horário comercial (9h-18h dias úteis) |
| Concorrência | 1 instância por tenant (lock distribuído) |
| Timeout | 10 min |
| Retry | 3× com backoff exponencial (2min, 5min, 15min) |
| DLQ | Sim · alerta admin Guilds |

**Input (job.data):**
```json
{ "tenant_id": "uuid", "campaign_id": "uuid", "max_captures": 100 }
```

**Output (efeito colateral):**
- Insert N rows em `leads` (status: `captured`)
- Insert N rows em `lead_events` (event_type: `captured`)
- Atualiza `tenant_usage.google_maps_calls`

**Lock:** Redis SETNX com chave `lock:capture:{tenant_id}:{campaign_id}` (TTL 10min)

### F.1.2 `worker:enrich-leads`

| Campo | Valor |
|---|---|
| Frequência | Cada 15 min |
| Concorrência | Até 5 jobs paralelos por tenant |
| Timeout | 2 min |
| Retry | 5× backoff (1min, 3min, 10min, 30min, 1h) |
| DLQ | Sim |

**Input:**
```json
{ "tenant_id": "uuid", "lead_ids": ["uuid", "uuid", ...] }
```

**Lógica:**
1. Carrega leads pendentes (`status: captured`)
2. Para cada: valida WhatsApp (Z-API) + enriquece via BrasilAPI/Receita
3. Calcula fit_score
4. Atualiza status → `enriched`

### F.1.3 `worker:send-messages`

| Campo | Valor |
|---|---|
| Tipo | Event-driven (rate-limited) |
| Frequência | Contínuo, respeitando throttle |
| Concorrência | 1 por tenant (mensagens não podem ir em paralelo do mesmo número) |
| Timeout | 30s por mensagem |
| Retry | 3× com backoff |

**Input:**
```json
{
  "tenant_id": "uuid",
  "conversation_id": "uuid",
  "message_content": "...",
  "message_type": "first_contact|reply|followup",
  "idempotency_key": "uuid"
}
```

**Validações pre-send (sequencial):**
1. Lead não está em `optouts`?
2. Tenant respeitando aquecimento? (`canSendMessage()`)
3. Hora atual está na janela?
4. Guardrails passaram?

### F.1.4 `worker:process-inbound`

| Campo | Valor |
|---|---|
| Tipo | Event-driven (webhook Z-API) |
| Frequência | Imediato |
| Concorrência | 1 job por conversation (lock) |
| Timeout | 60s |
| Retry | 2× rápido (5s, 30s) |
| DLQ | Sim · escalona pra humano |

**Lock:** `lock:conversation:{conversation_id}` TTL 60s — garante que 2 mensagens do mesmo lead em sequência não geram race condition.

### F.1.5 `worker:schedule-meeting`

Trigger: tool call `schedule_meeting` da IA.

```json
{
  "tenant_id": "uuid",
  "lead_id": "uuid",
  "scheduled_for": "ISO datetime",
  "duration_minutes": 30,
  "location": "...",
  "idempotency_key": "uuid"
}
```

### F.1.6 `worker:daily-digest`

Cron 8h da manhã, envia resumo WhatsApp pro tenant:
```
"Bom dia Giovane!
📅 Hoje: 3 reuniões (próxima 14h30 · Dra. Roberta)
🔥 12 leads quentes precisam de você
⚠️ 1 lead pediu ligação (Fernanda · padaria)
✨ Sua IA capturou +248 leads ontem"
```

### F.1.7 `worker:health-check`

Cron 5min:
- Verifica Quality Rating de cada Z-API instance
- Se RED ou YELLOW: pausa todas campanhas + alerta crítico
- Verifica latência média OpenAI último 5min · se > 10s, fallback pra Claude

### F.1.8 `worker:followup`

Cron diário 10h:
- Identifica leads `contacted` há D+3, D+7, D+14 sem resposta
- Enfileira `send-messages` com template específico de cada tentativa

### F.1.9 `worker:cold-reactivation`

Cron mensal (1º do mês):
- Identifica leads `archived` com fit ≥ 7.5
- Limita a 10% do volume mensal do tenant
- Enfileira reativação

### F.1.10 `worker:usage-aggregation`

Cron horário:
- Agrega `messages.llm_cost_cents`, `google_maps_calls`, etc.
- Insert/Update em `tenant_usage`
- Se passa 70% / 90% / 100% da franquia: dispara alerta

## F.2 Idempotência

**Padrão:** todo job e endpoint que produz efeito colateral tem `idempotency_key`.

```typescript
// Tabela
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  tenant_id UUID,
  endpoint TEXT,
  response_cache JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ            -- 24h padrão
);

// Middleware
async function idempotencyMiddleware(req, reply) {
  const key = req.headers['idempotency-key'];
  if (!key) return; // optional, mas obrigatório em POSTs financeiros

  const cached = await db.idempotency_keys.findUnique({ where: { key } });
  if (cached && cached.expires_at > new Date()) {
    return reply.send(cached.response_cache);
  }

  // Marca em processamento
  await db.idempotency_keys.upsert({
    where: { key },
    create: { key, tenant_id: req.tenantId, endpoint: req.url, ... },
    update: {}
  });

  // Após response, salva no cache
  reply.afterResponse(() => db.idempotency_keys.update(...));
}
```

## F.3 Locks Distribuídos

**Implementação via Redis SETNX:**
```typescript
async function withLock<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, 'NX', 'EX', ttlSec);
  if (!acquired) throw new LockUnavailable(key);

  try {
    return await fn();
  } finally {
    // Lua script pra release seguro (só remove se token bate)
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1, key, token
    );
  }
}

// Uso
await withLock(`conversation:${convId}`, 60, async () => {
  // processa mensagem
});
```

## F.4 Throttling per-tenant

```typescript
// Token bucket via Redis
class TenantThrottle {
  async tryConsume(tenantId: string, action: 'whatsapp_send' | 'ai_call' | 'maps_call'): Promise<boolean> {
    const key = `throttle:${action}:${tenantId}:${currentMinute()}`;
    const count = await redis.incr(key);
    await redis.expire(key, 60);
    return count <= this.getLimit(tenantId, action);
  }

  getLimit(tenantId: string, action: string): number {
    // baseado em tenant.plan e aquecimento
    return LIMITS[action][tenantPlan];
  }
}
```

---

# ANEXO G · Auth, Onboarding & Multi-tenancy operacional

## G.1 Auth flow detalhado

### G.1.1 Magic link via WhatsApp

```
1. User insere WhatsApp no /login
2. POST /v1/auth/magic-link { "whatsapp": "+5517..." }
3. API gera single-use token (UUID + assinatura HMAC)
   - Salva em redis: key="magic:{token}", value="{user_id}", TTL 10min
4. Envia via Z-API (instância dedicada Guilds, não a do tenant):
   "Olá Giovane! Clique pra entrar: https://app.prospix.com.br/auth/callback?token=ABC123
    Link válido por 10 min."
5. User clica → GET /v1/auth/callback?token=ABC123
6. API valida token + busca user + emite JWT
7. Redirect pro painel com tokens no localStorage
```

### G.1.2 JWT structure

```json
{
  "sub": "user_uuid",
  "tenant_id": "tenant_uuid",
  "role": "owner|assistant|guilds_admin",
  "email": "...",
  "name": "...",
  "iat": 1715961234,
  "exp": 1716566034,         // 7 dias
  "jti": "session_uuid"        // para revogação
}
```

**Assinatura:** RS256 (chave privada no vault, pública no client)
**Refresh token:** 30 dias, single-use (rotation)

### G.1.3 Tenant resolution

```typescript
// Middleware preHandler
async function tenantContext(req: FastifyRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Unauthorized();

  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

  // Verifica se sessão não foi revogada
  const revoked = await redis.get(`revoked:${decoded.jti}`);
  if (revoked) throw new Unauthorized('Session revoked');

  // Valida tenant_id no header bate com JWT
  const headerTenantId = req.headers['x-tenant-id'];
  if (headerTenantId && headerTenantId !== decoded.tenant_id) {
    throw new Forbidden('Tenant mismatch');
  }

  // Injeta contexto no PG
  await db.$executeRaw`SELECT set_config('app.tenant_id', ${decoded.tenant_id}, true)`;
  await db.$executeRaw`SELECT set_config('app.user_id', ${decoded.sub}, true)`;

  req.tenantId = decoded.tenant_id;
  req.userId = decoded.sub;
  req.role = decoded.role;
}
```

## G.2 Onboarding wizard (super-admin Guilds)

### Passo 1 · Dados do tenant
```
- Nome legal do tenant
- Slug (auto-gerado, editável)
- Segmento (insurance_metlife, insurance_other, real_estate, ...)
- Plano contratado (Starter/Standard/Premium)
- Setup pago (cents)
- MRR (cents)
- Data assinatura contrato
- Data prevista go-live
```

### Passo 2 · Dados do owner
```
- Nome completo
- Email
- WhatsApp pessoal
- SUSEP (opcional)
- Código MetLife/parceiro
- Cidade
- Bio (opcional, usado em LP)
```

### Passo 3 · Discovery (assistido)
```
- Upload voice_profile (JSON) OU
- Wizard de perguntas (10 perguntas → gera voice_profile via IA)
```

### Passo 4 · Templates de roteiros
```
- Lista de templates compatíveis com segment
- Owner escolhe 3 (médico/advogado/empresário)
- Clona pra tenant (status: draft)
```

### Passo 5 · Integrações
```
- Cadastro Z-API (instance_id + token)
- OAuth Google (Calendar + Maps)
- Validação automática de cada credencial
```

### Passo 6 · Ativação
```
- Status tenant → "active"
- Envia magic link pro owner pelo WhatsApp Guilds
- Cria primeiro lead de teste (Guilds team)
- Dispara mensagem de boas-vindas no painel
```

**SLA do onboarding completo:** ≤ 30 minutos (se owner está disponível em chamada).

## G.3 Tenant churn process

### G.3.1 Triggers
- Owner solicita cancelamento via painel
- Inadimplência D+45 (após avisos D+15, D+30)
- Decisão Guilds (ToS violation)

### G.3.2 Fluxo
```
1. Status tenant → "churning" (grace period 7 dias)
2. Owner recebe email com:
   - Confirmação de cancelamento
   - Botão "Reativar" (1-clique nos 7 dias)
   - Link pra exportar todos os dados (LGPD)
3. Após 7 dias sem reativação:
   - Status → "churned"
   - Pausa todas campanhas
   - WhatsApp instance Z-API → desconectada (mas Z-API mantida 30d pra evitar perda do número)
   - Painel mostra apenas tela "dados em retenção"
4. D+30 após churned: notifica owner que dados serão deletados em 60d
5. D+90 após churned: DELETE CASCADE de tudo (preserva apenas tenant_billing pra fiscal)
```

## G.4 LGPD: Portabilidade e Exclusão

### G.4.1 Portabilidade (LGPD art. 18, V)
- Endpoint: `POST /v1/tenant/lgpd/export-data`
- Worker assíncrono gera ZIP com:
  - `leads.csv` · todos campos
  - `conversations.json` · com mensagens
  - `meetings.csv`
  - `campaigns.json`
  - `scripts.json`
- Disponibiliza por 7 dias em URL pré-assinada (R2)
- Email pro owner quando pronto

### G.4.2 Exclusão de dados de lead (LGPD art. 18, VI)
- Lead pode solicitar via WhatsApp (mensagem com "DELETAR MEUS DADOS")
- IA reconhece intent → escalona + responde automático "Recebido, processaremos em até 15 dias"
- Owner aprova no painel
- Worker `delete-lead-data`:
  - DELETE de `messages`, `conversations`, `meetings`, `lead_events`
  - Anonimiza `leads` (mantém row mas zera campos pessoais)
  - Mantém em `optouts` (registro de não-contato)

### G.4.3 Audit log de operações sensíveis
```sql
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  user_id UUID,
  action TEXT NOT NULL,            -- 'lead.delete' | 'tenant.churn' | 'secrets.update' | ...
  target_type TEXT,
  target_id TEXT,
  payload JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at DESC);
```

Tudo que é DELETE, UPDATE em `tenant_secrets`, mudança de billing, etc → audit log.

---

# ANEXO H · DevOps & Operação

## H.1 Variáveis de ambiente (.env.example)

```bash
# === Aplicação ===
NODE_ENV=development|staging|production
PORT=3000
APP_URL=https://app.prospix.com.br
ADMIN_URL=https://admin.prospix.com.br
API_URL=https://api.prospix.com.br

# === Database ===
DATABASE_URL=postgresql://user:pass@host:5432/db?schema=public
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=50
SHADOW_DATABASE_URL=postgresql://...   # pra Prisma migrate

# === Redis (queue + cache + locks) ===
REDIS_URL=redis://...
REDIS_MAX_RETRIES=10

# === Auth ===
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=30d
MAGIC_LINK_TTL_SECONDS=600

# === Storage (Cloudflare R2) ===
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=prospix
R2_PUBLIC_URL=https://...

# === IA (chaves compartilhadas Guilds) ===
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_DEFAULT=gpt-4o-mini-2024-07-18
OPENAI_MODEL_CLASSIFIER=gpt-4o-mini-2024-07-18
ANTHROPIC_API_KEY=sk-ant-...        # fallback
ANTHROPIC_MODEL_FALLBACK=claude-3-5-haiku-20241022

# === Z-API (instância Guilds pra magic links) ===
ZAPI_GUILDS_INSTANCE=...
ZAPI_GUILDS_TOKEN=...
ZAPI_BASE_URL=https://api.z-api.io

# === Vault (criptografia de tenant_secrets) ===
SECRETS_ENCRYPTION_KEY=32-byte-base64-key

# === Observabilidade ===
SENTRY_DSN=https://...
BETTERSTACK_TOKEN=...
POSTHOG_API_KEY=...

# === Feature flags ===
GROWTHBOOK_API_KEY=...
GROWTHBOOK_BASE_URL=https://...

# === Email (notificações) ===
RESEND_API_KEY=re_...
EMAIL_FROM="Guilds <no-reply@guilds.com.br>"

# === Limites globais ===
MAX_LEADS_PER_TENANT=50000
MAX_CAMPAIGNS_PER_TENANT=20
MAX_SCRIPTS_PER_TENANT=50

# === Aquecimento padrão ===
WARMUP_DAY_1_LIMIT=5
WARMUP_DAY_15_LIMIT=70
WARMUP_REGIME_LIMIT=200

# === LGPD / retenção ===
LEAD_ARCHIVE_AFTER_DAYS=180
TENANT_CHURNED_RETENTION_DAYS=90
EXPORT_DATA_URL_TTL_HOURS=168       # 7 dias
```

## H.2 Local dev setup

### H.2.1 Pré-requisitos
- Node.js 20+
- pnpm 9+
- Docker Desktop
- Cliente PostgreSQL (psql, TablePlus, Postico)

### H.2.2 Setup inicial
```bash
# Clone
git clone git@github.com:Gustavogm9/prospix.git
cd prospix

# Install
pnpm install

# Env
cp .env.example .env.local
# (preencher com creds dev — disponíveis no 1Password)

# Sobe infra local (Postgres + Redis)
docker-compose up -d

# Migrations + seed
pnpm db:migrate
pnpm db:seed                    # cria 2 tenants fictícios + leads fake

# Roda tudo
pnpm dev                        # roda api + web + admin em paralelo
```

### H.2.3 docker-compose.yml
```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: guilds
      POSTGRES_PASSWORD: guilds
      POSTGRES_DB: guilds_prospect_dev
    ports: ["5432:5432"]
    volumes: ["pg_data:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

  mailhog:                      # mocks email em dev
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]

volumes:
  pg_data:
```

### H.2.4 Seed data
- **Tenant A (Giovane MetLife)** · 200 leads, 10 conversas ativas, 3 reuniões agendadas
- **Tenant B (Roberta Prudential)** · 100 leads (para testar isolamento)
- 3 scripts clonados de templates
- 2 campanhas ativas

## H.3 CI/CD

### H.3.1 Branches
```
main             → produção (deploy automático após merge)
staging          → ambiente staging (deploy automático)
feature/*        → branches de desenvolvimento (deploy preview opcional)
hotfix/*         → fix urgente direto pra main
```

### H.3.2 GitHub Actions (`.github/workflows/`)

**ci.yml** (roda em todo PR):
```yaml
on: [pull_request]
jobs:
  lint:
    - pnpm lint
    - pnpm type-check
  test:
    services:
      postgres: image: postgres:16
      redis: image: redis:7
    - pnpm test:unit
    - pnpm test:integration
    - pnpm test:multi-tenant   # specifically isolation tests
  build:
    - pnpm build --filter=api,web,admin
```

**deploy-staging.yml** (push em staging):
```yaml
on:
  push:
    branches: [staging]
jobs:
  deploy:
    - railway up --service=api-staging
    - railway up --service=web-staging
    - smoke tests
```

**deploy-prod.yml** (push em main):
```yaml
on:
  push:
    branches: [main]
jobs:
  pre-deploy:
    - backup DB snapshot
    - run db migrations (dry-run first)
  deploy:
    - blue/green via Railway
    - run health checks
    - smoke tests
  post-deploy:
    - notify Slack #deploys
    - update Sentry release marker
```

### H.3.3 Rollback
```bash
# Via Railway CLI
railway redeploy --version=<sha-anterior>

# Migrations: sempre escrever migration reversa
# pnpm db:rollback --to=<migration-id>
```

## H.4 Migrations strategy

**Princípio:** zero downtime. Toda migration segue padrão **expand-contract**:

### Exemplo: adicionar coluna NOT NULL
```
Sprint 1:
  - migration: ADD COLUMN status TEXT;
  - deploy code que escreve em ambas (nulla coluna nova OK)

Sprint 2:
  - backfill data
  - deploy code que lê da coluna nova

Sprint 3:
  - migration: ALTER COLUMN status SET NOT NULL;
  - DROP old code path
```

### Exemplo: renomear coluna
```
Não renomear diretamente. Padrão:
  1. ADD COLUMN new_name
  2. Backfill new_name = old_name
  3. Deploy code que escreve em ambas
  4. Deploy code que lê só de new_name
  5. DROP COLUMN old_name
```

## H.5 Healthcheck endpoints

```
GET /health
Response 200: { "status": "ok" }
[Liveness · usado pelo Railway · responde sempre 200 se processo vivo]

GET /ready
Response 200: { "status": "ready", "checks": { "db": "ok", "redis": "ok" } }
Response 503: { "status": "not_ready", "checks": { "db": "fail" } }
[Readiness · usado pelo LB pra incluir/excluir do pool]

GET /admin/system-health
Response 200: full health (todas integrações: Z-API, Google, OpenAI, etc)
[Privado · só super-admin Guilds]
```

## H.6 Cache strategy

| O que | Onde | TTL | Invalidação |
|---|---|---|---|
| Tenant config (plan, limits) | Redis | 5 min | Webhook ou save manual |
| User session | Redis | 7 dias | Logout / revoke |
| Voice profile | Memória (warm) | 1h | Save explícito |
| Google Maps Place Details | Redis | 7 dias | Manual via admin |
| Z-API instance status | Redis | 30s | Webhook |
| Dashboard KPIs | Redis | 1 min | Worker de aggregation |
| Script template list | Redis | 1 hora | Save no admin |

**Estratégia anti-stampede:** SWR (stale-while-revalidate) em endpoints de dashboard. Retorna cache mesmo expirado e refresh em background.

## H.7 Real-time strategy

**Tecnologia:** Supabase Realtime (Postgres logical replication via WebSocket).

**Canais:**
```typescript
// Cliente subscribe
supabase
  .channel(`tenant:${tenantId}:leads`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenantId}` }, callback)
  .subscribe();

// Eventos a propagar pro client:
// - lead.created (status captured → notifica painel "novos leads")
// - lead.status_changed (movimentação no pipeline)
// - message.received (chega no chat ao vivo)
// - meeting.scheduled (notificação push + atualiza agenda)
// - conversation.escalated (toast + badge no sino)
```

**Fallback:** se WebSocket falha, painel faz polling a cada 30s (degradado).

## H.8 Feature flags per-tenant

**Ferramenta:** GrowthBook (open-source, self-hosted).

```typescript
// Define no GrowthBook
{
  "feature": "flow_builder",
  "rules": [
    { "condition": { "tenant.plan": "premium" }, "value": true },
    { "condition": { "tenant.id": "uuid-do-giovane" }, "value": false },
    { "default": false }
  ]
}

// Uso
const growthbook = new GrowthBook({ attributes: { tenant } });
if (growthbook.isOn('flow_builder')) {
  // mostra UI do flow builder
}
```

Casos de uso:
- Liberar adicionais pra tenants específicos
- Beta testing de features novas
- Rollout gradual

## H.9 Backups & Disaster Recovery

### H.9.1 Backup strategy
- **Postgres:** Supabase faz snapshot diário automático (retenção 7 dias no plano Pro · 30 dias no Team)
- **Snapshot manual:** antes de cada migration crítica
- **Backup adicional:** dump diário em R2 (cross-region) · retenção 90 dias
- **Redis:** sem backup (cache + queue · perda é aceitável; jobs em DLQ são re-tentáveis)

### H.9.2 DR targets
- **RPO (Recovery Point Objective):** ≤ 1 hora
- **RTO (Recovery Time Objective):** ≤ 4 horas

### H.9.3 Restore process
```
1. Identificar timestamp de restore (último snapshot íntegro)
2. Provisionar novo Postgres instance no Supabase
3. Restore do snapshot
4. Atualizar DATABASE_URL no Railway
5. Rolling restart dos services
6. Validar integridade (compare counts, hash de tabelas críticas)
7. Comunicar tenants se houve perda de dados
```

### H.9.4 Drill (simulação)
- Trimestral: time simula restore em ambiente isolado
- Documenta tempo real vs RTO
- Atualiza runbook

---

# ANEXO I · Observabilidade & Testes

## I.1 Métricas obrigatórias (Posthog + custom)

### I.1.1 Produto (por tenant)
- `leads_captured_per_day`
- `messages_sent_per_day`
- `messages_received_per_day`
- `response_rate_7d_rolling`
- `qualification_rate`
- `meetings_scheduled_per_week`
- `cost_per_meeting`
- `tenant_quality_rating` (WhatsApp)

### I.1.2 Sistema
- `api_request_duration_p50/p95/p99` (por endpoint)
- `worker_job_duration_p95` (por worker)
- `worker_job_failure_rate`
- `db_connection_pool_utilization`
- `redis_memory_usage`
- `external_api_latency_p95` (Z-API, OpenAI, Google)
- `external_api_error_rate`

### I.1.3 Negócio (Guilds)
- `mrr_total`
- `mrr_per_tenant`
- `tokens_consumed_total`
- `tokens_cost_total`
- `tenants_active_count`
- `tenants_at_risk` (Quality YELLOW ou inadimplência)
- `gross_margin_per_tenant`

## I.2 Alertas

| Alerta | Trigger | Severidade | Canal |
|---|---|---|---|
| API p95 > 2s por 5min | Métrica | Warning | Slack #alerts |
| API error rate > 5% por 5min | Métrica | Critical | Slack + PagerDuty |
| Worker job failure rate > 10% | Métrica | Warning | Slack |
| Z-API instance disconnected > 10min | Health check | Critical | Slack + email tenant |
| OpenAI 5xx > 5min consecutivos | Métrica | Critical | Slack |
| DB connection pool > 90% | Métrica | Warning | Slack |
| Tenant Quality Rating = RED | Webhook Z-API | Critical | Slack + email tenant |
| Tenant atingiu 90% da franquia IA | Métrica | Info | Email tenant |
| Tenant atingiu 100% da franquia IA | Métrica | Warning | Email tenant + admin |
| RLS violation detected | Sentry | Critical | Slack #security |

## I.3 Logging strategy

**Stack:** Pino (estruturado JSON) → stdout → Railway logs → BetterStack ingest.

**Padrão de log:**
```typescript
logger.info({
  event: 'message_sent',
  tenant_id: ...,
  conversation_id: ...,
  lead_id: ...,
  duration_ms: 234,
  trace_id: req.id
}, 'Sent message to lead');
```

**Nunca logar:**
- Conteúdo de mensagens (privacidade)
- Tokens de auth
- Secrets

**Sempre logar:**
- `tenant_id` em todo log
- `trace_id` pra correlacionar
- Tempo de execução de operações

## I.4 Estratégia de testes

### I.4.1 Pirâmide
- **70% unit tests** — funções puras, lógica de negócio (algoritmo de fit_score, state machine, guardrails)
- **25% integration tests** — workers, integrações com Z-API/OpenAI mockadas
- **5% E2E tests** — fluxos críticos completos (Playwright)

### I.4.2 Multi-tenant isolation tests (obrigatórios em CI)
```typescript
describe('Multi-tenant isolation', () => {
  beforeEach(async () => {
    await db.tenants.create({ id: 'tenant-a', ... });
    await db.tenants.create({ id: 'tenant-b', ... });
    // cria leads em cada tenant
  });

  test('user from tenant A não consegue ler leads de tenant B', async () => {
    const token = await loginAs('user@tenant-a.com');
    const response = await api.get('/v1/tenant/leads', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.data.every(l => l.tenant_id === 'tenant-a')).toBe(true);
  });

  test('user de tenant A não consegue acessar lead específico de tenant B via id direto', async () => {
    const leadB = await createLead({ tenant_id: 'tenant-b' });
    const token = await loginAs('user@tenant-a.com');
    const response = await api.get(`/v1/tenant/leads/${leadB.id}`, { ... });
    expect(response.status).toBe(404); // RLS faz parecer "não existe"
  });

  test('worker processando job de tenant A não toca em dados de tenant B', async () => {
    await worker.process({ tenant_id: 'tenant-a', ... });
    const tenantBLeads = await dbWithBypass.leads.findMany({ where: { tenant_id: 'tenant-b' } });
    expect(tenantBLeads.every(l => l.updated_at === l.created_at)).toBe(true);
  });
});
```

### I.4.3 Coverage targets
- **Domain logic:** ≥ 90%
- **API routes:** ≥ 80%
- **Workers:** ≥ 75%
- **UI components:** ≥ 60%
- **Total:** ≥ 75%

### I.4.4 Ferramentas
- Vitest (unit + integration)
- Playwright (E2E)
- Mock Service Worker (mock APIs externas)
- Testcontainers (Postgres + Redis em testes)

---

# ANEXO J · Segurança & Compliance LGPD

## J.1 Security checklist (todos itens obrigatórios pre-prod)

### J.1.1 Auth & Sessions
- [ ] JWT com RS256 (não HS256)
- [ ] Refresh tokens com rotação
- [ ] Magic links de uso único + TTL 10min
- [ ] Logout invalida JWT (revogação via Redis)
- [ ] Rate limit em `/auth/*`

### J.1.2 Input validation
- [ ] Zod ou TypeBox em todo endpoint (request validation)
- [ ] Sanitização de HTML em campos free-text
- [ ] Limite de tamanho em payloads (1MB padrão)
- [ ] CORS configurado restrito (somente app.prospix.com.br e admin.prospix.com.br)

### J.1.3 SQL Injection
- [ ] Prisma ORM (parameterized queries) em todos lugares
- [ ] Banimento de raw queries (lint rule)
- [ ] Exceção: queries com `set_config('app.tenant_id')` — code reviewed

### J.1.4 XSS / CSRF
- [ ] Content Security Policy (CSP) headers
- [ ] React `dangerouslySetInnerHTML` proibido (lint)
- [ ] SameSite=Strict em cookies
- [ ] Anti-CSRF tokens em forms (mesmo com JWT)

### J.1.5 Secrets management
- [ ] `tenant_secrets` encrypted at rest (AES-256-GCM)
- [ ] Encryption key em variável de ambiente (não no código)
- [ ] Rotação anual da encryption key
- [ ] `.env` em `.gitignore` (validar com pre-commit hook)
- [ ] Logs nunca contêm secrets

### J.1.6 Transport
- [ ] HTTPS obrigatório (HSTS)
- [ ] TLS 1.2+ apenas
- [ ] Certificados auto-renovados (Let's Encrypt via Railway)

### J.1.7 RLS audit
- [ ] Toda tabela de domínio com RLS ON
- [ ] Toda policy testada
- [ ] Anti-stamp: tentativa de query sem `app.tenant_id` set → 0 rows (não erro)
- [ ] Audit log em qualquer mudança de policy

### J.1.8 Dependências
- [ ] Dependabot ativo
- [ ] `pnpm audit` em CI
- [ ] Snyk scan semanal

## J.2 LGPD checklist

### J.2.1 Base legal
- [x] Documentado em DPIA (Data Protection Impact Assessment)
- Base: **legítimo interesse** (art. 7, IX) para abordagem comercial
- Base: **execução de contrato** (art. 7, V) para clientes ativos
- Base: **consentimento** (art. 7, I) para dados sensíveis (saúde · Fase 2)

### J.2.2 Direitos do titular (art. 18)
- [ ] **Confirmação:** lead pode pedir confirmação se tem dados → endpoint LGPD
- [ ] **Acesso:** export-data funcional
- [ ] **Correção:** endpoint pra corrigir dado
- [ ] **Anonimização/exclusão:** processo documentado
- [ ] **Portabilidade:** export em formato estruturado (JSON+CSV)
- [ ] **Revogação:** opt-out funcional em ≤ 1 minuto

### J.2.3 Encarregado (DPO)
- DPO Guilds: a definir
- Email: `dpo@guilds.com.br`
- Página pública: `guilds.com.br/lgpd`

### J.2.4 Termo de uso do tenant
Contrato deve obrigar tenant a:
- Não enviar mensagens fora do escopo aprovado
- Respeitar opt-outs
- Não usar dados de leads pra outros fins
- Comunicar incidentes em ≤ 24h

### J.2.5 Resposta a incidente LGPD
- Detecção
- Contenção (≤ 24h)
- Notificação à ANPD (≤ 72h se risco alto)
- Notificação aos titulares afetados
- Plano de remediação
- Documentação completa em audit log

## J.3 Acessibilidade (WCAG 2.1 AA)

Mínimo:
- Contraste de cor ≥ 4.5:1 (texto normal) e 3:1 (texto grande)
- Todos elementos interativos com `aria-label`
- Navegação por teclado funcional (Tab, Enter, Esc)
- Foco visível
- Imagens com `alt`
- Forms com `<label>` associado
- Tabelas com `<th scope>`
- Toasts/notificações com `aria-live="polite"`

Auditoria: axe-core em CI + manual com NVDA/VoiceOver antes de release maior.

---

# ANEXO K · UX & Edge Cases

## K.1 Empty states

| Tela | Estado vazio | Mensagem + CTA |
|---|---|---|
| Início (D1) | Nenhuma captura ainda | "Sua primeira campanha já está rodando 🚀 Os primeiros leads aparecem em ~1h." |
| Conversas | Nenhuma conversa ativa | "Quando alguém responder à sua IA, aparece aqui. Quer ver suas campanhas?" + botão |
| Pipeline | Sem leads em alguma coluna | Coluna vazia com texto claro: "Nenhum lead nesta etapa" |
| Agenda | Sem reuniões | "Sua agenda está livre. A IA está trabalhando pra agendar pra você." |
| Meus Leads | < 50 leads | "Sua base ainda está pequena. Crie mais campanhas pra acelerar." |
| Roteiros | Nenhum customizado | "Você está usando templates. Customize para sua linguagem MetLife." |

## K.2 Loading states

- **Skeleton screens** em listas (não spinners genéricos)
- **Optimistic UI** em ações: mover card no Kanban, marcar mensagem como lida
- **Progress bar** em export-data
- **Pulse** em status "ao vivo" (dot pulsando)

## K.3 Error states

| Cenário | UX |
|---|---|
| Sem internet | Toast persistente "Sem conexão · tentando reconectar..." + degrada para cache local |
| API 500 | Tela de erro com botão "Tentar novamente" + email pra suporte |
| Z-API offline | Banner no topo: "WhatsApp temporariamente indisponível. Mensagens em fila." |
| Quality Rating RED | Modal bloqueante: "Atenção · risco de banimento. Campanhas pausadas. Fale com a Guilds." |
| Tenant suspended | Tela única bloqueando acesso: "Plataforma suspensa por inadimplência. Regularize..." |

## K.4 Notificações push (PWA · Fase 2)

| Evento | Notificação |
|---|---|
| Lead pediu ligação | 🔥 Critical · "{{Nome}} pediu ligação agora" |
| Reunião confirmada | ✅ Info · "Reunião confirmada: {{Nome}} · {{horário}}" |
| Lembrete 1h antes | ⏰ "Reunião com {{Nome}} em 1h" |
| Nova mensagem fora do roteiro | 💬 "{{Nome}} disse algo que IA não soube responder" |
| Indicação recebida (Fase 2) | ⭐ "Você recebeu uma indicação de {{Nome}}" |
| Quality Rating caiu | ⚠️ Warning · "Atenção ao WhatsApp - cheque o painel" |

Permissions: pedir no primeiro login + lembrar 1× por semana se negar.

## K.5 i18n

**Decisão Fase 1:** apenas pt-BR. Estrutura preparada (chaves em arquivo `.json`) pra adicionar es/en futuramente sem refator.

```
src/i18n/
  pt-BR.json
  en.json    (placeholder, Fase 3)
  es.json    (placeholder, Fase 3)
```

## K.6 Onboarding do user dentro do tenant (primeira vez)

- **Modal de boas-vindas** explicando os 4 cards do Início (mantém o onboarding atual do protótipo)
- **Tour guiado** opcional após login: 5 passos mostrando Conversas, Pipeline, Agenda, Roteiros, Configurações
- **Checklist** persistente no canto: "Configure WhatsApp", "Conecte Calendar", "Aprove primeiros 3 roteiros" → marca conforme completa

---

# ANEXO L · Playbooks Operacionais

## L.1 Incidente: Z-API instance disconnected

**Detecção:** webhook `instance` com status `disconnected` OU health check falha por 10min.

**Resposta automática (sistema):**
1. Pausa todas campanhas do tenant
2. Mensagens em fila ficam pendentes (não dispara erro)
3. Alerta crítico no Slack #ops
4. Email automático pro tenant: "WhatsApp desconectado. Estamos verificando."

**Resposta humana (PM Guilds):**
1. Checa Z-API admin → motivo da disconnection
2. Se QR-code required: gera QR e envia pro tenant via canal alternativo
3. Se ban: ação crítica → ver playbook L.2
4. Se manutenção Z-API: aguarda + comunica
5. Após reconectado: rampa de re-aquecimento conservadora (volta a 50% do limite por 3 dias)

## L.2 Incidente: número WhatsApp banido

**Severidade:** CRÍTICA · perda do canal de comunicação do tenant

**Ações imediatas:**
1. Pausa todas campanhas (automático)
2. Notifica owner do tenant via email + telefone (PM Guilds liga)
3. Inicia processo de novo número:
   - Tenant compra novo chip
   - Configura no Z-API
   - Inicia novo aquecimento (D+1 do programa)
4. Análise post-mortem:
   - Roteiros problemáticos?
   - Volume excedido?
   - Mensagem reportada por leads?
5. Ajustes:
   - Adicionar guardrail novo se identificado padrão
   - Atualizar roteiro problemático
   - Reduzir cap de envio
6. Crédito comercial: Guilds dá 1 mês de MRR cortesia (cláusula contratual)

**Prevenção (rotina):**
- Monitor Quality Rating diário
- Se cai para YELLOW: alerta + reduz volume 50% por 7 dias
- Se cai para RED: pausa imediatamente

## L.3 Incidente: OpenAI fora ou degradado

**Detecção:** latência p95 > 10s ou error rate > 20% por 5min.

**Resposta automática:**
1. Fallback pra Claude Haiku (config-driven)
2. Alerta no Slack
3. Marca em status page

**Resposta humana:**
- Se Claude também falha: pausa novos disparos da IA, conversações ativas ficam pendentes
- Comunica tenants afetados via banner no painel

## L.4 Incidente: lead reclama na ANPD

**Severidade:** ALTA · risco regulatório

**Ações:**
1. PM Guilds recebe notificação ANPD
2. Acessa audit log do lead específico:
   - Quando foi capturado
   - De qual fonte
   - Quantas mensagens recebeu
   - Se houve opt-out e quando
3. Prepara resposta à ANPD (≤ 15 dias úteis):
   - Base legal usada (legítimo interesse documentado)
   - Comprovação de opt-out funcional
   - Exclusão dos dados se solicitada
4. Comunica tenant
5. Se padrão se repetir: revisa processos com jurídico

## L.5 Release process

### L.5.1 Frequência
- Bugfix: a qualquer momento (após CI verde)
- Feature: terças e quintas (janela 14-17h)
- Migration que afeta dados: quarta de manhã (mais tempo pra resolver problemas no mesmo dia útil)

### L.5.2 Checklist pre-release
- [ ] PR aprovado por 1+ reviewer
- [ ] CI verde (lint + tests + build)
- [ ] Migration testada em staging
- [ ] Release notes escritas
- [ ] Plano de rollback claro
- [ ] PM Guilds avisado se tem impacto user-facing

### L.5.3 Release notes (template)
```markdown
## Release vX.Y.Z · 2026-MM-DD

### Novidades
- ...

### Correções
- ...

### Mudanças técnicas
- ...

### Impacto no tenant
- (se houver) ações que tenant precisa fazer
```

Postar em #releases (Slack) e enviar email pra tenants se houver impacto.

### L.5.4 Rollback
- Rollback de código: Railway redeploy versão anterior (≤ 5min)
- Rollback de migration: rodar migration reversa (planejada antes)
- Comunicação: post no #releases descrevendo o problema e ETA do fix

## L.6 Versionamento de prompts

Sempre que prompt muda:
1. Salva nova versão em `prompt_versions` com `is_active=false`
2. Roda test cases automaticamente
3. Compara output novo vs anterior em 50 mensagens reais (offline)
4. Se passa: ativa em 1 tenant beta por 48h
5. Se métricas mantêm ou melhoram: ativa em todos
6. Métricas-chave: response_rate, qualification_rate, intent_classification_accuracy

---

# ANEXO M · Roadmap Detalhado Fase 2+

## M.1 Visão de produto · 12 meses

```
M1-2  · Fase 1 MVP (Giovane) · go-live
M3    · Tenant #2 (onboarding manual)
M4-5  · Fase 2 essencial: App Mobile + Flow Builder + Loop Indicações
M6    · Tenant #3-5 (replicação rápida)
M7-8  · Onboarding self-service + Billing automatizado
M9    · Multi-user dentro do tenant (assistants)
M10-11· White-label completo (upsell)
M12   · Marketplace de templates (se ≥ 20 tenants)
```

## M.2 Multi-user dentro do tenant (assistants)

**Modelo:**
- Owner convida assistant via email
- Assistant cria conta + magic link
- Assistant herda `tenant_id` mas com role `assistant`
- Permissões:
  - ✅ Ver todos leads + responder em conversas
  - ✅ Marcar resultado de reunião
  - ❌ Editar campanhas, roteiros, billing, integrações
  - ❌ Convidar outros users

**Audit log:** quem fez o quê (já estrutura existe).

## M.3 Billing automatizado

**Stack:** Stripe (preferência) ou Asaas (BR-friendly).

**Fluxo:**
1. Tenant cadastra cartão / boleto no onboarding
2. Stripe cria customer + subscription
3. Webhook `invoice.paid` → atualiza `tenant_billing.status = paid`
4. `invoice.payment_failed` → marca como `overdue` → email
5. Após 3 falhas (D+15): suspende tenant

**Excedentes:**
- Worker `usage-aggregation` calcula tokens excedentes
- Cria `invoice item` adicional no fim do mês
- Cobra junto com próxima fatura

## M.4 White-label completo (upsell R$ 4.900 + R$ 290/mês)

- Subdomínio próprio: `app.giovanemetlife.com.br`
- Logo + cores customizadas
- Sem mention da Guilds em qualquer tela
- Email de notificação from `@giovanemetlife.com.br`
- Domínio cadastrado e validado pelo tenant
- SSL automático via Cloudflare

**Engenharia:**
- Adicionar coluna `tenants.custom_domain`
- Middleware DNS resolution
- Build de tema branded gerado on-demand
- 1 dia útil de provisionamento

## M.5 Onboarding self-service

**Quando ativar:** após Guilds ter 5+ tenants ativos e processo comercial maduro.

**Fluxo:**
1. Lead chega na landing page `guilds.com.br/prospect`
2. Preenche formulário básico → cria trial 14 dias (sem cartão)
3. Wizard self-service (5 telas):
   - Dados do corretor
   - Conecta Z-API (instrucoes em vídeo)
   - Conecta Google Calendar
   - Escolhe 1 roteiro template
   - Lança 1ª campanha (50 leads · sample)
4. Após 14 dias: paga setup R$ 7.900 ou perde dados

## M.6 Marketplace de templates

**Condição:** ≥ 20 tenants ativos.

**Modelo:**
- Owners publicam roteiros que funcionaram bem
- Marketplace mostra: nome, segmento, métricas anonimizadas (taxa de resposta média)
- Outros tenants compram (R$ 50-200 / template)
- Receita: 50% Guilds, 50% creator
- Templates passam por revisão de qualidade Guilds antes de listar

---

**FIM DOS ANEXOS** · documento mantido em `docs/PRD.md` no repo · revisão a cada release maior.

---
---

# DOCUMENTOS COMPLEMENTARES (artefatos de engenharia)

Estes documentos acompanham o PRD e estão prontos pra colar no repositório:

| Documento | Arquivo | Vai pra |
|---|---|---|
| **Schema Prisma** completo (multi-tenant + RLS) | `Giovane_MetLife_Schema.prisma` | `apps/api/prisma/schema.prisma` |
| **OpenAPI / Swagger** (contrato REST completo) | `Giovane_MetLife_OpenAPI.yaml` | `docs/api/openapi.yaml` |
| **Plano de Desenvolvimento Paralelo** (5 frentes, milestones, ownership) | `Giovane_MetLife_Plano_Dev_Paralelo.md` | `docs/dev-plan.md` |

O **Plano de Desenvolvimento Paralelo** divide o trabalho em 5 frentes correlatas que não se bloqueiam (Foundation, Captura, IA+WhatsApp, Agendamento+Admin, Frontend), com contratos congelados na Semana 1, milestones semanais, pontos de sincronização e ownership de arquivos por dev. É o guia operacional do time durante os 35 dias úteis.
