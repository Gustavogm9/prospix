# QR do onboarding — bloqueio e carregamento

Data: 26/11/2026. Base: `930bdccb35eee0ec8b599645c1fb4e3a7ce78323`.

## Relato e reprodução

Na rota `/onbording`, botão de gerar QR desabilitado ou geração carregando sem terminar. O usuário confirmou esse comportamento. Consulta pública somente leitura a `https://prospix.com.br/api/version` retornou a base acima durante a investigação.

O botão dependia de `loading` e `progress` do conjunto de cinco consultas de progresso. Uma consulta pendente ou falha deixava a geração bloqueada, embora conectar o WhatsApp não dependa dos outros cadastros. Dois testes de navegador falharam antes da correção em `toBeEnabled()`, recebendo `disabled`: conferência pendente e conferência indisponível. Evidência local: `.local/onboarding-qr-block-red/`.

O prazo anterior era apenas um AbortSignal do fetch. `apiFetch` espera a sessão e eventual renovação antes do fetch; essa espera não é encerrada pelo sinal. Testes com operação e corpo que nunca resolvem falharam antes da correção: após 20 segundos o resultado continuava indefinido. Isso demonstra a lacuna de timeout; não comprova que a sessão de produção tenha travado.

## Correção

Geração disponível para OWNER sem aguardar progresso agregado, bloqueada somente enquanto outro pedido estiver em andamento. O endpoint autenticado e suas permissões permanecem. Avanço para a próxima etapa continua exigindo conexão confirmada pelo servidor.

Helper específico aplica prazo de 20 segundos a toda a operação: sessão, rede e leitura da resposta. No prazo, rejeita, cancela a requisição e a tela apresenta mensagem com nova tentativa. Mantidas validação/normalização do QR e proteção contra duplo clique. Sem mudança no provedor, banco, autenticação global ou backend.

## Verificação

- Regressões direcionadas: 3 cenários de navegador passaram após a correção, incluindo spinner encerrado e QR exibido após nova tentativa.
- Helper: 4 testes passaram. Suíte web completa: 182 testes em 47 arquivos passaram.
- Lint, tipos e build de produção passaram; 90 páginas geradas.
- A primeira suíte em desenvolvimento passou 19 cenários e falhou no carregamento após reload do fluxo completo (tela de sessão ainda carregando). Falha registrada em `.local/onboarding-qr-full/`; não houve alteração da guarda de sessão nem aumento do timeout do teste. A reexecução desse cenário no build de produção local passou, incluindo as cinco etapas e o tutorial final.

- No build de produção local (`next start`), a suíte completa de 20 cenários passou. Evidência: `.local/onboarding-qr-production/`.

As chamadas de navegador foram interceptadas com dados e imagem fictícios. Não houve pareamento, chamada real de conexão ou gravação em produção. Publicação e leitura com celular real dependem de confirmação separada; commit/push não comprovam deploy.
