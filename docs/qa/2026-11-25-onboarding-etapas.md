# Onboarding por etapas e carregamento — 25/11/2026

Base: `928d4ac74d384e55f7703c76d5f8882203036a8d`. Ambiente local, sem gravação em banco ou provedor real.

## Relatos e causa reproduzida

A tela aguardava todas as respostas antes de mostrar qualquer etapa. Dois componentes consultavam o mesmo progresso. O status do WhatsApp aguardava diagnósticos do guardião, canal candidato, monitor de IA e outras consultas operacionais antes de ler a conexão ativa. Uma resposta pendente mantinha o cliente em Conferindo sem deadline.

O teste de navegador com a resposta bloqueada falhou antes: nenhuma etapa era mostrada. Testes de contrato também falharam antes porque a leitura de conexão acionava diagnósticos pesados e não havia cancelamento da espera. Depois, a etapa aparece ainda durante a conferência; o status leve não toca os diagnósticos e o deadline aborta a espera em 10 s. Nenhum dado ausente por erro é marcado como confirmação.

## Entrega

Uma tela por etapa em `/onbording`: QR do WhatsApp, cliente, perfil ideal, negócio e roteiro. As quatro gravações usam os serviços/fluxos existentes e a confirmação real do servidor. A última exige revisão explícita e status ACTIVE antes de avançar ao tutorial Como funciona. O formulário de cliente é compartilhado com `/leads/novo`; chave idempotente e validação existentes preservadas.

Consulta única de progresso no layout, compartilhada com a tela. Polling de 20 s só com aba visível/rede, além de foco e avisos após salvamento. Identidade inclui usuário e tenant; componentes e respostas anteriores são descartados ao trocar. QR só é gerado por ação do OWNER, usando o provedor ativo existente; não é salvo no navegador ou no log, e não comprova conexão sozinho. Fica antes das instruções no celular e não dispara novamente ao redimensionar.

Campos preservados após falha. O ID do roteiro já criado é reutilizado em nova tentativa de ativação; o teste falha a ativação e prova uma única criação. Continuar depois e retomada por menu preservados. A URL anterior continua redirecionando.

## Evidência

- 178 testes em 46 arquivos passaram, incluindo deadline e contrato leve por perfil/tenant.
- Teste de regressão antes: 6 falhas nos contratos/timeout e uma falha em navegador por etapa ausente; passaram após a correção.
- Primeira rodada da suíte a partir da raiz usou cwd incorreto para testes que leem `src/`; repetida em `apps/web`, sem alteração nos testes de contrato legados, passou.
- Navegador: rodada final com 18 cenários passou. Reexecução visual do QR móvel também passou após o ajuste de contraste do progresso. Inclui fluxo completo sem sair de `/onbording`, QR com falha/retry, uma única chamada de status, ativação com falha/retry sem duplicar roteiro, retomada, tutorial e ausência de rolagem horizontal.
- Tipos: passou após colocar abortSignal antes de maybeSingle, conforme a API instalada.
- Lint final e `git diff --check`: passaram.
- Build de produção: passou, com tipos e geração de 90 páginas. O servidor de desenvolvimento foi encerrado antes do build, sem disputa por `.next`.
- Navegador no build de produção (`next start`): 2 cenários passaram, cobrindo QR inline e as cinco etapas com falha/retry na ativação e tutorial final. Service workers bloqueados no harness para preservar a interceptação de rede. Nenhum provedor real chamado.
- Contratos/deadline reexecutados após o ajuste final de tipos: 11 testes passaram.
- Capturas com QR sintético, sem vínculo com aparelho/provedor: `.local/onboarding-wizard-qa/whatsapp-desktop.png`, `whatsapp-320.png`, `whatsapp-390.png` e etapas de formulário. Layout conferido visualmente.

Tentativa somente leitura de `/api/version` público expirou em 20 s nesta máquina; não foi possível confirmar SHA publicado nesta rodada. Não se atribui esse timeout de rede à causa do relato. Provas de desempenho e navegação aqui são locais com rede controlada, sem alegar tempo real de produção. Nenhuma migration, policy, campanha, conta ou segredo alterados.

## Comandos

- Em `apps/web`: `node_modules/.bin/vitest.cmd run --maxWorkers=2`, `node_modules/.bin/tsc.cmd --noEmit --incremental false`, `node_modules/.bin/next.cmd build`.
- Na raiz: `node_modules/.bin/eslint.cmd apps/web/src` e `node_modules/.bin/playwright.cmd test e2e/web/onboarding.spec.ts --project=web --workers=1`.
- Mesma suíte em `next start`, limitada a `--grep 'gera QR na própria|conclui as cinco'`, passou em modo produção local.

A entrega não exige migration. Dados criados pelo wizard mantêm o formato já utilizado pelas seções existentes. Publicação no domínio permanece uma etapa distinta do commit/push.
