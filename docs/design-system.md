# Design System · Prospix

> Fonte da verdade visual do produto. **Extraído do protótipo aprovado pelo Tenant #1** ([business/prototipo.html](../business/prototipo.html)).
> Todo arquivo de UI (painel tenant, super-admin, landing, auth) **respeita esses tokens**.
> Versão 1.0 · 21/05/2026

---

## 1. Princípios

1. **Sóbrio e premium, com calor brasileiro** — corretor de seguros é decisor B2B sério. Não Hotmart, não Linear frio. Pensar Pipefy, Stripe BR, ContaAzul.
2. **Dados primeiro, decoração depois** — números monoespaçados, hierarquia clara, zero estilização desnecessária.
3. **Consistência > novidade** — tokens compartilhados entre as 4 superfícies (landing, auth, painel tenant, super-admin).
4. **Acessibilidade não é opcional** — contraste AA mínimo, navegação por teclado, foco visível, ARIA correto.
5. **Mobile-friendly desde o MVP** — painel funciona em ≥ 768px; landing 100% responsiva mobile-first.

---

## 2. Tokens de cor

### 2.1 Primárias (marca)

| Token | Hex | Uso |
|---|---|---|
| `--primary` | `#1B3A6B` | Botões principais, sidebar ativa, logo, headings de destaque |
| `--primary-hover` | `#142C52` | Hover/active de elementos primary |
| `--primary-soft` | `rgba(27,58,107,0.08)` | Backgrounds sutis (badges, hovers, seleção) |
| `--primary-softer` | `rgba(27,58,107,0.04)` | Backgrounds ainda mais sutis |
| `--secondary` | `#E8981C` | CTAs secundários, destaques, ícones de alerta positivo |
| `--secondary-soft` | `rgba(232,152,28,0.14)` | Backgrounds de badges secundárias |
| `--secondary-softer` | `rgba(232,152,28,0.06)` | Backgrounds ainda mais sutis |
| `--secondary-text` | `#A56B0A` | Texto sobre fundo `--secondary-soft` |

### 2.2 Neutros / superfícies

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#F7F8FA` | Background base da app |
| `--surface` | `#FFFFFF` | Cards, painéis, modais |
| `--surface-sunken` | `#F1F3F6` | Inputs, áreas de input/upload, hovers leves |
| `--border` | `#E5E7EB` | Bordas padrão |
| `--border-subtle` | `#EEF0F3` | Bordas internas (dividers) |
| `--border-strong` | `#D0D5DD` | Bordas de inputs em foco/hover |

### 2.3 Texto

| Token | Hex | Uso |
|---|---|---|
| `--text` | `#0F172A` | Texto principal |
| `--text-secondary` | `#475569` | Texto secundário, labels |
| `--text-muted` | `#94A3B8` | Hints, placeholders, metadados |

### 2.4 Status

| Token | Hex | Uso |
|---|---|---|
| `--success` | `#039855` | Ícones, dots, indicadores positivos |
| `--success-soft` | `#ECFDF3` | Background de badges success |
| `--success-text` | `#027A48` | Texto sobre success-soft |
| `--warning` | `#F79009` | Ícones de atenção |
| `--warning-soft` | `#FFFAEB` | Background de badges warning |
| `--warning-text` | `#B54708` | Texto sobre warning-soft |
| `--error` | `#D92D20` | Ícones e bordas de erro |
| `--error-soft` | `#FEF3F2` | Background de badges error |
| `--error-text` | `#B42318` | Texto sobre error-soft |

### 2.5 Modo escuro

**Não escopo do MVP.** Estrutura preparada (tokens via CSS vars) pra adicionar Fase 2.

---

## 3. Tipografia

### 3.1 Fontes

| Font | Família | Uso | Pesos carregados |
|---|---|---|---|
| **Inter** | sans-serif | UI geral, headings, body | 400, 500, 600, 700 |
| **JetBrains Mono** | monospace | Números, IDs, dados tabulares, badges | 500, 600 |

Loadout via `@fontsource` ou Google Fonts (já no protótipo: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap`).

Classe utilitária: `.mono` aplica `font-family: var(--mono)` + `font-feature-settings: 'tnum' 1` (números tabulares).

### 3.2 Escala (mobile + desktop)

| Token | Tamanho | Line-height | Uso |
|---|---|---|---|
| `text-2xs` | 10px | 1.4 | Labels minúsculos (badges, contagem em sidebar) |
| `text-xs` | 11.5px | 1.4 | Metadados, captions |
| `text-sm` | 12.5px | 1.5 | Botões, badges, texto secundário |
| `text-base` | 14px | 1.55 | **Body padrão da app** |
| `text-md` | 15px | 1.5 | Inputs, body em landing |
| `text-lg` | 17px | 1.4 | Títulos de página (topbar) |
| `text-xl` | 19px | 1.3 | Headers de seção |
| `text-2xl` | 24px | 1.25 | Headings principais |
| `text-3xl` | 32px | 1.2 | Hero landing (mobile) |
| `text-4xl` | 48px | 1.1 | Hero landing (desktop) |
| `text-5xl` | 64px | 1.05 | Hero landing XL (opcional) |

**Body default da app é 14px**, não 16px. Densidade alta porque painel B2B mostra muita info. Landing usa 15-16px (respiro maior).

---

## 4. Espaçamento e dimensões

| Token | Valor | Notas |
|---|---|---|
| `--radius-sm` | 6px | Inputs, botões pequenos, pills |
| `--radius` | 8px | Botões, cards default |
| `--radius-lg` | 12px | Modais, cards de destaque |
| `--sidebar-w` | 236px | Largura fixa da sidebar do painel |
| `--topbar-h` | 60px | Altura da topbar |

Escala de spacing segue Tailwind padrão (`4px = 1` → `gap-1 .. gap-12`). Componentes raramente usam mais que `gap-6` em layout denso.

---

## 5. Sombras e elevação

| Token | Valor | Uso |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)` | Cards, botões primary |
| `--shadow-md` | `0 4px 12px rgba(16,24,40,0.08)` | Dropdowns, hovers de cards |
| `--shadow-lg` | `0 16px 32px rgba(16,24,40,0.12), 0 4px 8px rgba(16,24,40,0.04)` | Modais, popovers, drawers |

---

## 6. Componentes (catálogo extraído do protótipo)

Cada componente do painel é a referência canônica. Reimplementar em **shadcn/ui customizado** mantendo a aparência.

### 6.1 Sidebar
- 236px largura fixa
- Brand (logo + nome do tenant) no topo
- Items com ícone (16x16) + label + contador (mono, pill)
- Item ativo: `background: var(--primary)`, texto branco
- Item hover: `background: var(--surface-sunken)`
- Status dot (pulsante) ao lado de canais ao vivo

### 6.2 Topbar
- 60px altura, sticky
- Título da página + subtítulo abaixo
- Search global central (max-width 440px)
- Ações: notificações (sino com badge), tour, perfil
- Botão CTA primary à direita

### 6.3 Cards
- `border-radius: 8px` padrão
- Border `1px solid var(--border-subtle)` ou shadow-sm (raramente os dois)
- Padding interno 16-20px
- Header com título + meta

### 6.4 Badges
- 4px vertical / 8-10px horizontal padding
- `border-radius: 10px` (pill) ou `--radius-sm` (square)
- Variantes: success / warning / error / primary-soft / secondary-soft / neutral

### 6.5 Botões

| Variante | Background | Texto | Border | Uso |
|---|---|---|---|---|
| `primary` | `--primary` | `#fff` | none | Ação principal |
| `secondary` | `--secondary` | `#fff` | none | CTA secundário em landing |
| `ghost` | transparent | `--text-secondary` | none | Ações neutras em listas |
| `outline` | `--surface` | `--text` | `--border-strong` | Ações secundárias inline |
| `danger` | `--error` | `#fff` | none | Delete, churn, etc |

Altura padrão: 36px. Compacto: 28px. Grande (landing CTAs): 48px.

### 6.6 Drawer (lateral)
- Width: 480px (lead), 600px (config)
- Slide da direita
- Header sticky com nome + ações + close
- Abas (4 no lead: Conversa / Ficha / Saúde / Histórico)

### 6.7 Kanban (Pipeline)
- 6 colunas drag-and-drop
- Cards arrastáveis com WhatsApp truncado, badge fit_score, próxima ação
- Coluna vazia mostra empty state inline

### 6.8 Inputs
- Altura 36px (compacto 32px, landing 48px)
- `background: var(--surface-sunken)` quando idle
- `background: #fff + border var(--primary) + ring 3px primary-soft` quando focus
- Placeholder em `--text-muted`

### 6.9 Toast / Notification
- Bottom-right
- Slide-in animation
- 4 variantes (success/warning/error/info)
- Auto-dismiss 5s, sticky em erros

### 6.10 Chart
- Stack: **Chart.js** (já no protótipo)
- Cores: primary + secondary + tons soft
- Sem 3D, sem gradient agressivo
- Tooltips com mono font

---

## 7. Voz e tom

### 7.1 Princípios

- **Consultivo, não vendedor.** "Vamos ver como…" > "Compre agora!"
- **Concreto, não vago.** "Capturamos 247 leads/mês" > "Capturamos muitos leads"
- **Calmo, não urgente.** Sem "ÚLTIMA CHANCE", sem countdown, sem letras maiúsculas gritando.
- **Cliente é parceiro.** "Você" não "Sr./Sra." (a não ser onde explícito como o "Dr./Dra." nos roteiros MetLife).

### 7.2 Vocabulário Prospix

| Use | Evite |
|---|---|
| reunião agendada | conversão obtida |
| funil de prospecção | "máquina de vendas" |
| lead qualificado | "prospect quente" |
| corretor | "vendedor" |
| painel | "dashboard" (em UI; em docs OK) |
| Prospix | "a ferramenta", "o sistema" (use o nome) |

### 7.3 Microcopy

- **Empty states** sempre com CTA acionável: "Sua primeira campanha já está rodando 🚀 Os primeiros leads aparecem em ~1h."
- **Erros** explicam o que aconteceu + próximo passo, nunca códigos crus.
- **Confirmações** descrevem consequência: "Pausar campanha · sem novos leads até retomar" (não só "Pausar?").

### 7.4 Emojis

Permitidos com moderação. Funções específicas:
- 🚀 onboarding/início
- 🔥 leads quentes / urgência positiva
- ✅ confirmação
- ⚠️ atenção sem ser crítico
- 📅 agenda
- 💬 conversas
- 🤖 IA

Não usar emoji em buttons, headings principais, navegação. OK em empty states e notificações.

---

## 8. Marca Prospix (a definir)

### 8.1 Logo
**Status:** ainda não existe. Brief para gerar:

- **Conceito:** "Prospix" = prospect + IA/precisão. Wordmark + monograma (ícone "P" ou ângulo geométrico).
- **Estilo:** geométrico, premium, B2B sério. Não orgânico, não cartoon.
- **Cores:** primary `#1B3A6B`, secondary opcional `#E8981C` para destaque.
- **Versões mínimas necessárias:**
  - Wordmark horizontal (uso em sidebar, topbar, landing)
  - Monograma quadrado (favicon, app icon, social)
  - Variante reverse (sobre fundo escuro)
  - Variante mono (preto, branco)
- **Formatos:** SVG (master), PNG @1x/@2x/@3x, ICO.

### 8.2 Favicon e PWA icons

| Asset | Tamanho | Formato |
|---|---|---|
| `favicon.ico` | 16/32/48 | ICO multi-size |
| `favicon-16.png`, `-32.png` | 16/32 | PNG |
| `apple-touch-icon.png` | 180 | PNG |
| `pwa-192.png` | 192 | PNG |
| `pwa-512.png` | 512 | PNG (maskable + any purpose) |
| `og-image.png` | 1200×630 | PNG (social share) |
| `logo-mark.svg` | vector | SVG |
| `logo-wordmark.svg` | vector | SVG |

Todos gerados a partir do master SVG. Brief delegado para agente de design (item 9).

### 8.3 Manifest PWA (futuro · Fase 2)

```json
{
  "name": "Prospix",
  "short_name": "Prospix",
  "theme_color": "#1B3A6B",
  "background_color": "#F7F8FA",
  "display": "standalone",
  "start_url": "/",
  "icons": [
    { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

---

## 9. Brief de geração da marca (para agente IA)

> Quando rodar este brief com Codex/Gemini/agente de design, anexar este documento + business/prototipo.html como referência visual.

```
TAREFA: Gerar identidade visual da marca PROSPIX (produto SaaS).

CONTEXTO:
- Prospix é plataforma multi-tenant de prospecção inteligente via WhatsApp para
  corretores de seguros (MetLife, Bradesco, Prudential, etc).
- Vendido pela Guilds (agência de IA + automação) com setup R$ 7.900 + R$ 490/mês.
- Cliente atual: corretor sério, 6 anos de carreira, decisor B2B.
- Estética alinhada com Pipefy, Stripe BR, ContaAzul, Omie. Não Hotmart, não Linear frio.

PALETA OBRIGATÓRIA (já aprovada no protótipo):
- Primary: #1B3A6B (azul corporativo profundo)
- Secondary: #E8981C (laranja queimado, usado com parcimônia)
- Neutros: #F7F8FA bg / #FFFFFF surface / #0F172A texto

TIPOGRAFIA DE SUPORTE: Inter + JetBrains Mono (já carregadas).

ENTREGUE:
1. Wordmark horizontal "Prospix" (SVG editável)
2. Monograma quadrado (ícone — pode ser letra P estilizada, ou símbolo geométrico
   que evoque alvo/precisão/conexão)
3. Versão reverse (branca sobre primary)
4. Versão mono (preto sólido)
5. Favicon multi-size
6. PWA icons 192px e 512px (incluindo maskable safe area)
7. OG image 1200×630 com wordmark + tagline "Prospecção que agenda por você"

EVITAR:
- Roxo, gradiente arco-íris, neon
- Ícones de robô (cliché de IA)
- Letras manuscritas, serifa com personalidade muito forte
- Símbolos óbvios de seguros (escudo, guarda-chuva, família feliz)

REFERÊNCIAS:
- Stripe (precisão, tipografia)
- Pipefy (acessível, calmo)
- Linear (geométrico)
- Notion (clareza, mas com mais cor)
```

---

## 10. Onde cada token vive no código

```
packages/ui/
├── src/
│   ├── tokens.css              # CSS vars (cores, radii, shadows)
│   ├── tailwind.config.ts      # extends de Tailwind com os tokens
│   ├── globals.css             # @font-face + base styles
│   └── components/             # shadcn/ui customizado
│       ├── button.tsx
│       ├── card.tsx
│       ├── badge.tsx
│       ├── drawer.tsx
│       ├── kanban.tsx
│       └── ... (catálogo seção 6)
└── package.json
```

Apps `web`, `admin`, `landing` consomem `@prospix/ui` via workspace.

---

## 11. Checklist antes de usar um componente novo

- [ ] Existe no protótipo aprovado? Se sim, copia a aparência.
- [ ] Se não, casa com tokens da seção 2-5?
- [ ] Voz/microcopy seguindo seção 7?
- [ ] Acessível (foco, contraste, ARIA, keyboard nav)?
- [ ] Responsivo mobile (mesmo painel que é desktop-first)?

---

## 12. Acessibilidade · checklist WCAG 2.1 AA (AUD-P3-035)

### 12.1 Regras hard-enforced no CI

`@axe-core/playwright` roda em `e2e/landing/a11y.spec.ts`, `e2e/web/a11y.spec.ts`,
`e2e/admin/a11y.spec.ts` e **falha o build** em violações `critical` ou `serious`.
`moderate` e `minor` aparecem no log mas não bloqueiam (polish incremental).

Tags WCAG cobertas: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

### 12.2 Regras concretas obrigatórias

| Regra | Quando aplica |
|---|---|
| `aria-label` em botão icon-only | Sempre que o botão é só um ícone (`<Trash2 />`, `<Ban />`, etc) |
| `aria-hidden="true"` em ícone decorativo | Sempre que o ícone está dentro de um botão com texto · evita screen reader duplicar |
| `<label>` ou `aria-labelledby` em todo input | Todo `<Input>` deve ter label associado · placeholders **não** substituem |
| Foco visível em todo interativo | Tailwind `focus-visible:ring-2 focus-visible:ring-primary` (já no preset) |
| Contraste ≥ 4.5:1 texto normal · ≥ 3:1 texto grande | Cores do design system já passam · cuidado em hover states custom |
| `alt` em toda `<img>` | Decorativa: `alt=""` + `role="presentation"` |
| Heading hierarchy correta | h1 único por página · h2 → h3 sem pular nível |
| Form submit acessível por teclado | `<form onSubmit>` sempre · não `<div onClick>` |
| Tabela com `<th scope>` | Tabelas de dados precisam scope row/col |
| Toast com `aria-live="polite"` | Notificações não-críticas |
| Modal com `role="dialog"` + focus trap | Tab cycle não escapa do modal |

### 12.3 Padrões de ícones nos botões

**Icon-only (sem texto):**
```tsx
<Button onClick={...} aria-label="Remover item">
  <Trash2 aria-hidden="true" />
</Button>
```

**Icon + texto:**
```tsx
<Button onClick={...}>
  <Trash2 aria-hidden="true" />
  <span>Remover</span>
</Button>
```

### 12.4 Como rodar a11y local

```bash
# Roda smoke + a11y nos 3 apps em paralelo
pnpm test:e2e:smoke

# Apenas a11y de uma surface
pnpm exec playwright test e2e/landing/a11y.spec.ts
pnpm exec playwright test e2e/web/a11y.spec.ts
pnpm exec playwright test e2e/admin/a11y.spec.ts
```

### 12.5 Quando aceitar uma violação serious/critical

Mover para uma allowlist explícita não é uma opção sem PR aprovado pelo PM.
Em caso de bug do axe-core ou false positive comprovado, abrir aceite em
[docs/auditoria/template-aceite-risco.md](auditoria/template-aceite-risco.md) com:

- ID da violação (`landmark-one-main`, `color-contrast`, etc)
- Por que é false positive
- Prova (screenshot, leitor de tela testado, etc)
- Revisor independente: Claude (severidade alta)

---

**Manutenção:** este doc é atualizado sempre que adicionarmos componente novo, ou quando o protótipo for revisado. Mudança de token requer aprovação do PM (Gustavo).
