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
