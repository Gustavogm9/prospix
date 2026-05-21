# Plano de Desenvolvimento Paralelo · Prospix

> **Anexo operacional do PRD** · uso interno Guilds · time de engenharia.
> Objetivo: dividir o desenvolvimento em **frentes correlatas que não se bloqueiam**, permitindo que **agentes IA dedicados** trabalhem em paralelo desde a semana 1.
>
> Versão 1.1 · 21/05/2026 · revisada para modelo de execução com agentes IA (Codex, Gemini, Claude) coordenados por PM.

---

## 0. Modelo de execução · agentes IA

Cada **Frente** é um spec autocontido em [`docs/agents/frente-*.md`](agents/) que um agente IA executa contra contratos rigorosos. Ver [docs/agents/README.md](agents/README.md) para o modelo de trabalho.

| Papel | Quem | Responsabilidade |
|---|---|---|
| **PM** | Gustavo Macedo | Aprova schemas, prompts, deploys, decide priorização |
| **Auditor Oficial** | Codex | Gate bloqueante de evidência, segurança, testes críticos e go-live |
| **Revisor independente** | Claude | Revisa PRs, mantém contratos, escreve specs novos e desafia achados altos/críticos |
| **Agente A · Foundation** | Codex ou Claude Code | Executa [frente-a-foundation.md](agents/frente-a-foundation.md) |
| **Agente B · Captura** | Codex | Executa [frente-b-captura.md](agents/frente-b-captura.md) |
| **Agente C · IA + WhatsApp** | Codex ou Claude | Executa [frente-c-ia-whatsapp.md](agents/frente-c-ia-whatsapp.md) |
| **Agente D · Calendar + Admin** | Gemini | Executa [frente-d-calendar-admin.md](agents/frente-d-calendar-admin.md) |
| **Agente E · Frontend painel + admin** | Codex ou Gemini | Executa [frente-e-frontend.md](agents/frente-e-frontend.md) |
| **Agente F · Landing + Auth** | Codex ou Gemini | Executa [frente-f-landing-auth.md](agents/frente-f-landing-auth.md) |

Auditoria oficial: [`docs/auditoria/`](auditoria/).

---

## 1. Composição do time

**6 frentes paralelas executadas por agentes IA**, coordenadas por Gustavo (PM) + Claude (coordenador). A divisão de trabalho é por **ownership de pastas** + **contratos** — agentes não pisam no código uns dos outros.

> **Por que 6 frentes (e não 5):** a Frente F (Landing + Auth + Cadastro com código) foi adicionada após a decisão de pre-cadastro gated por invitation code. Mantém o paralelismo sem alongar prazo.

> **Diferenças do modelo com agentes IA:**
> - **Specs viram prompts** — sem ambiguidade, com critérios de aceite verificáveis por teste
> - **CI verde é a verdade** — auto-avaliação de agente é otimista; só passa se lint + typecheck + tests + multi-tenant tests passarem
> - **Mocks/seed são fonte do contexto** — agente não improvisa dados, consome de [packages/mocks](../packages/mocks/)
> - **PR review por Claude** — revisor independente valida diff vs spec quando aplicável
> - **Gate por Codex** — auditor oficial bloqueia merge/release se evidência, segurança ou testes críticos não fecham

---

## 1.1 Gate de auditoria oficial

O Codex tem autoridade para bloquear merge em `staging`, merge em `main`, homologação ampla ou go-live quando houver achado P0/P1 sem mitigação.

Bloqueios automáticos:

- RLS, auth, session, admin bypass, secrets, billing ou opt-out sem evidência suficiente.
- CI, lint, typecheck ou teste obrigatório sem status claro.
- Teste multi-tenant não executado quando a mudança toca dados, tenant context ou Prisma.
- Exposição de segredo, token, payload sensível ou PII em log, erro, fixture ou documentação.
- Divergência entre OpenAPI/shared-types e implementação.
- Mudança em prompts de IA em produção sem test cases.

Achados e critérios ficam em [`docs/auditoria/matriz-achados.md`](auditoria/matriz-achados.md).

## 2. Princípio de paralelização · contratos primeiro

A regra que faz as frentes não se prejudicarem:

> **Na Semana 1, antes de qualquer feature, o time congela os CONTRATOS: tipos TypeScript compartilhados, schema do banco e specs de API/webhook. Cada dev programa contra o contrato + mocks — não contra a implementação real dos outros.**

Três artefatos de contrato (entregues pela Frente A na Semana 1):

1. **`packages/shared-types`** — todos os tipos TS (Lead, Conversation, Message, Meeting, Campaign, Script, etc) derivados do Prisma schema
2. **OpenAPI YAML** — contrato de toda a API REST (já existe · `Giovane_MetLife_OpenAPI.yaml`)
3. **`packages/mocks`** — mocks de cada integração externa (Evolution API, Google Maps, Calendar, OpenAI) + seed data de 2 tenants fictícios

Com isso:
- **Agente E (Frontend)** programa contra o OpenAPI com MSW (Mock Service Worker) → não espera o backend
- **Agente B (Captura)** programa contra mock do Google Maps → não espera credencial real
- **Agente C (IA)** programa contra mock do Evolution API → não espera número WhatsApp aquecido
- **Agente D (Calendar)** programa contra mock do Google Calendar

Integração real entra na fase de **GENERATE** (semanas 4-6) quando credenciais já foram coletadas no OBSERVE.

---

## 3. Mapa de dependências

```
                    ┌──────────────────────────────────┐
                    │  FRENTE A · Foundation (Agente A) │
                    │  Schema · RLS · Auth · Workers   │
                    │  shared-types · mocks · CI/CD    │
                    └───────────────┬──────────────────┘
                                    │ (desbloqueia todos via contratos · S1)
        ┌───────────┬───────────┬───┴───────┬───────────┬───────────┐
        ▼           ▼           ▼           ▼           ▼           ▼
┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ FRENTE B   │ │ FRENTE C │ │ FRENTE D │ │ FRENTE E │ │ FRENTE F │
│ Captura    │ │ IA+      │ │ Calendar │ │ Painel   │ │ Landing+ │
│ (Agente B) │ │ WhatsApp │ │ +Usage   │ │ +Admin   │ │ Auth+    │
│            │ │ (Ag. C)  │ │ (Ag. D)  │ │ (Ag. E)  │ │ Cadastro │
│            │ │          │ │          │ │          │ │ (Ag. F)  │
└─────┬──────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
      │ leads       │ conv/msg   │ meeting    │ consome    │ chama
      └───────►─────┴─────►──────┴───────►────┘ via API    │ /auth/* +
            (acoplamento via DB + eventos)                 │ /invitations
                                                           └──► API
```

**Acoplamento mínimo:** as frentes se comunicam por **dados no banco** (escrevem em `leads`, `conversations`, etc) e **eventos na fila** (BullMQ), não por imports diretos de código uma da outra. Cada frente expõe sua interface via `packages/shared-types`.

---

## 4. Frentes em detalhe

### 🟦 FRENTE A · Foundation & Plataforma (Agente A · Lead Engineer)

**Missão:** construir a base que desbloqueia todos. É a frente mais crítica nas semanas 1-2.

**Escopo / entregáveis:**
- Setup monorepo (pnpm workspaces · apps/api, apps/web, apps/admin, packages/*)
- Prisma schema + migrations + **RLS policies** (já existe schema · `Giovane_MetLife_Schema.prisma`)
- `packages/shared-types` (gerado do Prisma)
- `packages/mocks` (Evolution API, Google Maps, Calendar, OpenAI mocks + seed 2 tenants)
- **Auth completo:** magic link, JWT RS256, refresh, sessão, revogação
- **Middleware de tenant-context** (injeta `app.tenant_id` no PG · core da multi-tenancy)
- **Base worker class** (`_base-worker.ts` · injeta tenant_id, retry, DLQ, locks)
- Infra de filas (BullMQ + Redis · namespacing por tenant)
- Idempotency middleware + tabela
- CI/CD (GitHub Actions · lint, test, build, deploy)
- docker-compose local + seed
- Healthcheck endpoints
- `tenant_secrets` vault (criptografia AES-256)
- **Super-admin: onboarding wizard backend** (criar tenant + secrets) — compartilhado com Frente D

**Limites (NÃO toca):**
- Lógica de captura (Frente B)
- Lógica de IA/conversa (Frente C)
- UI (Frente E)
- Integração real com Google Calendar (Frente D)

**Contratos que entrega (Semana 1 · destrava o resto):**
- `shared-types` publicado
- Migrations rodáveis localmente
- Mocks funcionais
- Auth endpoint funcional (mesmo que com tenant seed)

**Milestones:**
| Semana | Entrega |
|---|---|
| S1 | Monorepo + schema + migrations + RLS + shared-types + mocks → **destrava todos** |
| S2 | Auth completo + tenant middleware + base worker + idempotency |
| S3 | CI/CD + vault de secrets + onboarding wizard backend |
| S4-S6 | Suporte às outras frentes + revisão de RLS + testes de isolamento |
| S7 | Hardening de segurança + deploy produção + DR drill |

**Definition of Done:**
- Testes de isolamento multi-tenant passando em CI
- Migration roda em staging sem erro
- Auth flow E2E verde
- Outro dev consegue subir o projeto local em < 15 min seguindo o README

---

### 🟩 FRENTE B · Captura & Enriquecimento (Agente B · Backend)

**Missão:** encher o funil. Transformar Google Maps + Receita Federal em leads qualificados com fit score.

**Escopo / entregáveis:**
- Integração Google Maps Places API (`integrations/google-maps.ts`)
- Integração BrasilAPI/Receita Federal (`integrations/brasilapi.ts`)
- `worker:capture-google-maps` (cron 1h)
- `worker:enrich-leads` (cron 15min · valida WhatsApp via Evolution API check-phone)
- **Algoritmo de Fit Score** (Anexo D.1 do PRD · fórmula com pesos)
- Dedup logic (UNIQUE tenant_id + whatsapp)
- CRUD de Campaigns (API `/tenant/campaigns/*`)
- Endpoint `/tenant/leads` (list/get/create/patch) — escreve em `leads`
- Filtros + paginação cursor-based de leads

**Limites (NÃO toca):**
- Não dispara mensagens (só marca lead como `enriched` · Frente C pega daí)
- Não toca em conversations/messages
- Não faz UI
- Evolution API só usa endpoint `check-phone` (validação) · envio é da Frente C

**Contratos / pontos de contato:**
- **Consome:** `leads` schema, base worker class, mock Google Maps (da Frente A)
- **Entrega para Frente C:** leads em status `enriched` (Frente C consome via query, não import)
- **Entrega para Frente E:** endpoints `/tenant/leads` e `/tenant/campaigns` documentados no OpenAPI

**Milestones:**
| Semana | Entrega |
|---|---|
| S2 | Campaigns CRUD + endpoint leads (contra mock) |
| S3 | Fit Score algorithm + testes unitários (90% coverage) |
| S4 | `worker:capture-google-maps` com mock → produz leads fake realistas |
| S5 | Integração REAL Google Maps + Receita (credencial coletada no OBSERVE) |
| S6 | `worker:enrich-leads` com validação WhatsApp real + tuning fit score |
| S7 | Captura 100+ leads válidos/dia em produção (critério de aceite 6.2) |

**Definition of Done:**
- Captura 100+ leads válidos no primeiro dia (critério PRD 6.2)
- ≥ 90% leads enriquecidos com WhatsApp validado
- Zero duplicatas
- Fit score com testes cobrindo todos os componentes da fórmula

---

### 🟧 FRENTE C · Motor de IA & WhatsApp (Agente C · Backend+IA + Eng. IA part-time)

**Missão:** o cérebro. Fazer a IA conversar como o Giovane e o WhatsApp não banir.

**Escopo / entregáveis:**
- Integração Evolution API send (`integrations/evolution.ts`)
- Integração OpenAI/Anthropic (`integrations/openai.ts` · com fallback)
- **Script engine** (`ai/script-engine.ts` · executa flow JSON via state machine)
- **Prompt builder** (`ai/prompt-builder.ts` · mescla voice_profile + script + histórico)
- **Classificador de intenção** (`ai/classifier.ts` · 12 categorias + fallback rule-based)
- **Guardrails** (`ai/guardrails.ts` · 6 validações pre-send · Anexo E.2)
- `worker:send-messages` (com `canSendMessage()` + aquecimento · Anexo D.2)
- `worker:process-inbound` (webhook Evolution API → IA → resposta · com lock por conversation)
- `worker:health-check` (Quality Rating monitor)
- `worker:followup` (cadência D+3/D+7/D+14)
- Webhook handlers Evolution API (inbound, status, instance)
- **Programa de aquecimento** WhatsApp (cronograma diário)
- Opt-out detection + LGPD
- Scripts CRUD + clone de templates + variations + A/B
- Versionamento de prompts + test cases CI

**Limites (NÃO toca):**
- Não captura leads (consome leads `enriched` da Frente B)
- Não agenda reunião diretamente (chama tool → Frente D processa o `schedule-meeting`)
- Não faz UI dos roteiros (só a API · UI é Frente E)
- Não toca em billing

**Contratos / pontos de contato:**
- **Consome:** leads `enriched` (Frente B), base worker (Frente A), mock Evolution API + OpenAI (Frente A)
- **Entrega para Frente D:** evento/tool-call `schedule_meeting` na fila (Frente D consome)
- **Entrega para Frente E:** endpoints `/tenant/conversations`, `/tenant/scripts` + eventos real-time de mensagem
- **Escreve em:** `conversations`, `messages`, `optouts`, atualiza `leads.status`

**Milestones:**
| Semana | Entrega |
|---|---|
| S2-S3 | Script engine + prompt builder + guardrails (contra mock OpenAI) |
| S3 | Classificador de intenção + test cases CI |
| S4 | `worker:process-inbound` + `send-messages` com mock Evolution API → conversa fake fim-a-fim |
| S5 | Integração REAL Evolution API + OpenAI · primeiras conversas em homologação |
| S5-S6 | Aquecimento iniciado + calibração de roteiros com Giovane (discovery output) |
| S6 | Follow-up + opt-out + health-check |
| S7 | 50 contatos reais com ≥95% de acerto da IA (critério 6.3) |

**Definition of Done:**
- IA responde corretamente ≥ 95% em testes (50 contatos)
- Zero alucinação de valores (guardrails passam 100%)
- Opt-out efetivo ≤ 1min
- Aquecimento respeitado · Quality Rating verde

---

### 🟪 FRENTE D · Agendamento, Usage & Super-Admin (Agente D · Backend)

**Missão:** fechar o loop (agendamento) + dar visibilidade (usage/billing) + ferramenta Guilds (admin).

**Escopo / entregáveis:**
- Integração Google Calendar (`integrations/google-calendar.ts` · OAuth + events)
- `worker:schedule-meeting` (consome tool-call da Frente C)
- Disponibilidade real-time + buffers + lembretes
- Meetings CRUD + outcome pós-reunião (API `/tenant/meetings/*`)
- Webhook Google Calendar (push notifications)
- **Usage tracking** (`tenant/usage-tracker.ts` · agrega tokens/msgs/captures)
- `worker:usage-aggregation` (cron horário + alertas 70/90/100%)
- `worker:daily-digest` (resumo WhatsApp 8h)
- **Super-Admin API** (`/admin/*` · tenants, usage consolidado, templates)
- Dashboard endpoints (`/tenant/dashboard/*`)
- Billing models (Fase 1: manual · estrutura pronta pra Stripe Fase 2)

**Limites (NÃO toca):**
- Não dispara mensagens (Frente C)
- Não captura (Frente B)
- Não faz UI (Frente E · mas entrega os endpoints que a UI consome)

**Contratos / pontos de contato:**
- **Consome:** tool-call `schedule_meeting` da Frente C (via fila), base worker (Frente A)
- **Entrega para Frente E:** endpoints `/tenant/meetings`, `/tenant/dashboard/*`, `/admin/*`
- **Escreve em:** `meetings`, `tenant_usage`, `tenant_billing`, `notifications`

**Milestones:**
| Semana | Entrega |
|---|---|
| S2-S3 | Meetings CRUD + dashboard endpoints (contra mock + seed) |
| S3 | Usage tracking + aggregation worker |
| S4 | `worker:schedule-meeting` com mock Calendar |
| S5 | Integração REAL Google Calendar (credencial do OBSERVE) |
| S6 | daily-digest + super-admin API (lista tenants, onboarding wizard) |
| S7 | Agendamento real fim-a-fim + dashboard de custos batendo com billing |

**Definition of Done:**
- 100% das reuniões aceitas criam evento no Calendar (critério 6.4)
- Buffers de 15min respeitados
- Usage bate com custo real ±5%
- Criar Tenant #2 via admin leva ≤ 10min

---

### 🟨 FRENTE E · Painel Tenant & Super-Admin Web (Agente E · Frontend)

**Missão:** a interface que o Giovane opera. Já tem protótipo aprovado como referência visual.

**Escopo / entregáveis:**
- Setup React 18 + Vite + Tailwind + shadcn/ui
- `lib/api-client.ts` (sempre envia X-Tenant-Id)
- Auth flow (magic link UI + callback + sessão)
- **Páginas do painel tenant** (alinhadas com protótipo aprovado):
  - Início (4 cards + funil + leads quentes)
  - Conversas (lista + filtros + drawer 4 abas)
  - Pipeline Kanban (drag-and-drop)
  - Agenda (calendário semanal)
  - Meus Leads (filtros por especialidade)
  - Roteiros (editor + flow builder)
  - Configurações (integrações + perfil + notificações)
- Real-time (Supabase Realtime · nova mensagem sem refresh)
- Modais (nova campanha, editar roteiro, resultado reunião, API key)
- **Super-Admin UI** (`apps/admin` · lista tenants, onboarding wizard, usage dashboard)
- Onboarding/tour do usuário
- Empty states, loading skeletons, error states (Anexo K)
- Acessibilidade WCAG AA

**Limites (NÃO toca):**
- Nenhum backend (consome 100% via API REST + WebSocket)
- Não implementa lógica de negócio (só apresentação + chamadas)

**Contratos / pontos de contato:**
- **Consome:** OpenAPI (toda a API) + Supabase Realtime channels (Frentes B/C/D)
- **Trabalha desacoplado:** MSW (Mock Service Worker) mocka todas as respostas API na semana 1-4
- **Protótipo HTML aprovado** é a referência de UX (`giovane_metlife_prototipo.html`)

**Milestones:**
| Semana | Entrega |
|---|---|
| S1 | Setup + design system + api-client + MSW mocks |
| S2 | Auth UI + shell (sidebar, topbar) + Início (contra mock) |
| S3 | Conversas + drawer + Pipeline Kanban |
| S4 | Agenda + Leads + Configurações |
| S5 | Roteiros + Flow Builder + integração com API real (substitui MSW) |
| S6 | Super-Admin UI + real-time + polish |
| S7 | Empty/error states + acessibilidade + responsivo + testes E2E Playwright |

**Definition of Done:**
- Tudo navegável (zero placeholder)
- Drag-and-drop Kanban funcional
- Real-time funcionando
- Lighthouse ≥ 90 (performance + a11y)
- E2E Playwright dos fluxos críticos verdes

---

## 5. Sequenciamento por semana (visão consolidada)

| Semana | Frente A | Frente B | Frente C | Frente D | Frente E | Frente F | Auditoria Codex |
|---|---|---|---|---|---|---|---|
| **S1** FOUNDRY | 🔑 Schema+RLS+types+mocks | aguarda contratos / estuda fontes | aguarda contratos / desenha flows | aguarda contratos / estuda Calendar API | Setup + design system + MSW | Landing/auth base | Normalização + inventário |
| **S2** OBSERVE | Auth + middleware + workers base | Campaigns + leads API (mock) | Script engine + prompt builder | Meetings + dashboard API (mock) | Auth UI + shell + Início | Cadastro com convite | Gates críticos P0 |
| **S3** REFINE | CI/CD + vault + onboard backend | Fit Score + testes | Classifier + guardrails + CI | Usage tracking + aggregation | Conversas + drawer + Kanban | Termos/LGPD | Contratos + matriz |
| **S4** GENERATE A | suporte + RLS review | capture worker (mock) | process-inbound (mock) | schedule-meeting (mock) | Agenda + Leads + Config | SEO/legal | Auditoria por frente |
| **S5** GENERATE B | suporte | 🔌 Google Maps REAL | 🔌 Evolution API + OpenAI REAL | 🔌 Calendar REAL | Roteiros + integração API real | Landing prod | Integrações reais |
| **S6** GENERATE C | testes isolamento | enrich + tuning | aquecimento + calibração | digest + super-admin | Super-Admin UI + real-time | Auth polish | Pre-go-live |
| **S7** EMPOWER | hardening + deploy prod | 100 leads/dia prod | 50 contatos ≥95% | agendamento E2E | polish + a11y + E2E | Conteúdo final | Relatório final |

**🔑 = entrega crítica que destrava · 🔌 = integração real (depende de credenciais do OBSERVE)**

---

## 6. Pontos de sincronização obrigatórios

| Quando | Cerimônia | Objetivo |
|---|---|---|
| Diário (15min) | Daily standup | Bloqueios, dependências do dia |
| Diário (assíncrono) | Triagem de auditoria | Revisar novos P0/P1 e evidências pendentes |
| S1 fim | **Contract freeze** | Aprovar shared-types + OpenAPI + mocks · ponto sem volta |
| S3 fim | **Integration checkpoint** | Cada frente demonstra rodando contra mock |
| S4 fim | **Credentials gate** | Confirmar que Evolution API, Google Cloud, etc estão coletados (OBSERVE) |
| S5 meio | **Real integration sync** | Todas as frentes trocam mock por real ao mesmo tempo |
| S6 fim | **Pre-go-live review** | Critérios de aceite por frente + auditoria P0/P1 |
| S7 | **Go-live** | Deploy coordenado + smoke tests + decisão formal Codex |

**Regra de mudança de contrato:** depois do S1 freeze, qualquer mudança em shared-types/OpenAPI exige aviso no canal + aprovação do Lead (Agente A). Mudança breaking → reunião de 15min com afetados.

---

## 7. Limites globais (o que ninguém faz sozinho)

| Decisão | Quem aprova |
|---|---|
| Mudança no schema do banco | Agente A (Lead) · PR review obrigatório |
| Mudança em RLS policies | Agente A + 1 revisor · crítico de segurança |
| Mudança em contrato de API (OpenAPI) | Agente A + frente afetada |
| Nova dependência npm | Qualquer dev · mas roda `pnpm audit` no PR |
| Novo serviço de infra (custo) | Gustavo (PM) |
| Mudança em prompt da IA em prod | Eng. IA + test cases verdes |
| Deploy em produção | Agente A ou Gustavo · após CI verde e gate Codex |
| Aceitação de risco P0/P1 | Gustavo, com registro na matriz e revisão Claude para Alta/Crítica |

---

## 8. Riscos de paralelização & mitigação

| Risco | Mitigação |
|---|---|
| Frente A atrasa e trava todos | Agente A foca 100% em contratos na S1 · nada mais. Se atrasar, é o único bloqueio crítico — priorizar |
| Mocks divergem da API real | Mocks gerados do mesmo OpenAPI · contract testing valida real vs mock |
| Conflito de merge em arquivos compartilhados | shared-types e schema só Agente A edita · outros pedem via PR |
| Credenciais externas atrasam (Giovane) | Coletadas no OBSERVE (S2-S3) · frentes usam mock até S5 · folga de 2 semanas |
| Integração real quebra na S5 | Cada frente tem 1 semana de buffer (S6) antes do go-live |
| Frente C (IA) é a mais arriscada | Eng. IA part-time dá reforço · calibração começa cedo (S5) com discovery da S1 |
| Dev sai do projeto | shared-types + OpenAPI + PRD documentam tudo · onboarding de novo dev < 1 dia |
| Agente declara "pronto" sem evidência | Codex bloqueia pelo gate oficial em `docs/auditoria/` |

---

## 9. Definição de pronto global (go-live)

Checklist consolidado para o D+35:

- [ ] **Frente A:** testes de isolamento multi-tenant verdes · deploy prod estável
- [ ] **Frente B:** captura 100+ leads/dia em prod · fit score calibrado
- [ ] **Frente C:** IA ≥95% acerto · aquecimento OK · Quality verde · opt-out funcional
- [ ] **Frente D:** agendamento E2E real · dashboard de custos batendo
- [ ] **Frente E:** painel completo navegável · real-time · a11y · E2E verde
- [ ] **Integração:** fluxo completo capturar→conversar→agendar funciona em prod
- [ ] **Giovane:** treinado (2h) · consegue operar sozinho
- [ ] **Segurança:** checklist Anexo J completo
- [ ] **Observabilidade:** alertas configurados · dashboards no ar
- [ ] **Docs:** runbook + onboarding-novo-tenant escritos
- [ ] **Auditoria:** sem P0 aberto; P1 resolvido ou aceito formalmente por Gustavo + revisado por Claude quando severidade Alta/Crítica

---

## 10. Estrutura de branches por frente

```
main
├── staging
├── feat/foundation-*      → Agente A (Frente A)
├── feat/capture-*         → Agente B (Frente B)
├── feat/ai-whatsapp-*     → Agente C (Frente C)
├── feat/calendar-admin-*  → Agente D (Frente D)
├── feat/web-*             → Agente E (Frente E)
└── feat/landing-auth-*    → Agente F (Frente F)
```

- Cada frente trabalha em branches `feat/<area>-<feature>`
- PR pra `staging` (deploy automático staging)
- Code review obrigatório (1 aprovação · 2 se tocar schema/RLS)
- Merge `staging → main` semanal (sexta) após validação
- Pastas de "ownership" no monorepo evitam conflito:
  - Agente A: `packages/*`, `apps/api/src/middlewares`, `prisma/`
  - Agente B: `apps/api/src/integrations/google-maps.ts`, `brasilapi.ts`, `workers/capture*`, `enrich*`, `routes/tenant/leads,campaigns`
  - Agente C: `apps/api/src/ai/*`, `integrations/evolution.ts`, `openai.ts`, `workers/process-inbound`, `send-messages`, `routes/tenant/conversations,scripts`
  - Agente D: `apps/api/src/integrations/google-calendar.ts`, `workers/schedule*`, `usage*`, `routes/tenant/meetings,dashboard`, `routes/admin/*`
  - Agente E: `apps/web/*`, `apps/admin/*`
  - Agente F: `apps/landing/*`, `apps/web/src/pages/auth/*`, fluxos públicos de auth/cadastro com convite

---

**FIM** · este plano é revisado no fim de cada semana no checkpoint. Ownership de arquivos é guia, não muralha — comunicação no daily resolve sobreposições.
