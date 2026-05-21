# Frente E · Painel Tenant + Super-Admin (Web)

## Objetivo

Implementar painel React do tenant (que o corretor opera) + painel super-admin Guilds. **Respeitar 100% o protótipo aprovado** ([business/prototipo.html](../../business/prototipo.html)).

## Contexto mínimo

- Design system: [docs/design-system.md](../design-system.md)
- Tokens CSS: [packages/ui/src/tokens.css](../../packages/ui/src/tokens.css)
- Protótipo HTML aprovado: [business/prototipo.html](../../business/prototipo.html) (referência visual)
- OpenAPI: [docs/api/openapi.yaml](../api/openapi.yaml)
- Tipos: `@prospix/shared-types`
- Componentes: `@prospix/ui`
- Realtime: Supabase Realtime via `@supabase/supabase-js`

## Stack

- **Apps:** Vite 6 + React 18 + TypeScript + Tailwind CSS + shadcn/ui customizado
- **Estado servidor:** TanStack Query v5
- **Estado cliente:** Zustand (mínimo)
- **Forms:** React Hook Form + Zod
- **Roteamento:** React Router v7
- **Mocks dev:** MSW com handlers de `@prospix/mocks`
- **Testes:** Vitest + Playwright

## Limites (NÃO TOCAR)

- Backend (`apps/api/*`)
- Schema (`apps/api/prisma/*`)
- Mocks (`packages/mocks/*` — só consome)
- Landing + auth (Frente F)

## Tarefas

### E1 · Setup do projeto web + admin

**Arquivos:**
- `apps/web/vite.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`
- Mesma estrutura para `apps/admin/`

**Critério de aceite:**
- [ ] `pnpm --filter @prospix/web dev` sobe em :5173
- [ ] `pnpm --filter @prospix/admin dev` sobe em :5174
- [ ] Tailwind importa preset de `@prospix/ui` + `tokens.css`
- [ ] MSW intercepta chamadas em dev (usa handlers de `@prospix/mocks`)

### E2 · API client

**Arquivo:** `apps/web/src/lib/api-client.ts`

**Implementação:**
- Interceptor envia `Authorization: Bearer ${token}` e `X-Tenant-Id` em toda request
- Interceptor refresh token quando 401
- TanStack Query helpers tipados pelos tipos do OpenAPI

**Critério de aceite:**
- [ ] Mudança no JWT/tenant_id reflete em todas as requests automaticamente
- [ ] Erros estruturados (ErrorResponse) tratados

### E3 · Catálogo de componentes em `@prospix/ui`

**Arquivos:**
- `packages/ui/src/components/{button,card,badge,input,select,checkbox,switch,modal,drawer,toast,sidebar,topbar,tabs,table,dropdown,popover,tooltip,avatar,skeleton}.tsx`
- `packages/ui/src/components/kanban/*.tsx`
- `packages/ui/src/components/chart/*.tsx` (wrappers Chart.js)

**Spec:** [docs/design-system.md seção 6](../design-system.md) — cada componente espelha o protótipo HTML.

**Critério de aceite:**
- [ ] Visual idêntico ao protótipo
- [ ] Variants conforme tabela de botões (primary, secondary, ghost, outline, danger)
- [ ] Acessível: keyboard nav, ARIA, focus visible
- [ ] Stories/exemplos em test (não exige Storybook)

### E4 · Layout shell (sidebar + topbar)

**Arquivos:**
- `apps/web/src/layout/AppShell.tsx`
- `apps/web/src/layout/Sidebar.tsx`
- `apps/web/src/layout/Topbar.tsx`

**Critério de aceite:**
- [ ] Sidebar 236px com items: Início / Conversas / Pipeline / Agenda / Leads / Roteiros / Config
- [ ] Counter ao lado de cada item (mono font)
- [ ] Topbar 60px com search, notifications dropdown, perfil
- [ ] Mobile (≥ 768px): sidebar colapsa em drawer

### E5 · Página Início

**Arquivo:** `apps/web/src/pages/Home.tsx`

**Conteúdo:** 4 cards (meetings_today, conversations_ready, need_callback, new_leads_today) + funnel chart + lista de leads quentes + próxima reunião.

**Critério de aceite:**
- [ ] Consome `/v1/tenant/dashboard/today` + `/funnel`
- [ ] Realtime: novo lead/mensagem atualiza sem refresh
- [ ] Skeleton enquanto carrega

### E6 · Página Conversas

**Arquivo:** `apps/web/src/pages/Conversations.tsx` + `ConversationDrawer.tsx`

**Critério de aceite:**
- [ ] Lista filtrável (Todas / Quentes / Aguardando / Agendadas)
- [ ] Drawer 4 abas: Conversa / Ficha / Saúde (placeholder Fase 2) / Histórico
- [ ] Botão "Assumir conversa" pausa IA
- [ ] Botão "Marcar resultado" abre modal pós-reunião
- [ ] Nova mensagem chega em tempo real (Supabase Realtime channel `tenant:{id}:conversations:{convId}`)

### E7 · Pipeline Kanban (drag-and-drop)

**Arquivo:** `apps/web/src/pages/Pipeline.tsx`

**Lib:** `@dnd-kit/core` + `@dnd-kit/sortable`.

**Critério de aceite:**
- [ ] 6 colunas (Capturado → Fechado)
- [ ] Cards arrastáveis entre colunas → PATCH status do lead
- [ ] Optimistic UI (move local antes da confirmação)
- [ ] Rollback visual se PATCH falhar

### E8 · Página Agenda

**Arquivo:** `apps/web/src/pages/Schedule.tsx`

**Critério de aceite:**
- [ ] Visualização semanal com slots de 30min
- [ ] Click no evento abre detalhes
- [ ] Diferenciação visual: agendada / confirmada / aconteceu / cancelada

### E9 · Página Leads

**Arquivo:** `apps/web/src/pages/Leads.tsx`

**Critério de aceite:**
- [ ] Tabela virtualizada (TanStack Table) — suporta 50k rows
- [ ] Filtros: especialidade, status, fit_score, campaign
- [ ] Search com debounce (300ms)
- [ ] Click → drawer com mesma 4 abas da Conversa

### E10 · Página Roteiros

**Arquivo:** `apps/web/src/pages/Scripts.tsx`

**MVP (Fase 1):**
- Lista de roteiros do tenant
- Editor de texto da mensagem base + 3 variations
- "Testar" simula resposta da IA (botão chama `/scripts/:id/test`)

**Fase 2:** Flow Builder visual (DnD entre nodes) — fora deste MVP.

### E11 · Página Configurações

**Arquivos:**
- `apps/web/src/pages/Settings/index.tsx`
- `Profile.tsx`, `Integrations.tsx`, `Notifications.tsx`, `Billing.tsx`

**Integrations:**
- Conectar Evolution (status connected/disconnected + reconnect)
- OAuth Google (botão "Conectar Calendar")
- Plugar chave OpenAI/Anthropic/Google própria (campo encrypted)

**Billing:**
- Plano atual + uso vs franquia
- Histórico de cobranças Asaas
- Boleto/PIX em aberto com botão "Copiar código"

### E12 · Super-admin app (`apps/admin`)

**Páginas:**
- Tenants (lista + filtros + health visual)
- Novo Tenant (wizard 6 passos PRD G.2 + gera código de convite)
- Templates (CRUD da master library)
- Uso & custos (gráficos por tenant + consolidado)
- Suporte/notas (tenant notes)

**Critério de aceite:**
- [ ] Wizard cria tenant + gera invitation code + mostra pra copiar
- [ ] Lista de tenants com health real-time (Quality Rating + uptime)
- [ ] Dashboard mostra margem (custo IA vs MRR)

### E13 · Onboarding interno do owner (primeiro login)

**Arquivo:** `apps/web/src/onboarding/*.tsx`

**Critério de aceite:**
- [ ] Modal boas-vindas explicando os 4 cards do Início
- [ ] Checklist persistente: "Conectar WhatsApp" → "Conectar Calendar" → "Aprovar 3 roteiros"
- [ ] Tour opcional (5 passos com tooltips)

### E14 · Empty/loading/error states

Aplicar PRD anexo K em todas as páginas.

### E15 · Acessibilidade

- [ ] axe-core no CI (`pnpm test:a11y`)
- [ ] Navegação por teclado em todos os fluxos
- [ ] Contraste AA validado

## Comandos de validação

```bash
pnpm --filter @prospix/web dev
pnpm --filter @prospix/web test
pnpm --filter @prospix/web test:e2e
pnpm --filter @prospix/admin dev
pnpm --filter @prospix/admin test
```

## Definition of Done

- [ ] Tudo navegável (zero placeholder)
- [ ] Drag-and-drop Kanban funcional
- [ ] Real-time funcionando (mensagem nova sem refresh)
- [ ] Lighthouse ≥ 90 (performance + a11y)
- [ ] E2E Playwright dos fluxos críticos verdes
- [ ] Visual idêntico ao protótipo aprovado

## Changelog

- v1.0 (21/05/2026): spec inicial.
