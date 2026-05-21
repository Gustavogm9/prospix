# Frente A · Foundation & Plataforma

## Objetivo

Construir a base multi-tenant que destrava todas as outras frentes: schema + RLS, auth, middleware de tenant-context, base worker, mocks, CI/CD. **Sem essa frente entregar na S1, nada mais anda.**

## Contexto mínimo

- Schema fechado: [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)
- RLS SQL: [apps/api/prisma/sql/01_rls.sql](../../apps/api/prisma/sql/01_rls.sql)
- Tipos compartilhados: [packages/shared-types/src/](../../packages/shared-types/src/)
- Mocks já criados: [packages/mocks/src/](../../packages/mocks/src/)
- Stack TypeScript: Fastify 5 + Prisma 5 + BullMQ + Zod + Pino
- Auth: JWT RS256 + magic link via Evolution API (chave Guilds em `EVOLUTION_GUILDS_*`)

## Contratos que entrega

```typescript
// 1. Middleware tenant-context
export async function tenantContext(req: FastifyRequest): Promise<void>;
// Lê JWT, valida X-Tenant-Id, injeta SET LOCAL app.tenant_id no PG.

// 2. Base worker class
export abstract class BaseWorker<TPayload extends BaseJobPayload, TResult> {
  abstract process(payload: TPayload): Promise<Result<TResult>>;
  // Auto-injeta tenant_id no PG no início, libera no final.
}

// 3. Secrets vault
export async function encryptSecret(plaintext: string): Promise<string>;
export async function decryptSecret(ciphertext: string): Promise<string>;
// AES-256-GCM com SECRETS_ENCRYPTION_KEY do .env

// 4. Magic link
export async function sendMagicLink(whatsapp: string): Promise<Result<{ expires_in: number }>>;
export async function validateMagicLink(token: string): Promise<Result<{ user_id: string; tenant_id: string | null }>>;
```

## Limites (NÃO TOCAR)

- `apps/api/src/integrations/{google-maps,brasilapi}.ts` (Frente B)
- `apps/api/src/integrations/{evolution,openai,anthropic,google-ai}.ts` (Frente C)
- `apps/api/src/integrations/google-calendar.ts` (Frente D)
- `apps/api/src/ai/*` (Frente C)
- `apps/api/src/workers/{capture,enrich,*-meeting,daily-digest}` (Frentes B/D)
- `apps/web/*`, `apps/admin/*`, `apps/landing/*` (Frentes E/F)
- Adicionar dependências sem PR aprovado pelo PM

## Tarefas (ordem)

### A1 · Setup do projeto API

**Arquivos a criar:**
- `apps/api/src/index.ts` (bootstrap Fastify)
- `apps/api/src/config/env.ts` (Zod schema + parser de `process.env`)
- `apps/api/src/lib/logger.ts` (Pino estruturado)
- `apps/api/src/lib/prisma.ts` (singleton Prisma Client)
- `apps/api/src/lib/redis.ts` (singleton ioredis + BullMQ connection)
- `apps/api/prisma/seed.ts` (usa `@prospix/mocks/seed`)

**Critério de aceite:**
- [ ] `pnpm --filter @prospix/api dev` sobe API em `localhost:3000`
- [ ] `GET /health` responde `200 { status: "ok" }`
- [ ] Logs estruturados (JSON em prod, pretty em dev)
- [ ] `env.ts` valida obrigatórios e falha rápido se faltar variável

### A2 · Migrations + RLS

**Arquivos a criar:**
- Rodar `prisma migrate dev --name init` (gera migration baseline)
- Adicionar passo no `db:migrate` que aplica `prisma/sql/01_rls.sql` via `psql`
- `apps/api/tests/multi-tenant/rls.test.ts`

**Critério de aceite:**
- [ ] Migration aplica RLS em todas as 24 tabelas listadas no `01_rls.sql`
- [ ] Teste RLS: sem `app.tenant_id` no contexto, `SELECT * FROM leads` retorna 0 rows
- [ ] Teste RLS: com `app.tenant_id = '<A>'`, query retorna só rows do tenant A
- [ ] `pnpm db:migrate` é idempotente

### A3 · Middleware tenant-context

**Arquivo:**
- `apps/api/src/middlewares/tenant-context.ts`
- `apps/api/src/middlewares/auth.ts` (verifyJWT)

**Implementação:**
1. Lê `Authorization: Bearer <jwt>`, verifica via JWT RS256 + chave pública
2. Lê `X-Tenant-Id` do header, compara com claim `tenant_id` do JWT — mismatch → 403
3. Executa `SELECT set_config('app.tenant_id', $tenantId, true)` no Prisma client da request (via interactive transaction ou `$executeRaw`)
4. Anexa `req.tenantId`, `req.userId`, `req.role` ao request
5. Bypass para rotas `/auth/*`, `/webhooks/*`, `/health`, `/ready`

**Critério de aceite:**
- [ ] Teste E2E: request sem token → 401
- [ ] Request com JWT válido mas `X-Tenant-Id` diferente → 403
- [ ] Request OK injeta tenant_id e queries Prisma respeitam RLS

### A4 · Auth flow (magic link)

**Arquivos:**
- `apps/api/src/routes/auth/magic-link.ts` (POST)
- `apps/api/src/routes/auth/callback.ts` (GET)
- `apps/api/src/routes/auth/refresh.ts` (POST)
- `apps/api/src/routes/auth/logout.ts` (POST)
- `apps/api/src/services/auth-service.ts`

**Fluxo (ver [PRD G.1](../PRD.md):**
1. POST `/auth/magic-link` recebe `{ whatsapp }` → gera token UUID → guarda em Redis `magic:{token}` com TTL 10min
2. Envia mensagem WhatsApp via Evolution API instância Guilds-master com link `${APP_URL}/auth/callback?token=...`
3. GET `/auth/callback?token=...` valida token, emite JWT + refresh token
4. Refresh token rotation a cada uso

**Critério de aceite:**
- [ ] Token uso único (consumido → removido do Redis)
- [ ] Magic link expira em 10min
- [ ] Rate limit 10 req/min por IP em `/auth/*`
- [ ] Tests com mocks de Evolution

### A5 · Secrets vault (AES-256-GCM)

**Arquivo:**
- `apps/api/src/tenant/secrets-vault.ts`

**Implementação:**
- AES-256-GCM com chave de 32 bytes do `SECRETS_ENCRYPTION_KEY` (base64)
- Format do ciphertext: `<iv_base64>.<tag_base64>.<ciphertext_base64>` (string única)
- Funções: `encryptSecret(plaintext)`, `decryptSecret(ciphertext)`
- Helper: `getDecryptedSecrets(tenantId)` lê tenant_secrets + decifra tudo

**Critério de aceite:**
- [ ] Round-trip: `decryptSecret(encryptSecret(x)) === x`
- [ ] Tampering detection: ciphertext modificado lança erro (AuthenticationFailed)
- [ ] Test coverage 100%

### A6 · Base worker class + BullMQ infra

**Arquivos:**
- `apps/api/src/workers/_base-worker.ts`
- `apps/api/src/workers/index.ts` (bootstrap workers)
- `apps/api/src/lib/queue.ts` (BullMQ queues namespaced por tenant)

**Implementação:**
```typescript
abstract class BaseWorker<TPayload extends BaseJobPayload, TResult> {
  abstract name: string;
  abstract concurrency: number;
  abstract process(job: Job<TPayload>): Promise<TResult>;

  async run(job: Job<TPayload>): Promise<TResult> {
    if (!job.data.tenant_id) throw new Error('Missing tenant_id in job payload');
    await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${job.data.tenant_id}, true)`;
    logger.info({ worker: this.name, tenant_id: job.data.tenant_id, job_id: job.id }, 'job:start');
    try {
      const result = await this.process(job);
      logger.info({ worker: this.name, duration_ms: Date.now() - job.timestamp }, 'job:done');
      return result;
    } catch (err) {
      logger.error({ worker: this.name, err }, 'job:fail');
      throw err;
    }
  }
}
```

**Critério de aceite:**
- [ ] Job sem `tenant_id` falha imediatamente
- [ ] Logs incluem `tenant_id` + `worker` + `duration_ms`
- [ ] Filas namespaced: `queue:tenant_<id>:<worker_name>`
- [ ] DLQ configurada com retry exponencial

### A7 · Idempotency middleware

**Arquivo:**
- `apps/api/src/middlewares/idempotency.ts`

**Implementação:** PRD F.2 (tabela `idempotency_keys` + middleware que cacheia response em UPDATE/POST de operações com efeito colateral).

**Critério de aceite:**
- [ ] Mesma chave duas vezes retorna response cacheado
- [ ] TTL padrão 24h
- [ ] Sem chave → passa direto (não obrigatório em todos endpoints)

### A8 · Tipos compartilhados gerados

**Arquivos:**
- Atualizar `packages/shared-types/src/prisma.ts` para re-exportar do `@prisma/client`
- Adicionar script `db:generate` que roda `prisma generate` + atualiza `shared-types`

**Critério de aceite:**
- [ ] `import { Lead, Conversation } from '@prospix/shared-types/prisma'` funciona em qualquer app

### A9 · CI/CD

**Arquivos:**
- `.github/workflows/ci.yml` (já criado · validar funciona)
- `.github/workflows/deploy-staging.yml` (push em `staging` → Railway)
- `.github/workflows/deploy-prod.yml` (push em `main` → Railway com blue/green)

**Critério de aceite:**
- [ ] PR para `staging` → CI verde antes de merge
- [ ] Push em `staging` → deploy automático
- [ ] Smoke test pós-deploy verifica `/health` e `/ready`

### A10 · Onboarding wizard backend (compartilhado com Frente D)

**Arquivos:**
- `apps/api/src/routes/admin/tenants.ts` (POST /admin/tenants · cria tenant)
- `apps/api/src/routes/admin/invitations.ts` (POST/PATCH/DELETE `/admin/tenants/:id/invitations`)
- `apps/api/src/services/invitation-service.ts` (gerar código formato `PRSPX-XXXX-XXXX`)

**Critério de aceite:**
- [ ] Código gerado segue regex `^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$`
- [ ] Apenas 1 invitation ativo por tenant (constraint do RLS SQL)
- [ ] Único `usado_at` permitido (single-use)

## Comandos de validação

```bash
# Local
pnpm install
docker-compose up -d
pnpm --filter @prospix/api db:migrate:dev
pnpm --filter @prospix/api db:seed
pnpm --filter @prospix/api dev      # API em :3000
pnpm --filter @prospix/api test

# CI
pnpm typecheck
pnpm lint
pnpm test
pnpm test:multi-tenant              # OBRIGATÓRIO ficar verde
```

## Definition of Done (frente inteira)

- [ ] `pnpm install && docker-compose up && pnpm dev` funciona em < 15min para outro dev
- [ ] Testes de isolamento multi-tenant em CI (≥ 3 cenários: read direto, list, worker)
- [ ] Auth flow E2E verde (magic link → callback → request autenticada)
- [ ] Migrations rodam em staging sem erro
- [ ] CI verde em todas as branches

## Changelog

- v1.0 (21/05/2026): spec inicial.
