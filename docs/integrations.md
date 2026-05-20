# Guia de APIs, Conexões e Credenciais · Prospix

> **Uso interno Guilds** · checklist técnico-operacional de todas as integrações externas.
> Para cada serviço: o que é, pra que serve, como criar conta, custo, scopes/permissões, como conectar, variáveis de ambiente, links da doc.
> Versão 1.0 · 18/05/2026

---

## 0. Resumo · quem contrata o quê

| Serviço | Categoria | Quem paga | Custo | Quando provisionar | Crítico? |
|---|---|---|---|---|---|
| **Supabase** | DB + Auth + Realtime + Vault | Guilds | ~US$ 25/mês (Pro) | Dia 1 | 🔴 Sim |
| **Railway** | Hosting API + workers | Guilds | ~US$ 20-50/mês | Dia 1 | 🔴 Sim |
| **Cloudflare R2** | Storage (assets, exports) | Guilds | ~US$ 5/mês | Semana 1 | 🟡 Médio |
| **OpenAI** | LLM (IA conversacional) | Guilds (franquia) | variável (~R$ 30-150/tenant/mês) | Dia 1 | 🔴 Sim |
| **Anthropic** | LLM fallback | Guilds | variável (baixo) | Semana 2 | 🟢 Opcional |
| **Z-API** | WhatsApp Business | Tenant (Giovane) | R$ 280/mês por instância | Semana 1-2 | 🔴 Sim |
| **Google Cloud · Maps** | Captura de leads | Tenant (Giovane) | ~US$ 0-200/mês (free tier US$200) | Semana 1-2 | 🔴 Sim |
| **Google Cloud · Calendar** | Agendamento | Tenant (Giovane) | grátis | Semana 1-2 | 🔴 Sim |
| **BrasilAPI / ReceitaWS** | Enriquecimento CNPJ | Guilds | grátis (rate-limited) | Semana 2 | 🟡 Médio |
| **Sentry** | Error tracking | Guilds | grátis (tier dev) | Semana 1 | 🟡 Médio |
| **BetterStack** | Uptime + logs | Guilds | grátis (tier dev) | Semana 1 | 🟡 Médio |
| **GrowthBook** | Feature flags | Guilds | self-hosted (grátis) | Semana 2 | 🟢 Opcional |
| **Resend** | Email transacional | Guilds | grátis (3k/mês) | Semana 2 | 🟡 Médio |
| **Upstash Redis** | Filas + cache + locks | Guilds | grátis (tier) → ~US$ 10/mês | Dia 1 | 🔴 Sim |
| **Twilio/Zenvia** | Telefonia (Fase 2) | Tenant | variável | Fase 2 | 🟢 Fase 2 |
| **Stripe / Asaas** | Billing (Fase 2) | Guilds | % por transação | Fase 2 | 🟢 Fase 2 |
| **GitHub** | Repo + CI/CD | Guilds | grátis/Team | Dia 1 | 🔴 Sim |

---

## 1. Supabase (DB + Auth + Realtime + Vault) 🔴

**O que é:** PostgreSQL gerenciado + Auth + Realtime (WebSocket) + Vault pra secrets. Coração da stack.

**Pra que usamos:**
- Banco principal (todas as tabelas do schema Prisma)
- Row Level Security (isolamento multi-tenant)
- Realtime (mensagens ao vivo no painel)
- Vault (criptografia de `tenant_secrets`)

**Como criar:**
1. Conta em https://supabase.com (login GitHub)
2. New Project → região **South America (São Paulo)** · `sa-east-1`
3. Plano **Pro** (US$ 25/mês · necessário pra backups + sem pause)
4. Anotar: `Project URL`, `anon key`, `service_role key`, `DATABASE_URL` (Settings → Database → Connection string · modo "session" pra Prisma)

**Variáveis de ambiente:**
```bash
DATABASE_URL=postgresql://postgres.[ref]:[pass]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
SHADOW_DATABASE_URL=postgresql://...      # outro DB pra migrations
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # backend only · NUNCA expor no client
```

**Setup específico do projeto:**
- Habilitar RLS em todas as tabelas de domínio (migration · ver Schema Prisma)
- Criar role `guilds_admin BYPASSRLS`
- Habilitar Realtime nas tabelas: `leads`, `conversations`, `messages`, `meetings`
- Configurar connection pooler (PgBouncer) modo Transaction pra workers

**Doc:** https://supabase.com/docs

---

## 2. Railway (Hosting API + Workers) 🔴

**O que é:** PaaS pra rodar a API Node.js e os workers (BullMQ).

**Pra que usamos:**
- Serviço `api` (Fastify · HTTP)
- Serviço `worker` (BullMQ consumers)
- Deploy via GitHub (push → build → deploy)

**Como criar:**
1. Conta em https://railway.app (login GitHub)
2. New Project → Deploy from GitHub repo
3. Criar 3 serviços: `api`, `worker`, (`web` e `admin` podem ir pra Vercel/Cloudflare Pages)
4. Configurar variáveis de ambiente (todas do `.env`)
5. Configurar healthcheck path `/health`

**Variáveis:**
```bash
# Railway injeta automaticamente:
RAILWAY_ENVIRONMENT=production
PORT=3000   # Railway define
```

**Custo:** ~US$ 20-50/mês (usage-based · escala com tráfego)

**Alternativa:** Render.com (similar) ou Fly.io.

**Doc:** https://docs.railway.app

---

## 3. Cloudflare R2 (Storage) 🟡

**O que é:** object storage S3-compatível, sem custo de egress.

**Pra que usamos:**
- Materiais MetLife (PDFs institucionais)
- Exports LGPD (ZIPs temporários)
- Gravações de ligação (Fase 2)
- Avatares / assets de branding

**Como criar:**
1. Conta Cloudflare → R2
2. Create bucket `prospix`
3. Gerar API token (R2 → Manage R2 API Tokens)
4. Paths prefixados por tenant: `tenant_{id}/...`

**Variáveis:**
```bash
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=prospix
R2_PUBLIC_URL=https://pub-[hash].r2.dev   # ou domínio custom
```

**Custo:** ~US$ 5/mês (10GB grátis + zero egress)

**Doc:** https://developers.cloudflare.com/r2

---

## 4. OpenAI (LLM principal) 🔴

**O que é:** API do GPT-4o-mini (modelo principal da IA conversacional).

**Pra que usamos:**
- Gerar respostas da IA nas conversas
- Classificar intenção
- Gerar voice_profile a partir do discovery

**Como criar:**
1. Conta em https://platform.openai.com
2. Billing → adicionar cartão + créditos iniciais (US$ 50)
3. Criar API key (Project → API Keys) · uma key por ambiente
4. Configurar usage limits (hard limit US$ 200/mês pra segurança)

**Variáveis:**
```bash
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_DEFAULT=gpt-4o-mini-2024-07-18
OPENAI_MODEL_CLASSIFIER=gpt-4o-mini-2024-07-18
OPENAI_ORG_ID=org-...   # opcional
```

**Custo:** GPT-4o-mini = US$ 0.15/1M input + US$ 0.60/1M output. ~R$ 0,01 por conversa. Franquia de 14M tokens/mês inclusa no MRR do tenant.

**Multi-tenant:** chave compartilhada Guilds por padrão · tenant pode plugar a própria (`tenant_secrets.openai_api_key_encrypted`).

**Doc:** https://platform.openai.com/docs

---

## 5. Anthropic (LLM fallback) 🟢

**O que é:** Claude Haiku 3.5 — fallback se OpenAI cai ou degrada.

**Como criar:**
1. Conta em https://console.anthropic.com
2. Billing + API key

**Variáveis:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_FALLBACK=claude-3-5-haiku-20241022
```

**Custo:** Haiku = US$ 0.80/1M input + US$ 4/1M output. Só usado em fallback.

**Doc:** https://docs.anthropic.com

---

## 6. Z-API (WhatsApp Business) 🔴 · TENANT contrata

**O que é:** gateway não-oficial de WhatsApp que gerencia instância, aquecimento, anti-ban.

**Pra que usamos:**
- Enviar mensagens da IA
- Receber mensagens dos leads (webhook)
- Validar se número tem WhatsApp (`check-phone`)
- Monitorar Quality Rating + status da instância

**Como criar (cada tenant tem a SUA):**
1. Conta em https://www.z-api.io
2. Criar instância (plano R$ 280/mês · profissional)
3. Conectar número via QR code (número dedicado · chip novo recomendado)
4. Configurar webhooks apontando pra nossa API:
   - On message received → `https://api.prospix.com.br/v1/webhooks/zapi/inbound`
   - On message status → `https://api.prospix.com.br/v1/webhooks/zapi/status`
   - On instance status → `https://api.prospix.com.br/v1/webhooks/zapi/instance`
5. Gerar webhook secret (pra HMAC validation)

**Variáveis (armazenadas em `tenant_secrets`, não no .env global):**
```
zapi_instance_id
zapi_token (encrypted)
zapi_webhook_secret (encrypted)
```

**Endpoints principais:**
- `POST /instances/{id}/token/{token}/send-text`
- `POST /instances/{id}/token/{token}/phone-exists/{phone}` (check-phone)
- `GET /instances/{id}/token/{token}/status`

**⚠️ Anti-ban (crítico):**
- Aquecimento gradual obrigatório (ver Anexo D.2 do PRD)
- Monitorar Quality Rating · se cair pra RED → pausar

**Custo:** R$ 280/mês por instância (tenant paga).

**Doc:** https://developer.z-api.io

---

## 7. Google Cloud · Maps Places API 🔴 · TENANT contrata

**O que é:** API oficial pra buscar estabelecimentos (médicos, escritórios, etc).

**Pra que usamos:**
- Capturar leads por especialidade + cidade
- Obter nome, telefone, endereço, avaliações

**Como criar:**
1. Conta Google Cloud Console (do Giovane) https://console.cloud.google.com
2. Criar projeto `giovane-prospect`
3. Ativar billing (cartão · free tier US$ 200/mês)
4. Habilitar APIs:
   - **Places API (New)**
   - **Geocoding API** (opcional, pra normalizar endereços)
5. Criar API Key · restringir por:
   - API (só Places + Geocoding)
   - IP (servidores Railway)

**Variáveis (em `tenant_secrets`):**
```
google_maps_api_key (encrypted)
```

**Endpoints:**
- Text Search: `POST https://places.googleapis.com/v1/places:searchText`
- Place Details: `GET https://places.googleapis.com/v1/places/{place_id}`

**Custo:** Text Search US$ 32/1k · Place Details US$ 17/1k. Free tier US$ 200/mês cobre ~5.000 captures. Tenant paga excedente.

**Doc:** https://developers.google.com/maps/documentation/places/web-service

---

## 8. Google Cloud · Calendar API 🔴 · TENANT autoriza

**O que é:** API oficial pra ler disponibilidade e criar eventos na agenda do Giovane.

**Pra que usamos:**
- Verificar horários livres
- Criar reuniões agendadas pela IA
- Receber notificação de mudanças (watch/push)

**Como criar:**
1. Mesmo projeto Google Cloud
2. Habilitar **Google Calendar API**
3. Configurar OAuth Consent Screen (External · scopes: `calendar.events`)
4. Criar OAuth 2.0 Client ID (Web application)
5. Authorized redirect URI: `https://api.prospix.com.br/v1/tenant/integrations/google/callback`
6. Giovane autoriza via fluxo OAuth → guardamos refresh token

**Variáveis (global + per-tenant):**
```bash
# Global (.env)
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://api.prospix.com.br/v1/tenant/integrations/google/callback

# Per-tenant (tenant_secrets)
google_calendar_id
google_oauth_refresh_encrypted
```

**Scopes necessários:**
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.readonly` (disponibilidade)

**Custo:** grátis.

**Doc:** https://developers.google.com/calendar/api

---

## 9. BrasilAPI / ReceitaWS (CNPJ) 🟡

**O que é:** API pública de dados de CNPJ (Receita Federal).

**Pra que usamos:**
- Enriquecer leads de empresários (CNAE, sócios, idade do CNPJ)
- Identificar dono ativo

**Como usar:**
- BrasilAPI: `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` (grátis, rate-limit ~3 req/s)
- Fallback ReceitaWS: `GET https://receitaws.com.br/v1/cnpj/{cnpj}` (grátis tier · 3 req/min · ou pago)

**Variáveis:**
```bash
RECEITAWS_API_KEY=...   # opcional, plano pago pra mais throughput
```

**⚠️ Não traz telefone** — só endereço, sócios, CNAE. Cruzar com Google Maps pra contato.

**Doc:** https://brasilapi.com.br/docs

---

## 10. Upstash Redis (Filas + Cache + Locks) 🔴

**O que é:** Redis serverless. Backbone das filas BullMQ, cache e locks distribuídos.

**Como criar:**
1. Conta em https://upstash.com (login GitHub)
2. Create Redis database · região São Paulo
3. Copiar connection string

**Variáveis:**
```bash
REDIS_URL=rediss://default:[pass]@[endpoint].upstash.io:6379
```

**Custo:** free tier (10k commands/dia) → ~US$ 10/mês conforme escala.

**Doc:** https://upstash.com/docs/redis

---

## 11. Sentry (Error tracking) 🟡

**Como criar:**
1. https://sentry.io · projeto Node.js + projeto React
2. Copiar DSN

**Variáveis:**
```bash
SENTRY_DSN=https://...@sentry.io/...
SENTRY_DSN_FRONTEND=https://...
```

**Setup:** tag `tenant_id` em todo evento (pra filtrar por cliente).

**Custo:** grátis (5k errors/mês).

---

## 12. BetterStack (Uptime + Logs) 🟡

**Como criar:**
1. https://betterstack.com
2. Uptime monitor → `/health` e `/ready`
3. Logs → ingest do stdout do Railway

**Variáveis:**
```bash
BETTERSTACK_SOURCE_TOKEN=...
```

**Custo:** grátis (tier dev).

---

## 13. GrowthBook (Feature flags) 🟢

**O que é:** feature flags self-hosted (liga features per-tenant).

**Como criar:**
1. Self-host (Docker) ou cloud free tier
2. Definir flags (ex: `flow_builder`, `mobile_app`, `referral_loop`)

**Variáveis:**
```bash
GROWTHBOOK_API_HOST=https://...
GROWTHBOOK_CLIENT_KEY=...
```

**Custo:** grátis (self-hosted).

**Doc:** https://docs.growthbook.io

---

## 14. Resend (Email transacional) 🟡

**O que é:** envio de email (magic link fallback, notificações, exports LGPD).

**Como criar:**
1. https://resend.com
2. Verificar domínio `guilds.com.br` (DNS records)
3. API key

**Variáveis:**
```bash
RESEND_API_KEY=re_...
EMAIL_FROM="Guilds <no-reply@guilds.com.br>"
```

**Custo:** grátis (3k emails/mês).

**Doc:** https://resend.com/docs

---

## 15. GitHub (Repo + CI/CD) 🔴

**Setup:**
1. Repo privado `Gustavogm9/prospix`
2. Branch protection em `main` e `staging` (require PR + 1 review)
3. GitHub Actions secrets:
   ```
   RAILWAY_TOKEN
   DATABASE_URL (staging)
   SUPABASE_SERVICE_ROLE_KEY
   (todos os secrets de deploy)
   ```
4. Dependabot + secret scanning ativos

**Custo:** grátis (privado) ou Team (US$ 4/user/mês).

---

## 16. Twilio / Zenvia (Telefonia · Fase 2) 🟢

**O que é:** telefonia pra botão "Ligar" (adicional 3.6).

**Quando:** Fase 2, só se o adicional for contratado.

**Variáveis (tenant_secrets):**
```
twilio_account_sid (encrypted)
twilio_auth_token (encrypted)
```

**Doc:** https://www.twilio.com/docs/voice

---

## 17. Stripe / Asaas (Billing · Fase 2) 🟢

**O que é:** cobrança recorrente automatizada (adicional 7.13).

**Quando:** Fase 2. Asaas é mais BR-friendly (boleto + PIX + cartão).

**Variáveis:**
```bash
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
# ou
ASAAS_API_KEY=...
```

**Doc:** https://docs.stripe.com · https://docs.asaas.com

---

## 18. Ordem de provisionamento (sequência prática)

### Dia 1 (Dev 1 · Foundation)
1. ✅ GitHub repo + org + branch protection
2. ✅ Supabase project (São Paulo)
3. ✅ Upstash Redis
4. ✅ Railway (3 serviços)
5. ✅ OpenAI (key + billing)

### Semana 1 (Guilds)
6. ✅ Cloudflare R2
7. ✅ Sentry + BetterStack
8. ✅ Resend (verificar domínio)
9. ✅ Anthropic (fallback)

### Semana 1-2 (Giovane · com apoio Guilds)
10. ✅ Google Cloud project + billing
11. ✅ Habilitar Places API + Calendar API
12. ✅ OAuth consent + client ID
13. ✅ Z-API instância + número WhatsApp + chip
14. ✅ Conectar Z-API via QR + configurar webhooks
15. ✅ Giovane autoriza OAuth Google (Calendar)

### Semana 2 (Dev 2/4)
16. ✅ BrasilAPI (sem cadastro · testar rate limit)
17. ✅ GrowthBook (self-host)

### Fase 2 (quando contratado)
- Twilio/Zenvia · Stripe/Asaas

---

## 19. `.env.example` consolidado (referência rápida)

```bash
# === App ===
NODE_ENV=development
PORT=3000
APP_URL=https://app.prospix.com.br
ADMIN_URL=https://admin.prospix.com.br
API_URL=https://api.prospix.com.br

# === Supabase / DB ===
DATABASE_URL=postgresql://...
SHADOW_DATABASE_URL=postgresql://...
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# === Redis ===
REDIS_URL=rediss://...

# === Auth ===
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=30d
MAGIC_LINK_TTL_SECONDS=600

# === Storage ===
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=prospix
R2_PUBLIC_URL=https://...

# === IA ===
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_DEFAULT=gpt-4o-mini-2024-07-18
OPENAI_MODEL_CLASSIFIER=gpt-4o-mini-2024-07-18
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_FALLBACK=claude-3-5-haiku-20241022

# === Google OAuth (global) ===
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://api.prospix.com.br/v1/tenant/integrations/google/callback

# === Z-API (instância Guilds pra magic links) ===
ZAPI_GUILDS_INSTANCE=...
ZAPI_GUILDS_TOKEN=...
ZAPI_BASE_URL=https://api.z-api.io

# === Secrets vault ===
SECRETS_ENCRYPTION_KEY=<32-byte base64>

# === Observabilidade ===
SENTRY_DSN=https://...
BETTERSTACK_SOURCE_TOKEN=...

# === Feature flags ===
GROWTHBOOK_API_HOST=https://...
GROWTHBOOK_CLIENT_KEY=...

# === Email ===
RESEND_API_KEY=re_...
EMAIL_FROM="Guilds <no-reply@guilds.com.br>"

# === BrasilAPI (opcional) ===
RECEITAWS_API_KEY=...

# === Limites ===
MAX_LEADS_PER_TENANT=50000
MAX_CAMPAIGNS_PER_TENANT=20
WARMUP_DAY_1_LIMIT=5
WARMUP_REGIME_LIMIT=200
LEAD_ARCHIVE_AFTER_DAYS=180
TENANT_CHURNED_RETENTION_DAYS=90
```

---

## 20. Matriz de criticidade (se cair, o que acontece)

| Serviço | Se cair | Plano B |
|---|---|---|
| Supabase | Sistema fora | Backup R2 + restore (RTO 4h) |
| Railway | API fora | Redeploy / failover region |
| OpenAI | IA não responde | Fallback Anthropic automático |
| Z-API | Não envia/recebe WhatsApp | Mensagens em fila · alerta · aguarda |
| Google Maps | Captura para | Cache + pausa captura · não afeta conversas em andamento |
| Google Calendar | Não agenda | IA escala pra humano marcar manual |
| Redis | Filas param | Jobs persistem · reprocessam ao voltar |
| Sentry/BetterStack | Sem observabilidade | Não afeta operação · logs no Railway |

---

**FIM** · este guia vive em `docs/integrations.md` no repo · atualizar quando adicionar serviço novo.
