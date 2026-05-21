# Brief executável · Identidade visual Prospix

> **Como usar:** colar este prompt direto no Codex / Gemini / Claude com capacidade de gerar imagens, ou enviar para designer humano.
> **Output esperado:** entregar arquivos na pasta `apps/landing/public/` + `apps/web/public/`.
> **Aprovação:** PM (Gustavo) aprova antes do merge.

---

## Prompt principal

```
TAREFA: Criar a identidade visual completa de marca para PROSPIX (produto SaaS B2B).

═══════════════════════════════════════════════════════════════════════════════
CONTEXTO DO PRODUTO
═══════════════════════════════════════════════════════════════════════════════

Prospix é uma plataforma multi-tenant de prospecção inteligente para corretores
de seguros (MetLife, Bradesco, Prudential e similares). O produto:

- Captura prospects (médicos, advogados, dentistas, empresários) via Google Maps
- Conversa por WhatsApp com IA treinada na linguagem do corretor
- Agenda reuniões direto no Google Calendar
- O corretor só aparece nas reuniões já qualificadas

Vendido pela Guilds (agência de IA + automação) a R$ 7.900 setup + R$ 490/mês.
Primeiro cliente: corretor MetLife em São José do Rio Preto há 6 anos.

═══════════════════════════════════════════════════════════════════════════════
POSICIONAMENTO E TOM
═══════════════════════════════════════════════════════════════════════════════

Premium-sóbrio, B2B brasileiro sério. Não Hotmart, não Linear frio.

Referências de estética desejada:
- Pipefy (clareza acessível)
- Stripe (precisão, tipografia)
- Linear (geométrico)
- ContaAzul (B2B BR profissional)
- Notion (calmo, mas não estéril)

═══════════════════════════════════════════════════════════════════════════════
TIPOGRAFIA (já definida, NÃO mudar)
═══════════════════════════════════════════════════════════════════════════════

- Inter (sans-serif principal · 400, 500, 600, 700)
- JetBrains Mono (números, IDs, dados tabulares · 500, 600)

═══════════════════════════════════════════════════════════════════════════════
PALETA (obrigatória, já aprovada no protótipo)
═══════════════════════════════════════════════════════════════════════════════

- Primary:   #1B3A6B  (azul corporativo profundo · uso amplo)
- Secondary: #E8981C  (laranja queimado · uso parcimonioso, destaques)
- Neutros:   #F7F8FA bg / #FFFFFF surface / #0F172A texto principal
- Status:    success #039855, warning #F79009, error #D92D20

═══════════════════════════════════════════════════════════════════════════════
NOME E CONCEITO DA MARCA
═══════════════════════════════════════════════════════════════════════════════

"Prospix" combina:
- "Prospect" (prospecto / pessoa abordada)
- "X" como sufixo de precisão/tecnologia (matrix, helix)

Pode evocar visualmente:
- Alvo / mira (precisão na escolha do lead)
- Conexão / fluxo (pipeline de prospecção)
- Letra "P" estilizada (monograma)
- Forma geométrica abstrata (ângulo / vetor / setas convergindo)

═══════════════════════════════════════════════════════════════════════════════
ENTREGÁVEIS OBRIGATÓRIOS
═══════════════════════════════════════════════════════════════════════════════

1. Logo wordmark horizontal "Prospix"
   → SVG editável, sem outline em fonts (paths convertidos)
   → variante full-color (sobre fundo claro)
   → variante reverse (branca sobre fundo primary #1B3A6B)
   → variante mono (preto sólido)
   Tamanhos exportados: SVG + PNG @1x/@2x/@3x em 32px e 64px de altura

2. Monograma quadrado (símbolo · funciona sozinho)
   → SVG editável
   → variantes full / reverse / mono
   → exportar como favicon e PWA icons (lista abaixo)
   → deve funcionar legível em 16px

3. Favicon multi-size
   → favicon.ico (multi-size: 16, 32, 48)
   → favicon-16.png, favicon-32.png

4. PWA / Touch icons
   → apple-touch-icon.png (180×180)
   → pwa-192.png (192×192)
   → pwa-512.png (512×512)
   → pwa-512-maskable.png (com safe area de 80% no centro)

5. Open Graph image
   → og-image.png (1200×630)
   → Conteúdo: wordmark + tagline "Prospecção que agenda por você"
   → Fundo gradiente sutil de #1B3A6B para #142C52
   → Pequena pattern geométrica decorativa no canto (opcional)

6. Twitter card image
   → twitter-card.png (1200×600)
   → Mesmo conceito do OG image

═══════════════════════════════════════════════════════════════════════════════
EVITAR (proibido)
═══════════════════════════════════════════════════════════════════════════════

- Cores fora da paleta (sem roxo, sem neon, sem gradiente arco-íris)
- Ícones de robô (cliché de IA · banido)
- Letras manuscritas, scripts, serifa decorativa
- Símbolos óbvios de seguros (escudo, guarda-chuva, família feliz, casa)
- Símbolos óbvios de WhatsApp (balão de fala, telefone verde)
- Símbolos óbvios de marketing (megafone, alvo com flecha cliché)
- 3D, sombras agressivas, biselado, glow
- Mais que 2 cores no logo

═══════════════════════════════════════════════════════════════════════════════
CHECKLIST DE QUALIDADE
═══════════════════════════════════════════════════════════════════════════════

- [ ] Logo legível em 16px (favicon)
- [ ] Logo funciona em background claro E escuro
- [ ] Contraste mínimo 4.5:1 em todas as variantes
- [ ] Monograma equilibrado (não top-heavy)
- [ ] Wordmark com tracking adequado (não esticado nem comprimido)
- [ ] SVG limpo (sem inline styles · usa attributes ou CSS classes)
- [ ] Arquivos otimizados (svgo para SVG, oxipng para PNG)
- [ ] Naming consistente: kebab-case em tudo

═══════════════════════════════════════════════════════════════════════════════
ENTREGAR
═══════════════════════════════════════════════════════════════════════════════

Salvar todos os arquivos em:
- apps/landing/public/  (acessíveis via prospix.com.br/<arquivo>)
- apps/web/public/      (cópia para o painel logado)
- apps/admin/public/    (cópia para super-admin)

Arquivos:
  logo-wordmark.svg
  logo-wordmark-reverse.svg
  logo-wordmark-mono.svg
  logo-mark.svg
  logo-mark-reverse.svg
  logo-mark-mono.svg
  favicon.ico
  favicon-16.png
  favicon-32.png
  apple-touch-icon.png
  pwa-192.png
  pwa-512.png
  pwa-512-maskable.png
  og-image.png
  twitter-card.png

Adicionar manifest.json em apps/landing/public/ e apps/web/public/:

{
  "name": "Prospix",
  "short_name": "Prospix",
  "description": "Prospecção inteligente via WhatsApp",
  "theme_color": "#1B3A6B",
  "background_color": "#F7F8FA",
  "display": "standalone",
  "start_url": "/",
  "icons": [
    { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/pwa-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}

═══════════════════════════════════════════════════════════════════════════════
APROVAÇÃO
═══════════════════════════════════════════════════════════════════════════════

Apresentar 2-3 opções de monograma + wordmark.
PM (Gustavo) escolhe direção antes de gerar os assets finais (favicon, PWA, OG).

Em caso de dúvida, perguntar ao PM antes de inventar.
```

---

## Checklist pós-entrega (PM revisa)

- [ ] Logo em alta resolução (`@2x`, `@3x`) sem perda
- [ ] Variante reverse aparece bem sobre `#1B3A6B`
- [ ] Favicon legível em browser tab (testar em Chrome, Safari, Firefox)
- [ ] PWA icons funcionam em iOS (touch icon) e Android (manifest)
- [ ] OG image preview em https://www.opengraph.xyz mostra wordmark legível
- [ ] Manifest válido (https://manifest-validator.appspot.com)
- [ ] Arquivos commitados nos 3 paths
- [ ] [docs/design-system.md](../design-system.md) seção 8 atualizada com paths reais
