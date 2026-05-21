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
- **Integrações:** Evolution API ou WAHA (WhatsApp · self-hosted), Google Maps Places, Google Calendar, BrasilAPI
- **Auth:** magic link via WhatsApp + JWT RS256 (custom · não Supabase Auth)
- **Infra:** Railway + Cloudflare R2

---

## Documentação

| Documento | Descrição |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | PRD técnico completo + 13 anexos (arquitetura, algoritmos, prompts, segurança, playbooks) |
| [`docs/dev-plan.md`](docs/dev-plan.md) | Plano de desenvolvimento paralelo · 5 frentes, milestones, ownership |
| [`docs/discovery.md`](docs/discovery.md) | Roteiro da sessão de discovery (extração da linguagem do corretor) |
| [`docs/integrations.md`](docs/integrations.md) | Guia de APIs, credenciais e conexões externas |
| [`docs/design-system.md`](docs/design-system.md) | Tokens, componentes, voz · extraído do protótipo aprovado |
| [`docs/agents/`](docs/agents/) | Modelo de trabalho com agentes IA + specs por frente |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | Contrato OpenAPI/Swagger da API REST |
| [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) | Schema do banco (multi-tenant + RLS) |
| [`business/`](business/) | Material comercial (proposta, protótipo, orçamento) |

---

## Estrutura do monorepo

```
prospix/
├── apps/
│   ├── api/         # Node.js + Fastify (multi-tenant)
│   ├── web/         # Painel do tenant (React + Vite)
│   ├── admin/       # Super-admin Guilds (React + Vite)
│   └── landing/     # Marketing público prospix.com.br (Next.js)
├── packages/
│   ├── shared-types/   # Tipos TS gerados do Prisma + OpenAPI
│   ├── ui/             # Design system shadcn/ui customizado
│   └── mocks/          # Mocks de Evolution, OpenAI, Maps, Calendar, Asaas
├── docs/
│   ├── PRD.md
│   ├── dev-plan.md
│   ├── design-system.md
│   ├── integrations.md
│   ├── discovery.md
│   ├── agents/         # Specs operacionais por frente (IAs)
│   └── api/openapi.yaml
└── business/           # Material comercial (proposta, protótipo, orçamento)
```

---

## Como começar

Ver [`docs/dev-plan.md`](docs/dev-plan.md) e [`docs/integrations.md`](docs/integrations.md) para provisionamento de contas.

```bash
# Pré-requisitos: Node 20+, pnpm 9+, Docker
cp .env.example .env.local        # preencher com creds dev
pnpm install
docker-compose up -d              # postgres + redis + mailhog
pnpm --filter @prospix/api db:migrate:dev
pnpm --filter @prospix/api db:seed
pnpm dev                          # api + web + admin + landing em paralelo
```

URLs locais:
- API: `http://localhost:3000`
- Painel tenant: `http://localhost:5173`
- Super-admin: `http://localhost:5174`
- Landing: `http://localhost:3001`
- Mailhog (email dev): `http://localhost:8025`

## Modelo de trabalho

Desenvolvimento executado por **agentes IA** (Codex, Gemini, Claude) coordenados por PM (Gustavo · Guilds) + revisor (Claude). Cada frente tem spec autocontido em [`docs/agents/`](docs/agents/).

Ver [`docs/agents/README.md`](docs/agents/README.md) para o modelo completo.

---

*Guilds · sistemas, automação, IA e marketing — Brasil & Canadá*
