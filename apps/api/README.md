# @prospix/api

Backend Fastify multi-tenant da plataforma Prospix.

**Spec operacional:** [docs/agents/frente-a-foundation.md](../../docs/agents/frente-a-foundation.md) (Frente A).

## Stack

- Fastify 5 + Prisma 5 + BullMQ + Zod + Pino
- Postgres 16 (Supabase em prod) com RLS
- Redis (Upstash em prod)
- AI: OpenAI · Anthropic · Google AI (provider configurável por tenant)
- WhatsApp: Evolution API (self-hosted Hostinger)

## Setup

```bash
cp ../../.env.example .env.local
pnpm install
pnpm db:generate
pnpm db:migrate:dev
pnpm db:seed
pnpm dev
```

API sobe em `http://localhost:3000`.

## Scripts importantes

| Script | O que faz |
|---|---|
| `pnpm dev` | API + watch |
| `pnpm worker` | Workers BullMQ |
| `pnpm db:migrate:dev` | Prisma migrate + aplica `prisma/sql/01_rls.sql` |
| `pnpm test:multi-tenant` | **Obrigatório CI** — valida isolamento RLS |

## Estrutura

```
src/
├── index.ts              # bootstrap Fastify
├── config/env.ts         # schema Zod das env vars
├── lib/                  # singletons (prisma, redis, logger)
├── middlewares/          # auth, tenant-context, idempotency
├── routes/
│   ├── auth/
│   ├── tenant/           # /v1/tenant/* (RLS-isolated)
│   ├── admin/            # /v1/admin/* (BYPASSRLS)
│   └── webhooks/
├── workers/
│   ├── _base-worker.ts   # injeta tenant_id no início do job
│   ├── capture-google-maps.ts
│   ├── enrich-leads.ts
│   ├── process-inbound.ts
│   ├── send-messages.ts
│   └── ...
├── integrations/
│   ├── google-maps.ts
│   ├── brasilapi.ts
│   ├── evolution.ts
│   ├── google-calendar.ts
│   ├── asaas.ts
│   ├── openai.ts
│   ├── anthropic.ts
│   └── google-ai.ts
├── ai/
│   ├── router.ts         # provider abstraction
│   ├── prompt-builder.ts
│   ├── classifier.ts
│   ├── guardrails.ts
│   └── script-engine.ts
├── tenant/
│   ├── secrets-vault.ts
│   ├── tenant-service.ts
│   ├── usage-tracker.ts
│   └── invitation-service.ts
└── domain/
    └── fit-score.ts

prisma/
├── schema.prisma
├── sql/
│   └── 01_rls.sql        # policies aplicadas pós-migrate
└── seed.ts
```
