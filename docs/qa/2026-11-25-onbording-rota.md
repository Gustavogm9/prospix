# Onboarding em rota separada — 25/11/2026

Base: `578761c` em `main`, com alterações locais desta fatia. Ambiente: local. Nenhum commit, push, publicação ou gravação remota executados nesta rodada.

## Comportamento

- `/onbording` é a rota dedicada, com a mesma guarda de sessão do dashboard, sem o menu e as outras seções.
- `/onboarding` redireciona para `/onbording`; o cadastro de contato também retorna para a nova URL.
- O login inicia a conferência existente. Se houver pendência, encaminha para o guia; contas já configuradas seguem para o painel sem repetir a sequência.
- Os links continuam usando os formulários e integrações existentes. A confirmação de cada etapa retorna para a rota dedicada, em vez de abrir o guia por cima da seção.
- A conclusão das cinco etapas encaminha ao painel e abre o mesmo tutorial Como funciona, reutilizado pelos botões manuais.
- A abertura automática é consumida antes de mostrar o tutorial; fechar ou atualizar não o reabre.
- Continuar depois encerra o acompanhamento desta entrada. O menu Primeiros passos permite retomar, preservando os cadastros confirmados.
- O tutorial recebeu semântica de diálogo, descrição acessível, foco contido, Esc, botão de fechar rotulado e conteúdo rolável em telas pequenas. A rolagem do fundo fica bloqueada enquanto o diálogo está aberto.
- As boas-vindas no painel apontam para a nova rota, sem mencionar um checklist abaixo.

## Verificação

- Caracterização das regras antes da alteração: 12 testes em 3 arquivos passaram.
- Suíte local: 170 testes em 45 arquivos passaram.
- Lint: passou sem erros.
- Navegador: 15 cenários distintos validados. A rodada ampla teve 12 aprovados e 3 falhas de harness: o cenário completo buscava o cartão Como funciona como botão, e dois cenários de celular semeavam a sessão tarde demais, depois da hidratação. Corrigidos para acionar o botão Tour de 2min e semear a sessão antes de carregar a página. Reexecução do cenário completo: 1 aprovado; dos três tamanhos do tutorial: 3 aprovados.
- A conferência visual identificou deslocamento causado pela rolagem do fundo do tutorial. Corrigidos posicionamento e bloqueio da rolagem; os três cenários foram reexecutados após essa última alteração, todos aprovados, com asserção de scroll do documento preservado e controles visíveis após End. Capturas finais conferidas em `.local/onboarding-qa/tutorial-*.png` e `onboarding-390.png`.
- Axe sem violações sérias/críticas nas superfícies exercitadas; guia e formulário sem rolagem horizontal em 320, 390 e 1280 px. Tutorial conferido em 320×568, 375×812 e 812×375; foco contido e fechamento por Esc/controle real.
- Tipos: passou com arquivos gerados estáveis. A primeira checagem coincidiu com a regeneração de `.next/types` pelo servidor de desenvolvimento; foi repetida sem o conflito.
- Build final de produção: passou, incluindo checagem de tipos e geração das 90 páginas. A rota `/onbording` e o redirecionamento `/onboarding` constam no resultado.
- A suíte de 170 testes foi repetida após os ajustes finais de interface e passou novamente. Lint final também passou.

Os cenários de navegador usam dados fictícios e interceptam rede, sem alterar banco ou provedores. A prova local não confirma publicação.

## Arquivos prévios preservados

`docs/qa/2026-11-25-onboarding-cliente.md` já estava modificado e `docs/qa/2026-11-25-checklist-entrega.md` já existia como arquivo não rastreado antes desta tarefa. Esta entrega não os edita.

## Comandos locais

Executáveis já instalados foram usados porque o pnpm do ambiente tentou reorganizar as dependências e abortou sem TTY; nenhuma reinstalação foi forçada.

- Na raiz: `node_modules/.bin/eslint.cmd apps/web/src`.
- Em `apps/web`: `node_modules/.bin/tsc.cmd --noEmit --incremental false`, `node_modules/.bin/vitest.cmd run --passWithNoTests --maxWorkers=2` e `node_modules/.bin/next.cmd build`.
- Na raiz: `node_modules/.bin/playwright.cmd test e2e/web/onboarding.spec.ts --project=web --workers=1`; reexecuções focadas com `--grep 'acompanha etapas'` e `--grep 'Como funciona acessível'`. Rede e dados fictícios interceptados no próprio spec; navegador contra servidor local de desenvolvimento, build de produção verificado separadamente.
