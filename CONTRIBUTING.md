# Contribuindo · Prospix

Bem-vindo. Este repo é trabalhado por **agentes IA** (Codex, Gemini, Claude) coordenados por PM. Humanos contribuem quando precisam tomar decisões de arquitetura, ou quando um agente trava.

## Antes de qualquer mudança

1. **Identifique a frente** — toda mudança pertence a uma das 6 frentes ([docs/agents/](docs/agents/))
2. **Leia o spec da frente** — contrato + critérios de aceite são a verdade
3. **Verifique CODEOWNERS** — quem precisa aprovar?

## Workflow

```bash
# 1. Branch da staging
git checkout staging && git pull
git checkout -b feat/<frente>-<feature>
# Ex: feat/captura-fit-score, feat/ai-evolution-router

# 2. Implemente seguindo o spec da frente
# Mantém-se nas pastas do próprio ownership (CODEOWNERS)

# 3. Rode validação local
pnpm lint
pnpm typecheck
pnpm test
pnpm test:multi-tenant   # quando aplicável

# 4. Commit + push
git commit -m "<frente>: <descrição curta>"
git push -u origin feat/<frente>-<feature>

# 5. Abra PR pra staging usando o template
# CI tem que ficar verde
# Revisor (CODEOWNERS + PM) aprovam
```

## Regras de ouro

1. **Nunca toque em pastas de outra frente** sem PR específico aprovado pelo PM
2. **Schema, RLS, OpenAPI, prompts em prod** → 2 reviewers obrigatórios
3. **Nenhuma query SQL sem `tenant_id` no WHERE** (cinturão e suspensório · RLS já isola, mas a regra fica)
4. **Workers sempre injetam `tenant_id`** no início do job · base class garante
5. **Logs sempre incluem `tenant_id` no contexto**
6. **Nunca skip hooks** (--no-verify) ou suprime CI sem aprovação explícita
7. **Testes multi-tenant devem ficar verdes** · qualquer falha indica vazamento entre tenants

## Quando agente IA pediu help

Se o agente travou e você (humano) precisa intervir:

1. Lê o spec da frente · o spec é correto?
2. Lê o diff que o agente produziu · onde divergiu?
3. Se spec estava errado: atualiza spec primeiro, depois código
4. Se agente errou: dá feedback no PR (texto · não código) e deixa agente refazer
5. Se você precisa codar: ok, faz um commit explícito identificando "humano: <razão>"

## Quando humano detecta gap no PRD

PRD é referência canônica de produto. Se notar gap:

1. Discute no Slack/issue antes de mudar
2. PR pequeno atualizando só o PRD
3. Depois, PR de implementação seguindo PRD novo

## Style guide

- TypeScript: strict mode, no implicit any, Result type pra erros
- Validação: Zod em todo input (boundary)
- Logs: Pino estruturado, nunca console.log
- Erros: `Result<T, AppError>` em domain layer · `throw` só em handlers Fastify
- Comentários: só quando o WHY é não-óbvio · NUNCA documentar o WHAT
- Tests: Vitest · co-localizado (`foo.ts` + `foo.test.ts` na mesma pasta)

## Setup local

Ver [README.md](README.md) seção "Como começar".

## Dúvidas

- Arquitetura → ler [docs/PRD.md](docs/PRD.md)
- Como devs trabalham → [docs/agents/README.md](docs/agents/README.md)
- Visual → [docs/design-system.md](docs/design-system.md) + [business/prototipo.html](business/prototipo.html)
- API → [docs/api/openapi.yaml](docs/api/openapi.yaml)
- Onboarding novo tenant → PRD anexo G
- Cadastro com código → PRD anexo N
