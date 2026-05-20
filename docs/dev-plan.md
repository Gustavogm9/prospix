# Plano de Desenvolvimento Paralelo · Prospix

> **Anexo operacional do PRD** · uso interno Guilds · time de engenharia.
> Objetivo: dividir o desenvolvimento em **frentes correlatas que não se bloqueiam**, permitindo que vários devs trabalhem em paralelo desde a semana 1.
> Versão 1.0 · 18/05/2026

---

## 1. Composição do time recomendada

**5 pessoas** (4 full-time + 1 eng. IA part-time/compartilhado):

| # | Papel | Dedicação | Frente |
|---|---|---|---|
| **Dev 1** | Lead Engineer | Full-time | Frente A · Foundation & Plataforma |
| **Dev 2** | Backend Engineer | Full-time | Frente B · Captura & Enriquecimento |
| **Dev 3** | Backend + IA | Full-time | Frente C · Motor de IA & WhatsApp |
| **Dev 4** | Backend Engineer | Full-time | Frente D · Agendamento, Usage & Admin |
| **Dev 5** | Frontend Engineer | Full-time | Frente E · Painel Tenant & Super-Admin |
| (Eng. IA) | Especialista IA | Part-time (~30%) | Apoia Frente C · prompts, calibração, guardrails |
| (PM/Gustavo) | Product/Lead | Part-time | Coordenação, discovery, validação cliente |

**Por que 5:** com menos de 4 devs, as frentes serializam e o prazo de 35 dias úteis não fecha. Com mais de 6, o overhead de coordenação supera o ganho. 5 é o ponto ótimo pra este escopo.

> **Variação enxuta (3 devs):** Frente A+D no Lead, Frente B+C num backend sênior, Frente E no frontend. Aumenta o prazo pra ~50 dias úteis. Não recomendado pra o compromisso de go-live D+35.

---

## 2. Princípio de paralelização · contratos primeiro

A regra que faz as frentes não se prejudicarem:

> **Na Semana 1, antes de qualquer feature, o time congela os CONTRATOS: tipos TypeScript compartilhados, schema do banco e specs de API/webhook. Cada dev programa contra o contrato + mocks — não contra a implementação real dos outros.**

Três artefatos de contrato (entregues pela Frente A na Semana 1):

1. **`packages/shared-types`** — todos os tipos TS (Lead, Conversation, Message, Meeting, Campaign, Script, etc) derivados do Prisma schema
2. **OpenAPI YAML** — contrato de toda a API REST (já existe · `Giovane_MetLife_OpenAPI.yaml`)
3. **`packages/mocks`** — mocks de cada integração externa (Z-API, Google Maps, Calendar, OpenAI) + seed data de 2 tenants fictícios

Com isso:
- **Dev 5 (Frontend)** programa contra o OpenAPI com MSW (Mock Service Worker) → não espera o backend
- **Dev 2 (Captura)** programa contra mock do Google Maps → não espera credencial real
- **Dev 3 (IA)** programa contra mock do Z-API → não espera número WhatsApp aquecido
- **Dev 4 (Calendar)** programa contra mock do Google Calendar

Integração real entra na fase de **GENERATE** (semanas 4-6) quando credenciais já foram coletadas no OBSERVE.

---

## 3. Mapa de dependências

```
                    ┌─────────────────────────────────┐
                    │  FRENTE A · Foundation (Dev 1)   │
                    │  Schema · RLS · Auth · Workers   │
                    │  shared-types · mocks · CI/CD    │
                    └───────────────┬─────────────────┘
                                    │ (desbloqueia todos via contratos · S1)
        ┌───────────────┬───────────┼───────────┬───────────────┐
        ▼               ▼           ▼           ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ FRENTE B     │ │ FRENTE C     │ │ FRENTE D │ │ FRENTE E     │
│ Captura      │ │ IA+WhatsApp  │ │ Calendar │ │ Frontend     │
│ (Dev 2)      │ │ (Dev 3)      │ │ +Usage   │ │ (Dev 5)      │
│              │ │              │ │ +Admin   │ │              │
│              │ │              │ │ (Dev 4)  │ │              │
└──────┬───────┘ └──────┬───────┘ └────┬─────┘ └──────┬───────┘
       │ leads          │ conv/msg     │ meeting      │ consome
       └───────►────────┴──────►───────┴───────►──────┘ tudo via API
              (acoplamento via DB + eventos, não código)
```

**Acoplamento mínimo:** as frentes se comunicam por **dados no banco** (escrevem em `leads`, `conversations`, etc) e **eventos na fila** (BullMQ), não por imports diretos de código uma da outra. Cada frente expõe sua interface via `packages/shared-types`.

---

## 4. Frentes em detalhe

### 🟦 FRENTE A · Foundation & Plataforma (Dev 1 · Lead Engineer)

**Missão:** construir a base que desbloqueia todos. É a frente mais crítica nas semanas 1-2.

**Escopo / entregáveis:**
- Setup monorepo (pnpm workspaces · apps/api, apps/web, apps/admin, packages/*)
- Prisma schema + migrations + **RLS policies** (já existe schema · `Giovane_MetLife_Schema.prisma`)
- `packages/shared-types` (gerado do Prisma)
- `packages/mocks` (Z-API, Google Maps, Calendar, OpenAI mocks + seed 2 tenants)
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

### 🟩 FRENTE B · Captura & Enriquecimento (Dev 2 · Backend)

**Missão:** encher o funil. Transformar Google Maps + Receita Federal em leads qualificados com fit score.

**Escopo / entregáveis:**
- Integração Google Maps Places API (`integrations/google-maps.ts`)
- Integração BrasilAPI/Receita Federal (`integrations/brasilapi.ts`)
- `worker:capture-google-maps` (cron 1h)
- `worker:enrich-leads` (cron 15min · valida WhatsApp via Z-API check-phone)
- **Algoritmo de Fit Score** (Anexo D.1 do PRD · fórmula com pesos)
- Dedup logic (UNIQUE tenant_id + whatsapp)
- CRUD de Campaigns (API `/tenant/campaigns/*`)
- Endpoint `/tenant/leads` (list/get/create/patch) — escreve em `leads`
- Filtros + paginação cursor-based de leads

**Limites (NÃO toca):**
- Não dispara mensagens (só marca lead como `enriched` · Frente C pega daí)
- Não toca em conversations/messages
- Não faz UI
- Z-API só usa endpoint `check-phone` (validação) · envio é da Frente C

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

### 🟧 FRENTE C · Motor de IA & WhatsApp (Dev 3 · Backend+IA + Eng. IA part-time)

**Missão:** o cérebro. Fazer a IA conversar como o Giovane e o WhatsApp não banir.

**Escopo / entregáveis:**
- Integração Z-API send (`integrations/zapi.ts`)
- Integração OpenAI/Anthropic (`integrations/openai.ts` · com fallback)
- **Script engine** (`ai/script-engine.ts` · executa flow JSON via state machine)
- **Prompt builder** (`ai/prompt-builder.ts` · mescla voice_profile + script + histórico)
- **Classificador de intenção** (`ai/classifier.ts` · 12 categorias + fallback rule-based)
- **Guardrails** (`ai/guardrails.ts` · 6 validações pre-send · Anexo E.2)
- `worker:send-messages` (com `canSendMessage()` + aquecimento · Anexo D.2)
- `worker:process-inbound` (webhook Z-API → IA → resposta · com lock por conversation)
- `worker:health-check` (Quality Rating monitor)
- `worker:followup` (cadência D+3/D+7/D+14)
- Webhook handlers Z-API (inbound, status, instance)
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
- **Consome:** leads `enriched` (Frente B), base worker (Frente A), mock Z-API + OpenAI (Frente A)
- **Entrega para Frente D:** evento/tool-call `schedule_meeting` na fila (Frente D consome)
- **Entrega para Frente E:** endpoints `/tenant/conversations`, `/tenant/scripts` + eventos real-time de mensagem
- **Escreve em:** `conversations`, `messages`, `optouts`, atualiza `leads.status`

**Milestones:**
| Semana | Entrega |
|---|---|
| S2-S3 | Script engine + prompt builder + guardrails (contra mock OpenAI) |
| S3 | Classificador de intenção + test cases CI |
| S4 | `worker:process-inbound` + `send-messages` com mock Z-API → conversa fake fim-a-fim |
| S5 | Integração REAL Z-API + OpenAI · primeiras conversas em homologação |
| S5-S6 | Aquecimento iniciado + calibração de roteiros com Giovane (discovery output) |
| S6 | Follow-up + opt-out + health-check |
| S7 | 50 contatos reais com ≥95% de acerto da IA (critério 6.3) |

**Definition of Done:**
- IA responde corretamente ≥ 95% em testes (50 contatos)
- Zero alucinação de valores (guardrails passam 100%)
- Opt-out efetivo ≤ 1min
- Aquecimento respeitado · Quality Rating verde

---

### 🟪 FRENTE D · Agendamento, Usage & Super-Admin (Dev 4 · Backend)

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

### 🟨 FRENTE E · Painel Tenant & Super-Admin Web (Dev 5 · Frontend)

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

| Semana | Frente A | Frente B | Frente C | Frente D | Frente E |
|---|---|---|---|---|---|
| **S1** FOUNDRY | 🔑 Schema+RLS+types+mocks | aguarda contratos / estuda fontes | aguarda contratos / desenha flows | aguarda contratos / estuda Calendar API | Setup + design system + MSW |
| **S2** OBSERVE | Auth + middleware + workers base | Campaigns + leads API (mock) | Script engine + prompt builder | Meetings + dashboard API (mock) | Auth UI + shell + Início |
| **S3** REFINE | CI/CD + vault + onboard backend | Fit Score + testes | Classifier + guardrails + CI | Usage tracking + aggregation | Conversas + drawer + Kanban |
| **S4** GENERATE A | suporte + RLS review | capture worker (mock) | process-inbound (mock) | schedule-meeting (mock) | Agenda + Leads + Config |
| **S5** GENERATE B | suporte | 🔌 Google Maps REAL | 🔌 Z-API + OpenAI REAL | 🔌 Calendar REAL | Roteiros + integração API real |
| **S6** GENERATE C | testes isolamento | enrich + tuning | aquecimento + calibração | digest + super-admin | Super-Admin UI + real-time |
| **S7** EMPOWER | hardening + deploy prod | 100 leads/dia prod | 50 contatos ≥95% | agendamento E2E | polish + a11y + E2E |

**🔑 = entrega crítica que destrava · 🔌 = integração real (depende de credenciais do OBSERVE)**

---

## 6. Pontos de sincronização obrigatórios

| Quando | Cerimônia | Objetivo |
|---|---|---|
| Diário (15min) | Daily standup | Bloqueios, dependências do dia |
| S1 fim | **Contract freeze** | Aprovar shared-types + OpenAPI + mocks · ponto sem volta |
| S3 fim | **Integration checkpoint** | Cada frente demonstra rodando contra mock |
| S4 fim | **Credentials gate** | Confirmar que Z-API, Google Cloud, etc estão coletados (OBSERVE) |
| S5 meio | **Real integration sync** | Todas as frentes trocam mock por real ao mesmo tempo |
| S6 fim | **Pre-go-live review** | Critérios de aceite por frente validados |
| S7 | **Go-live** | Deploy coordenado + smoke tests |

**Regra de mudança de contrato:** depois do S1 freeze, qualquer mudança em shared-types/OpenAPI exige aviso no canal + aprovação do Lead (Dev 1). Mudança breaking → reunião de 15min com afetados.

---

## 7. Limites globais (o que ninguém faz sozinho)

| Decisão | Quem aprova |
|---|---|
| Mudança no schema do banco | Dev 1 (Lead) · PR review obrigatório |
| Mudança em RLS policies | Dev 1 + 1 revisor · crítico de segurança |
| Mudança em contrato de API (OpenAPI) | Dev 1 + frente afetada |
| Nova dependência npm | Qualquer dev · mas roda `pnpm audit` no PR |
| Novo serviço de infra (custo) | Gustavo (PM) |
| Mudança em prompt da IA em prod | Eng. IA + test cases verdes |
| Deploy em produção | Dev 1 ou Gustavo · após CI verde |

---

## 8. Riscos de paralelização & mitigação

| Risco | Mitigação |
|---|---|
| Frente A atrasa e trava todos | Dev 1 foca 100% em contratos na S1 · nada mais. Se atrasar, é o único bloqueio crítico — priorizar |
| Mocks divergem da API real | Mocks gerados do mesmo OpenAPI · contract testing valida real vs mock |
| Conflito de merge em arquivos compartilhados | shared-types e schema só Dev 1 edita · outros pedem via PR |
| Credenciais externas atrasam (Giovane) | Coletadas no OBSERVE (S2-S3) · frentes usam mock até S5 · folga de 2 semanas |
| Integração real quebra na S5 | Cada frente tem 1 semana de buffer (S6) antes do go-live |
| Frente C (IA) é a mais arriscada | Eng. IA part-time dá reforço · calibração começa cedo (S5) com discovery da S1 |
| Dev sai do projeto | shared-types + OpenAPI + PRD documentam tudo · onboarding de novo dev < 1 dia |

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

---

## 10. Estrutura de branches por frente

```
main
├── staging
├── feat/foundation-*      → Dev 1 (Frente A)
├── feat/capture-*         → Dev 2 (Frente B)
├── feat/ai-whatsapp-*     → Dev 3 (Frente C)
├── feat/calendar-admin-*  → Dev 4 (Frente D)
└── feat/web-*             → Dev 5 (Frente E)
```

- Cada frente trabalha em branches `feat/<area>-<feature>`
- PR pra `staging` (deploy automático staging)
- Code review obrigatório (1 aprovação · 2 se tocar schema/RLS)
- Merge `staging → main` semanal (sexta) após validação
- Pastas de "ownership" no monorepo evitam conflito:
  - Dev 1: `packages/*`, `apps/api/src/middlewares`, `prisma/`
  - Dev 2: `apps/api/src/integrations/google-maps.ts`, `brasilapi.ts`, `workers/capture*`, `enrich*`, `routes/tenant/leads,campaigns`
  - Dev 3: `apps/api/src/ai/*`, `integrations/zapi.ts`, `openai.ts`, `workers/process-inbound`, `send-messages`, `routes/tenant/conversations,scripts`
  - Dev 4: `apps/api/src/integrations/google-calendar.ts`, `workers/schedule*`, `usage*`, `routes/tenant/meetings,dashboard`, `routes/admin/*`
  - Dev 5: `apps/web/*`, `apps/admin/*`

---

**FIM** · este plano é revisado no fim de cada semana no checkpoint. Ownership de arquivos é guia, não muralha — comunicação no daily resolve sobreposições.
