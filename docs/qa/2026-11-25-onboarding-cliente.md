# Onboarding inicial do cliente — 25/11/2026

## Entrega

Guia automático na página Início, acima do painel e independente do carregamento dos indicadores. Rota própria /onboarding para retomar. Ordem: conectar WhatsApp → cadastrar primeiro contato → definir ICP → preencher perfil comercial/contexto → preparar roteiro ativo. Depois, links para agenda e campanha. O guia orienta a ordem, sem alterar permissões das rotas já existentes.

Cada etapa é confirmada no servidor: conexão WhatsApp pelo endpoint existente; lead não excluído no tenant; ICP existente; persona, descrição do negócio e tom de voz preenchidos; roteiro ACTIVE não arquivado. Progresso não é marcado manualmente nem armazenado no navegador. A preferência de minimizar é versionada por tenant e usuário. A chave global antiga é ignorada. Trocar identidade remonta guia e formulário; respostas da identidade anterior são descartadas. Atualização a cada 30 segundos com aba visível e rede, além de foco/retorno da conexão; a consulta continua depois do sucesso.

As telas de integrações, ICP e roteiros oferecem retorno aos primeiros passos. O tour explicativo antigo permanece por botão; a abertura automática foi retirada para não sobrepor o guia. Quando tudo está completo, o Início resume o guia. Em caso de erro, mostra mensagem e nova tentativa; não confirma etapa nem habilita a próxima ação com dados incertos.

## Primeiro contato

Nova tela /leads/novo. Nome e WhatsApp com DDD obrigatórios; e-mail e cidade opcionais. Mesma validação no formulário e na rota POST /api/onboarding/client. Normaliza DDD 55 sem confundi-lo com código do país. Erros por campo e foco no primeiro erro; botão bloqueado durante envio; rascunho preservado em falha. Chave da operação mantida no reenvio sem editar. Sucesso somente com id devolvido pelo servidor.

A rota deriva o tenant do perfil autenticado e grava com JWT do chamador e RLS. Não aceita tenant nem privilégios no corpo. Reutiliza o serviço createManualLead extraído de leadsQueries.create; os demais cadastros manuais continuam pelo mesmo serviço. Nenhuma conta Auth é criada. Nenhuma mensagem ou campanha é ativada ao cadastrar ou concluir o guia.

## Evidências

- Testes de regras/API: 164 passaram em 44 arquivos (.tmp/onboarding-tests.log).
- Typecheck depois da rota e serviço compartilhado: passou (.tmp/onboarding-types.log).
- Lint: passou após os ajustes finais de interface (.tmp/onboarding-lint.log).
- Build de produção final: passou com 89 páginas geradas, tipos verificados e rotas /onboarding, /leads/novo e /api/onboarding/client presentes (.tmp/onboarding-build.log).
- Playwright: sete cenários passaram (.tmp/onboarding-e2e.log), cobrindo conexão ausente/confirmada/indisponível, validação, reenvio, rascunho, cadastro confirmado e largura 320/390/1280. O cenário de entrada foi reexecutado no Início com a chave global antiga corretamente preenchida: passou (.tmp/onboarding-home-e2e.log). Axe sem violação séria/crítica nas duas superfícies novas. Capturas locais em .local/onboarding-qa; conferidas visualmente em 320 e 1280 px. Dados fictícios, APIs externas e WebSockets interceptados. Não é prova de integração real do provedor ou escrita no banco remoto.
- Publicação: main remoto e /api/version ainda 50d99dd2dff7a3085d54c8bfcabe0c0681620b0d na última consulta. Alterações locais sem commit. Usuário informou que Questboard publica automaticamente; confirmação do gatilho da esteira pendente.

## Limites e pendências independentes

Não aplica migration, não altera usuário ou organização em produção, não copia base comercial, canais ou templates. A migration de remoção de conversa ainda pendente é independente desta entrega. Nenhuma simulação foi gravada na conta nova.

O evento captured legado permanece auxiliar, sem nova transação com a criação do contato; o recibo do cadastro confirma o lead, não a entrega desse evento. Reenvio da mesma chave é protegido por id e releitura; a unicidade entre pedidos diferentes simultâneos para o mesmo telefone depende das regras legadas do banco. Não se declara auditoria completa de RLS nem homologação real do WhatsApp por esses mocks.

Arquivos da fatia: OnboardingChecklist.tsx; layout e Início do dashboard; remoção da abertura automática em AppShell; /onboarding; /leads/novo; lib/onboarding-progress, load-onboarding-progress, onboarding-client e manual-lead com seus testes; extração do método create em queries.ts; /api/onboarding/client com teste; e2e/web/onboarding.spec.ts; contrato em docs/api/onboarding.md e modelo de ameaças. O repositório já tinha alterações de preparação e operação anteriores; elas foram preservadas e não são declaradas publicadas por esta entrega.

## Reabrir o guia após novo login — 25/11/2026

Pedido: mostrar o novo onboarding na próxima entrada da conta cliente. O login de OWNER/ASSISTANT agora define como expanded somente a preferência versionada do usuário/organização autenticados, antes de abrir o Início. Não reseta etapas, contatos ou base comercial; administrador continua no painel próprio. Tanto o login comum quanto a entrada após troca obrigatória de senha usam o mesmo activateLoginSurface. Sem e-mail/UUID de cliente fixado no código e sem operação no banco.

Regressão em navegador: com a preferência minimized, login chegava ao Início sem mostrar a primeira ação (teste falhou antes). Depois, a mesma entrada mostrou Conectar WhatsApp e preservou a preferência de outra identidade. Oito cenários de navegador passaram (.tmp/onboarding-login-e2e.log), seis testes de regras/roteamento passaram (.tmp/onboarding-login-tests.log), lint da tela e typecheck completos passaram. Não foi repetido o build de produção para esta alteração pequena; login compilado e executado no Next local durante a prova.

Publicação: durante a conferência, /api/version avançou de 50d99dd para 2ce6f2b73163f639ceb840a5ef4f48577b1e1982, confirmando no ar o onboarding da entrega anterior. O ajuste para reabrir guia minimizado está apenas local, nos arquivos login/page.tsx e e2e/web/onboarding.spec.ts, aguardando a esteira automática do Questboard. Sem commit/push manual nesta rodada.

## Pop-up que conduz uma etapa por vez — 25/11/2026

Este é o formato final solicitado: o login abre imediatamente um diálogo nativo modal. A primeira ação é conectar o WhatsApp. Ao clicar na ação, o pop-up fecha e abre a tela correspondente; quando o estado real confirma a etapa, o pop-up reaparece pedindo a próxima ação. Ordem: WhatsApp → primeiro cliente → ICP → contexto comercial → roteiro ativo → conclusão. O usuário escolhe quando ir para a próxima tela; confirmar uma etapa não ativa campanha ou mensagem.

OnboardingFlow usa a mesma regra de progresso da entrega anterior. A sessão de acompanhamento guarda apenas abertura e etapa observada, com chave de usuário/organização em sessionStorage e fallback em memória. Esses valores não concluem etapas nem concedem acesso. Recarregar a página retoma o acompanhamento. Respostas anteriores à troca de rota/contexto são descartadas; eventos de gravação são relidos no servidor, nunca aceitos como prova de conclusão. O acompanhamento consulta a cada 20 segundos com aba visível e rede, e também ao retornar foco/rede e após as gravações pertinentes. Consulta em andamento acumula uma nova verificação para não perder o salvamento.

Fechar, Esc ou Continuar depois encerra o acompanhamento desta entrada. Atualização automática não reabre um pop-up dispensado. Contas já configuradas não repetem a sequência; finalizar as etapas durante o acompanhamento exibe a confirmação final. O painel administrativo não inicia o fluxo. A navegação de login deixou de esperar o temporizador de um segundo.

Notificações após confirmação: conexão ativa do WhatsApp, criação do primeiro contato, gravação do ICP, contexto comercial e roteiro. No cadastro de roteiro novo também passou a ser conferido o resultado da atualização complementar de status antes do aviso de sucesso. Nenhuma nova tabela, migration ou conta foi alterada em produção.

Provas: 170 testes em 45 arquivos passaram; 13 cenários de navegador passaram, incluindo a sequência completa, login real do formulário com respostas fictícias, retomada após reload e dispensa sem reabertura. Os três cenários de celular/paisagem foram reexecutados com verificação adicional de rolagem por teclado: passaram em 320×568, 375×812 e 812×375. Axe sem violação séria/crítica no diálogo; foco contido, Esc e CTA/rodapé acessíveis. Capturas em .local/onboarding-qa/popup-*.png. A sequência usa respostas de conexão/banco fictícias; o cadastro do contato passa pelo formulário real interceptado. As demais confirmações de gravação da sequência são simuladas por atualização do estado respondido, sem provedor ou banco real. Lint e typecheck passaram. Build final de produção passou com 89 páginas (.tmp/onboarding-popup-build.log).

Publicação deste pop-up ainda pendente pela esteira automática do Questboard. Base publicada confirmada antes desta fatia: 2ce6f2b. Nenhum commit/push manual executado. As notas anteriores de apenas expandir o guia inline são substituídas por este formato, sem apagar seu histórico.
