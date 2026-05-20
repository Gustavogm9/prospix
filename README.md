# Prospix

> Plataforma multi-tenant de prospecção inteligente via WhatsApp com IA.
> Captura, qualifica e agenda reuniões automaticamente — o vendedor só aparece nas reuniões já filtradas.

**Status:** documentação inicial (pré-desenvolvimento) · primeiro cliente: Giovane Carrara (MetLife · SJRP)
**Por:** Guilds · agência digital

---

## O que é

O Prospix substitui o modelo manual de "ligar 100 para falar com 10" por uma máquina autônoma:

1. **Captura** prospects (médicos, advogados, dentistas, empresários) via Google Maps + Receita Federal
2. **Conversa** por WhatsApp com IA treinada na linguagem do corretor (anti-ban, opt-out LGPD)
3. **Agenda** reuniões direto no Google Calendar quando o lead topa
4. O corretor só aparece nas reuniões qualificadas

Multi-tenant desde o Day 1 — a mesma estrutura é revendida para vários corretores.

---

## Stack

- **Frontend:** React 18 + Vite + Tailwind + shadcn/ui
- **Backend:** Node.js 20 + Fastify + Prisma
- **Banco:** PostgreSQL 16 (Supabase) com Row Level Security (isolamento multi-tenant)
- **Filas:** BullMQ + Redis (Upstash)
- **IA:** GPT-4o-mini (fallback Claude Haiku)
- **Integrações:** Z-API (WhatsApp), Google Maps Places, Google Calendar, BrasilAPI
- **Infra:** Railway + Cloudflare R2

---

## Documentação

| Documento | Descrição |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | PRD técnico completo + 13 anexos (arquitetura, algoritmos, prompts, segurança, playbooks) |
| [`docs/dev-plan.md`](docs/dev-plan.md) | Plano de desenvolvimento paralelo · 5 frentes, milestones, ownership |
| [`docs/discovery.md`](docs/discovery.md) | Roteiro da sessão de discovery (extração da linguagem do corretor) |
| [`docs/integrations.md`](docs/integrations.md) | Guia de APIs, credenciais e conexões externas |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | Contrato OpenAPI/Swagger da API REST |
| [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) | Schema do banco (multi-tenant + RLS) |
| [`business/`](business/) | Material comercial (proposta, protótipo, orçamento) |

---

## Estrutura planejada (monorepo)

```
prospix/
├── apps/
│   ├── api/      # Node.js + Fastify (multi-tenant)
│   ├── web/      # Painel do tenant (React)
│   └── admin/    # Super-admin Guilds (React)
├── packages/
│   ├── shared-types/
│   ├── ui/
│   └── tenant-sdk/
├── docs/
└── business/
```

---

## Como começar (quando o desenvolvimento iniciar)

Ver [`docs/dev-plan.md`](docs/dev-plan.md) seção "Setup inicial" e [`docs/integrations.md`](docs/integrations.md) para provisionamento de contas.

```bash
pnpm install
cp .env.example .env.local
docker-compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

---

*Guilds · sistemas, automação, IA e marketing — Brasil & Canadá*
