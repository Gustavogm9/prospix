# Frente F · Landing Page + Auth + Cadastro com código

## Objetivo

Construir o marketing público em `prospix.com.br` (Next.js) + fluxos de auth/cadastro no painel (`app.prospix.com.br`). Cadastro é **gated por código de convite** gerado pelo super-admin Guilds (setup pago off-platform).

## Contexto mínimo

- Design system: [docs/design-system.md](../design-system.md)
- Tokens CSS: [packages/ui/src/tokens.css](../../packages/ui/src/tokens.css)
- Brief de marca: [design-system.md seção 9](../design-system.md) — logo + favicon ainda a gerar
- Auth flow: PRD G.1 + Frente A endpoints
- Cadastro: PRD G.2 (com adaptação · código de convite obrigatório)
- Tom: premium-sóbrio B2B brasileiro (Pipefy, Stripe BR, Linear · não Hotmart)

## Stack

- **Landing:** Next.js 15 (App Router) + Tailwind + shadcn/ui + MDX (blog Fase 2)
- **Auth UI:** mesma stack do painel web (React 18 + Vite)
- **Cadastro:** páginas dentro do painel web

## Limites (NÃO TOCAR)

- Backend (Frentes A/B/C/D entregam endpoints)
- Schema (Frente A)
- Painel logado (Frente E)

## Tarefas

### F1 · Setup `apps/landing`

**Arquivos:**
- `apps/landing/next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`
- `apps/landing/src/app/layout.tsx` (root + fontes + tokens.css)
- `apps/landing/src/app/page.tsx` (home)

**Critério de aceite:**
- [ ] `pnpm --filter @prospix/landing dev` sobe em :3001
- [ ] Tailwind herda preset de `@prospix/ui`
- [ ] Fontes Inter + JetBrains Mono carregadas
- [ ] Tokens CSS aplicados (cor primary aparece no `<button>` default)

### F2 · Landing home (`/`)

**Arquivo:** `apps/landing/src/app/page.tsx`

**Estrutura (mobile-first):**
1. **Nav** — logo Prospix + links (Como funciona / Planos / Cases / Login)
2. **Hero** — H1: "Sua máquina de prospecção que agenda reuniões qualificadas no WhatsApp" + sub: "Pare de ligar 100 para falar com 10. A IA captura, conversa e agenda — você só aparece na reunião pronta." + CTA primary "Quero entender" + CTA outline "Ver demo" + visual (screenshot painel ou animação leve)
3. **Prova social** — logo MetLife/Bradesco/Prudential (segmentos atendidos · respeitando uso permitido) + número de "reuniões agendadas" em mono font
4. **Como funciona (3 passos)** — Captura / Conversa / Agenda — cada um com ícone (lucide), copy curta, mini-mockup
5. **"Para quem é"** — Corretores autônomos / Equipes pequenas (2-5 corretores) / Líderes regionais — cards com benefícios específicos
6. **Resultado em números** — "+3x reuniões/mês", "−90% tempo em prospecção", "ROI em 30 dias" (números do ROI da proposta.md)
7. **Planos** — Essencial / Recomendado (★) / Premium — espelho do business/proposta.md
8. **FAQ** — 8-10 perguntas (LGPD, WhatsApp ban, integrações, prazo, suporte)
9. **CTA final** — "Bora trazer essa máquina pro seu funil?" + form curto (nome + WhatsApp + nº de leads/mês desejado) → cria lead Asaas/CRM Guilds
10. **Footer** — links institucionais + LGPD + contato

**Tom (revisar microcopy):**
- "Você quer falar com mais decisores, não digitar mais mensagens." — calmo, concreto
- Não usar: "🚀 explosão de vendas", "última chance", urgência fake
- Usar números (3x, 90%, R$ X cobertos) sempre que possível

**Critério de aceite:**
- [ ] Lighthouse Performance ≥ 90, Accessibility ≥ 95, SEO ≥ 95
- [ ] Metadata OpenGraph + Twitter Card configurados
- [ ] CLS = 0 (imagens com dimensions, fontes com swap)
- [ ] Form de captura submete pra endpoint Guilds (ainda a definir · mock por enquanto)
- [ ] Responsivo: mobile (320px+), tablet, desktop

### F3 · Página Planos (`/planos`)

**Arquivo:** `apps/landing/src/app/planos/page.tsx`

**Conteúdo:** versão expandida da tabela de planos da proposta.md + comparação detalhada feature × feature + perguntas frequentes específicas de pagamento.

### F4 · Página Cases (`/cases`)

**MVP:** placeholder com 1 case (Giovane · MetLife) escrito como "história" (problema → solução → resultado quantificado). Sem blog completo no MVP.

### F5 · Páginas institucionais

- `/lgpd` (DPIA simplificado + DPO contact + direitos do titular)
- `/termos`
- `/privacidade`
- `/contato`

### F6 · Login (no painel web · `/login`)

**Arquivo:** `apps/web/src/pages/auth/Login.tsx`

**Fluxo:**
1. Form: input "WhatsApp" (com máscara `+55 (XX) XXXXX-XXXX`)
2. Submit → POST `/v1/auth/magic-link` (Frente A)
3. Tela de sucesso: "Te mandamos um link no WhatsApp 📱 · Verifica seu app e clica pra entrar." + countdown 10min
4. Botão "Reenviar" habilita após 60s
5. Callback `/auth/callback?token=...` → GET `/v1/auth/callback` → armazena JWT + refresh → redirect `/`

**Critério de aceite:**
- [ ] Validação WhatsApp (formato BR)
- [ ] Loading state durante envio
- [ ] Erro mostra mensagem útil (não código)
- [ ] Token expirado mostra CTA "Pedir novo link"

### F7 · Cadastro com código de convite (`/cadastro`)

**Arquivos:**
- `apps/web/src/pages/auth/SignupCode.tsx` (entrada do código)
- `apps/web/src/pages/auth/SignupDetails.tsx` (dados do owner)

**Fluxo:**
1. **Step 1 · Código:** input máscarado `PRSPX-XXXX-XXXX` (regex valida formato em tempo real)
   - Submit → POST `/v1/auth/invitations/verify` (Frente A endpoint) → retorna nome do tenant ("Você foi convidado para acessar como **Owner** de **Giovane Carrara · MetLife · SJRP**")
   - Erros: expirado, já usado, inválido — cada um com CTA específica ("falar com Guilds")
2. **Step 2 · Dados:** form com Nome, Email, WhatsApp, SUSEP (opcional), Cidade
   - Submit → POST `/v1/auth/invitations/redeem { code, user_data }` → marca código como usado + cria user + envia magic link pra WhatsApp informado
3. **Step 3 · Aguardando login:** "Pronto! Acabei de mandar um link no seu WhatsApp pra primeiro acesso 📱"

**Critério de aceite:**
- [ ] Código mascarado + autoformatado (`PRSPX-` prefixo já escrito)
- [ ] Após Step 2, código fica `used_at = now()` (single-use)
- [ ] Magic link enviado automaticamente pro WhatsApp do owner
- [ ] Erros LGPD: termos + privacidade aceitos (checkbox obrigatório)

### F8 · Página de erro/expirado/já-usado

**Arquivos:**
- `apps/web/src/pages/auth/InvitationError.tsx`

**Variantes:**
- `expired` — "Esse código venceu. Fale com a Guilds pra liberarmos um novo." + WhatsApp Guilds
- `used` — "Esse código já foi usado. Se foi você, faz login. Se não, fala com a Guilds." + 2 CTAs
- `invalid` — "Código não encontrado. Confere se digitou direito ou fala com a Guilds."

### F9 · Geração de assets de marca (delegar pra IA design)

**Action:** rodar brief de `docs/design-system.md` seção 9 com Codex ou Gemini para gerar:
- `apps/landing/public/logo-wordmark.svg`
- `apps/landing/public/logo-mark.svg`
- `apps/landing/public/favicon.ico` (+ favicon-16.png, favicon-32.png)
- `apps/landing/public/apple-touch-icon.png`
- `apps/landing/public/pwa-192.png`, `pwa-512.png`
- `apps/landing/public/og-image.png` (1200×630)

**Critério de aceite:**
- [ ] Logos seguem paleta `#1B3A6B + #E8981C`
- [ ] Estilo geométrico, premium B2B
- [ ] Sem clichês (robô, escudo, guarda-chuva)
- [ ] PM aprova antes do merge

### F10 · Analytics + SEO

**MVP:**
- Google Search Console + sitemap.xml
- robots.txt liberando crawl
- Sem analytics agressivo no MVP (privacidade respeitada)
- (Fase 2: PostHog ou Plausible)

## Comandos de validação

```bash
pnpm --filter @prospix/landing dev
pnpm --filter @prospix/landing build
pnpm --filter @prospix/landing typecheck

pnpm --filter @prospix/web dev
pnpm --filter @prospix/web test src/pages/auth/
```

## Definition of Done

- [ ] Landing live e indexada
- [ ] Lighthouse Performance/A11y/SEO ≥ 90/95/95
- [ ] Login + cadastro com código funcionam fim-a-fim
- [ ] Logo/favicon/PWA icons gerados e aprovados
- [ ] Tom respeitado (revisão PM antes de live)

## Changelog

- v1.0 (21/05/2026): spec inicial.
