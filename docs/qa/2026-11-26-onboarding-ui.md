# UI/UX do onboarding — 26/11/2026

Base local: `18f72d8f49c76bb0dec6ff480c05e60802cec9f5`.

## Entrega

O cartão central com limite de 768 px foi substituído por uma composição fluida de até 1680 px. Painel azul com marca e resumo das etapas no desktop; área principal com QR ou formulário; orientações contextuais aproveitam a lateral dos formulários em telas largas. Mantém uma única etapa editável por vez. O resumo não é um menu nem permite pular etapas.

Tipografia, campos, botões, contraste e espaçamento refinados com os tokens existentes do Prospix. Painel lateral sai do layout no celular, sem trocar a árvore dos formulários ou remontar QR ao redimensionar. QR fica antes das instruções no celular. Telas baixas de desktop usam cabeçalho mais compacto para aproximar a ação principal.

Estados de erro, carregamento, continuidade, confirmação do servidor e tutorial final preservados. APIs, polling, persistência, provedor de WhatsApp, regras de acesso e serviços de gravação não foram alterados. Nenhuma chamada real a provedor ou gravação em produção.

## Verificação

- 18 cenários existentes de navegador passaram: QR, falha/retry, cadastro, cinco etapas, ativação com falha/retry, tutorial e retomada.
- Após ajuste final de espaçamento/altura, QR desktop e móvel foram reexecutados: 2 passaram.
- Axe sem violações sérias/críticas nas superfícies verificadas. Nenhuma rolagem horizontal em 320, 390 e 1280 px; QR preservado ao redimensionar.
- Capturas de desktop, celular e formulários conferidas visualmente; QR sintético sem vínculo com aparelho ou conta.
- Lint, tipos e build de produção passaram; 90 páginas geradas.
- No build de produção local (`next start`), QR e sequência completa de cinco etapas até o tutorial final passaram: 2 cenários.
- Capturas finais do WhatsApp em `.local/onboarding-ui-2026-11-26/`, com QR ilustrativo.

Comandos: executáveis instalados de eslint/tsc, `playwright test e2e/web/onboarding.spec.ts --project=web --workers=1`, reexecução com `--grep 'gera QR na própria|QR Code cabe'`, e `next build`.

Evidência de navegador é local com rede interceptada. Publicação e versão do domínio não são comprovadas por esta rodada.
