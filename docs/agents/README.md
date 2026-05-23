# Modelo de trabalho com agentes IA · Prospix

> O time de desenvolvimento Prospix é composto por **agentes IA dedicados por frente** (Codex CLI, Gemini CLI, Claude Code), com Gustavo (Guilds) como PM, Claude como revisor independente e Codex como Auditor Oficial com gate bloqueante.
> Esse modelo difere de um time humano em três pontos críticos — **specs precisam refletir isso**.

---

## 1. Princípios de operação

### 1.1 Specs como prompts executáveis, não documentos de leitura
Agentes não improvisam contexto. Cada frente recebe um arquivo `docs/agents/frente-X-*.md` que contém:

1. **Objetivo da frente** em 2-3 frases (não 2 páginas)
2. **Contexto mínimo necessário** (links pra arquivos específicos do repo · não "leia o PRD inteiro")
3. **Contratos rígidos**: tipos TypeScript de input/output, schema do banco que pode tocar, endpoints OpenAPI que deve expor
4. **Tarefas atômicas em ordem** (cada uma com critério de aceite verificável por teste)
5. **Comandos de validação**: `pnpm test`, `pnpm typecheck`, `pnpm lint` — quando todos verdes, a tarefa está aceita
6. **Limites explícitos**: o que **NÃO** tocar (arquivos de outras frentes, schema, RLS, etc)

### 1.2 Contract tests são a "verdade" do "está pronto"
Auto-avaliação de agente IA é otimista. O sinal de aceitação é CI verde:
- Lint passa
- Typecheck passa
- Testes unitários da frente passam
- Testes de contrato (frente vs OpenAPI/shared-types) passam
- Testes de isolamento multi-tenant passam

### 1.3 Mocks e seed são fonte da verdade do contexto
Mocks que vivem em `packages/mocks/` são o que o agente "sabe sobre o mundo". Seed do banco define como ficam os dados. **Nunca peça pro agente "imaginar" dados realistas** — gere os mocks/seeds primeiro e referencie no prompt.

### 1.4 Auditoria oficial bloqueia risco crítico
Codex é o **Auditor Oficial** do Prospix e pode bloquear merge, release ou go-live quando evidência, segurança ou testes críticos não fecham. A auditoria oficial vive em [`docs/auditoria/`](../auditoria/).

Todo PR deve entregar:
- Frente e squad de auditoria.
- Arquivos tocados.
- Comandos executados.
- Testes verdes ou lacuna justificada.
- Riscos residuais.
- Evidências classificadas quando tocar área crítica.

Claude revisa achados altos/críticos como avaliador independente. Gustavo decide apenas aceitação excepcional de risco.

---

## 2. Frentes e ownership

| Frente | Agente sugerido | Ownership de pastas | Spec |
|---|---|---|---|
| **A · Foundation** | Claude Code (ou senior) | `packages/*`, `apps/api/src/middlewares/`, `apps/api/prisma/` | `frente-a-foundation.md` |
| **B · Captura** | Codex | `apps/api/src/integrations/{google-maps,brasilapi}.ts`, `workers/capture*`, `enrich*`, `routes/tenant/{leads,campaigns}.ts` | `frente-b-captura.md` |
| **C · IA + WhatsApp** | Codex ou Claude | `apps/api/src/ai/*`, `integrations/{evolution,openai,anthropic,google-ai}.ts`, `workers/{process-inbound,send-messages,followup,health-check}`, `routes/tenant/{conversations,scripts}.ts` | `frente-c-ia-whatsapp.md` |
| **D · Calendar + Admin** | Gemini | `apps/api/src/integrations/google-calendar.ts`, `workers/{schedule-meeting,usage-aggregation,daily-digest}`, `routes/tenant/{meetings,dashboard}.ts`, `routes/admin/*` | `frente-d-calendar-admin.md` |
| **E · Frontend painel + admin** | Codex ou Gemini | `apps/web/*`, `apps/admin/*` | `frente-e-frontend.md` |
| **F · Landing + Auth** *(novo)* | Codex ou Gemini | `apps/landing/*`, `apps/web/src/auth/*` | `frente-f-landing-auth.md` |

**Regra de ouro:** cada frente só edita dentro do próprio ownership. Mudança em código compartilhado (`packages/*`, schema, OpenAPI) requer PR específico revisado pelo PM + coordenador (Claude).

---

## 3. Workflow padrão por tarefa

```
1. PM/coordenador escreve a tarefa no spec da frente (ou abre issue no GitHub)
   - Se for trabalho multiagente, criar pacote `MA-*` com `docs/auditoria/template-pacote-tarefa.md`
   - Registrar status em `docs/auditoria/matriz-execucao-multiagente.md`
2. Agente IA lê:
   - Spec da frente (contexto + contratos + critério de aceite)
   - Arquivos mencionados (input contracts)
   - Mocks/seeds relevantes
3. Agente IA cria branch feat/<frente>-<feature>
4. Agente IA implementa + escreve testes
5. Agente IA roda pnpm test && pnpm typecheck && pnpm lint
6. Se verde → push + abre PR
7. Coordenador/revisor (Claude) revisa diff vs spec/contratos quando aplicável
8. Codex executa gate de auditoria oficial conforme `docs/auditoria/`
   - Troca de dono usa `docs/auditoria/template-handoff.md`
   - Conflito usa `docs/auditoria/protocolo-conflitos.md`
9. Se aprovado → merge em staging
10. Sexta: PM aprova merge staging → main quando não houver bloqueio P0/P1
```

---

## 4. Estrutura padrão de um spec de frente

```markdown
# Frente X · <Nome>

## Objetivo
<2-3 frases. O que essa frente entrega e por quê.>

## Contexto mínimo
- Schema relevante: [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma) (models: Lead, Campaign, ...)
- OpenAPI endpoints owned: GET/POST /tenant/leads/*, /tenant/campaigns/*
- Mocks: packages/mocks/google-maps.ts, packages/mocks/brasilapi.ts
- Seed: apps/api/prisma/seed.ts (tenants A e B fictícios)
- Workers base: packages/shared-types/worker.ts

## Contratos (input/output)
\`\`\`typescript
// Input (do worker)
{ tenant_id: string; campaign_id: string; max_captures: number }

// Output (efeito colateral)
- Insert N rows em leads (status: CAPTURED)
- Insert N rows em lead_events (event_type: 'captured')
- Update tenant_usage.google_maps_calls += N
\`\`\`

## Limites (NÃO TOCAR)
- packages/* (Frente A)
- apps/api/src/middlewares/* (Frente A)
- apps/api/src/ai/* (Frente C)
- apps/api/prisma/schema.prisma (Frente A revisa)
- RLS policies (Frente A revisa)

## Tarefas

### Tarefa 1: <título>
**Arquivos a criar/editar:**
- apps/api/src/integrations/google-maps.ts

**Implementação:**
<1-3 parágrafos descrevendo a abordagem>

**Critério de aceite (verificável):**
- [ ] Função `searchPlaces(query, filters)` exportada
- [ ] Teste unitário em google-maps.test.ts cobre: happy path, rate limit, response inválida
- [ ] Teste passa com mock `packages/mocks/google-maps.ts`
- [ ] `pnpm typecheck` verde

**Comando de validação:**
\`\`\`bash
pnpm --filter @prospix/api test src/integrations/google-maps.test.ts
\`\`\`

### Tarefa 2: ...
```

---

## 5. Anti-patterns (o que NÃO fazer com agentes)

| Erro | Por quê dá ruim | Faça em vez |
|---|---|---|
| "Implemente o sistema de captura de leads" | Vago. Agente inventa escopo, mistura responsabilidades. | "Implemente função `searchPlaces` em `apps/api/src/integrations/google-maps.ts` com assinatura X, testes Y, validando contra mock Z." |
| Spec referenciando 5 docs de leitura | Agente lê e fica perdido entre prioridades. | Spec referencia 1-2 arquivos máximo + mocks. PRD geral fica fora do prompt operacional. |
| "Use boas práticas" | Cada IA tem ideia diferente de "boas práticas". | "Use Zod pra validação, Pino pra logs, Prisma pra DB, Result type pra erros (sem try/catch nas camadas de domínio)." |
| Pular contract tests | "Funcionou local" não significa nada se OpenAPI/types divergem. | CI roda contract test que valida response real vs spec OpenAPI. |
| Deixar agente decidir nome de tabela/coluna | Inconsistência multiplicada. | Schema já fechado pela Frente A. Agente consome, não cria. |

---

## 6. Versionamento dos próprios prompts dos agentes

Os specs em `docs/agents/` são código também. Tratamos como tal:
- Versionados no git
- Mudança requer PR
- Quando uma frente diverge do que o spec dizia, atualizar **spec primeiro**, depois código
- Manter changelog inline: cada arquivo termina com seção `## Changelog`

---

## 7. Quando humano entra na alça

Triggers obrigatórios pra PM (Gustavo) revisar antes de merge:

- Qualquer mudança em schema Prisma
- Qualquer mudança em RLS policies
- Qualquer mudança em OpenAPI (breaking)
- Mudança em prompt da IA em produção
- Adição de dependência npm
- Mudança que afeta billing/cobrança
- Quando 2 frentes divergem em interpretação de contrato

Triggers obrigatórios para **Codex bloquear** até nova evidência:

- Falha de isolamento multi-tenant ou teste RLS não executado em mudança sensível.
- CI, lint, typecheck ou teste obrigatório sem status confiável.
- Exposição de segredo, token, payload sensível ou PII em log/erro/doc.
- Uso novo de SQL raw inseguro.
- Mudança em auth, session, admin bypass, billing, opt-out ou prompts de IA sem teste.
- Divergência entre implementação e contrato OpenAPI/shared-types.

---

## 8. Onde estamos hoje

> **Fonte da verdade do estado:** [`docs/auditoria/status-cobertura.md`](../auditoria/status-cobertura.md) (atualizado por squad, ponderado, com motivo principal). Não trate esta tabela como autoritativa — ela é resumo derivado.

| Frente | Spec | Implementação | Squad auditor | Gate atual |
|---|---|---|---|---|
| [A · Foundation](frente-a-foundation.md) | ✅ | ✅ real | 1 (Foundation/Security) | Parcial · P0 RLS resolvido local · CI DB-backed pendente |
| [B · Captura](frente-b-captura.md) | ✅ | ✅ real | 2/3 | Em triagem |
| [C · IA + WhatsApp](frente-c-ia-whatsapp.md) | ✅ | ✅ real | 3 (Workers/IA/WhatsApp) | Bloqueado go-live · DLQ física + E2E WhatsApp pendentes |
| [D · Calendar + Admin](frente-d-calendar-admin.md) | ✅ | ✅ real | 2/3 | Em triagem |
| [E · Frontend painel + admin](frente-e-frontend.md) | ✅ | ✅ real | 4 (Frontend/UX) | Bloqueado homologação ampla · estados estruturais + a11y |
| [F · Landing + Auth](frente-f-landing-auth.md) | ✅ | ✅ real | 4/6 | Em mitigação · LGPD claims + termos juridicos |

**Estado atual** (snapshot · 23/05/2026): monorepo com implementação real, ~26 mil LOC de aplicação, 162 testes verdes, prova DB-backed RLS local, prova Redis/BullMQ real para idempotência, framework de auditoria com 35 achados, 0 P0 aberto, 18 P1 em vários estágios. **Prontidão auditável** estimada em ~89% pelo Squad 0; **prontidão para go-live** menor por causa de gaps estruturais (DLQ física, smoke E2E, LGPD operacional, revisão jurídica).

**Próximo passo:** reproduzir provas DB-backed em CI, fechar P1 de DLQ/auth integrada/LGPD, smoke E2E pós-login.

---

## Changelog

- **v1.0** (21/05/2026): doc inicial.
- **v1.1** (21/05/2026): adiciona Codex como Auditor Oficial com gate bloqueante e atualiza o estado das frentes para implementação iniciada.
- **v1.2** (23/05/2026): tabela de status aponta para `docs/auditoria/status-cobertura.md` como fonte da verdade; snapshot 23/05 com 162 testes, prova DB-backed local e 35 achados.
