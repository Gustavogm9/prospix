# Ciclo de desenvolvimento do Prospix
## Pop-up de configuração após login — 25/11/2026

Formato final pedido: diálogo automático no login, uma etapa por vez; ao confirmar o dado real, reabre para pedir a próxima ação. WhatsApp → cliente → ICP → contexto → roteiro → conclusão. A navegação entre etapas depende de clique explícito. Fechar/Esc/Continuar depois encerra o acompanhamento até nova entrada, sem reabrir por polling. Sessão por identidade/organização, restaurada após reload; marcações locais não concluem etapas. Sem escrita no banco ou envio automático nesta fatia. O ajuste anterior de apenas expandir o guia foi substituído pelo diálogo.

Validação local: 170 testes, 13 cenários de tela, conferência adicional de teclado/rolagem em três tamanhos, lint e typecheck passaram; build final de produção passou com 89 páginas. Prova de sequência usa dados fictícios e APIs interceptadas. Relatório: docs/qa/2026-11-25-onboarding-cliente.md. Base pública confirmada 2ce6f2b; pop-up e avanço por etapa ainda aguardam publicação automática do Questboard. Nenhum commit/push manual nesta rodada.
## Onboarding inicial do cliente — 25/11/2026

Implementado localmente: guia no Início e /onboarding, com sequência WhatsApp → primeiro contato em Meus Leads → ICP → perfil comercial → roteiro ativo; depois, agenda e campanha. Progresso confirmado pelos dados da própria organização; preferência de minimizar isolada por usuário/tenant; marcações globais antigas ignoradas; atualização continua após conexão. Cadastro do contato valida no cliente e no servidor, grava pelo serviço manual compartilhado com JWT do usuário/RLS e protege reenvio da mesma operação. Não cria conta Auth, não copia base de outro cliente e não ativa mensagens. Tour explicativo só por escolha explícita para não cobrir a configuração inicial.

Provas: 164 testes de regras/contratos, lint e typecheck passaram; sete testes de navegador passaram com dados fictícios e rede interceptada, incluindo sucesso e falha do cadastro, acessibilidade e 320/390/1280 px. Entrada no Início revalidada com a chave antiga marcada como dispensada/concluída. Build de produção final passou com 89 páginas e rotas novas geradas. Relatório: docs/qa/2026-11-25-onboarding-cliente.md; contrato: docs/api/onboarding.md. Sem nova migration ou operação em produção nesta fatia. Publicação ainda não confirmada: main remoto e versão pública permanecem 50d99dd; usuário informou Questboard automático e foi solicitado esclarecer o gatilho da esteira. Alterações anteriores preservadas. Sem commit desta fatia até este registro.
## Correção: cliente novo e conta vazia em 25/11/2026

O usuário esclareceu que Gustavo Macedo é um novo cliente e solicitou começar a conta do zero. O vínculo anterior com a Corretora de Teste resultou de uma suposição incorreta do executor; ele é revogado por esta correção. Escopo: criar espaço exclusivo `gustavo-macedo`, id `dda78e66-575f-45d4-b136-4d7ad5dc4de7`, sem copiar dado comercial ou credenciais; manter identidade, e-mail, senha e papel OWNER; limpar nome/dados herdados de perfil; deixar o cadastro em ONBOARDING, com configuração inicial padrão e nenhum valor de contrato atribuído. Dados e acessos das outras pessoas da corretora compartilhada são preservados. Saída automática fica pausada até configuração.

Roteiros: `ops/2026-11-25-separate-new-client.sql` e executor de mesmo nome. Guardas de identidade/tenant, cópia local cifrada do perfil anterior (DPAPI, limitada ao usuário Windows; não é backup completo do projeto), ensaio com ROLLBACK, comparação das contagens da origem, verificação de todas as tabelas de negócio vazias no novo tenant, alinhamento Auth pela API oficial, teste com login real e encerramento global das sessões de renovação dessa conta. Não há migration ou exclusão de dados da corretora de teste. Execução concluída e relida em 25/11/2026: perfil e Auth alinhados ao novo tenant; um perfil e uma identidade; login com senha atual confirmado; dados comerciais zerados; perfis de administradores fora do tenant negados; sessões de renovação dessa conta encerradas globalmente. Os dois outros membros e registros da Corretora de Teste foram preservados. Recibo: `.local/new-client-2026-11-25/result.json`. Registro da decisão: novo cliente recebe organização própria; domínio de e-mail igual não autoriza compartilhar dados.

## Alteração de senha solicitada em 25/11/2026

O dono solicitou uma senha específica para a conta cliente já identificada. Autorização restrita a `gustavo.macedo@guilds.com.br`, id `2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9`, preservando o perfil OWNER da Corretora de Teste. A senha não é registrada neste documento nem no executor; será digitada em campo mascarado no terminal externo. A escolha explícita do dono é uma exceção pontual à recomendação de comprimento, sem reduzir a política global do Auth; permanece o risco de uma senha curta ser mais fácil de adivinhar. Não inclui troca obrigatória no próximo login. Roteiro em `ops/2026-11-25-set-client-password.ps1`: confirmação de projeto/identidade/perfil, atualização pela API oficial, autenticação com a nova senha, leitura do próprio perfil com essa sessão e encerramento apenas da sessão de verificação. A troca foi confirmada no recibo `.local/client-password-2026-11-25/result.json`: atualização, autenticação com a nova senha e leitura do perfil verificadas; sessão de teste encerrada.

## Acesso de cliente solicitado em 24/11/2026

Autorização: "Liberar acesso de cliente para esse email no sistema gustavo.macedo@guilds.com.br". Destino adotado: Corretora de Teste, seguindo os acessos OWNER anteriores. Consulta confirmou uma identidade Auth válida e um perfil GUILDS_ADMIN sem tenant com identificador divergente. Roteiro em `ops/2026-11-24-grant-client-access.sql` e executor: alinhar o perfil à identidade existente e converter para OWNER; preservar senha e demais campos, exigir outro Super-Admin confirmado, recusar histórico vinculado, ensaiar com ROLLBACK e verificar RLS antes da aplicação. Não altera schema, Auth, campanhas ou mensagens. Resultado confirmado em 24/11/2026 às 22h11 de Brasília: identidade, perfil e permissões Auth alinhados como OWNER da Corretora de Teste; um perfil ativo, nenhum duplicado e dois outros Super-Admins preservados. Ensaio e aplicação passaram nas leituras própria e de outro tenant. Senha preservada. Recibo local: `.local/client-access-2026-11-24/grant-result-v4.json`.



## Preparação de apresentação autorizada em 19/11/2026

Pedido atual: corrigir e validar WhatsApp, agenda, base comercial e números. O relatório e o roteiro desta rodada estão em `docs/qa/2026-11-19-preparacao-apresentacao.md`. A autorização cobre as correções, a preparação comercial e o teste no contato interno previamente autorizado; campanhas de terceiros não são liberadas por essa preparação. Publicação da web pelo Questboard. O estado abaixo registra a fase histórica e não substitui as evidências desta rodada.

## Estado atual

Implementação local concluída e aguardando aprovação para aplicar em produção. A campanha do tenant de homologação permanece pausada, o kill switch global continua ligado e nenhuma mensagem foi enviada.

## Fatia em andamento

| Fatia | Valor para o usuário | Risco principal | Estado |
|---|---|---|---|
| Prospecção controlada e qualificação estruturada | Buscar leads com custo atribuível, conversar de modo humano e registrar por que um lead foi ou não qualificado | disparo indevido, custo sem limite e mistura entre tenants | implementada localmente; produção bloqueada por aprovação |

## Escopo aprovado em 30/09/2026

1. Manter a campanha sem disparo automático durante a intervenção e usar o controle global do tenant como contenção.
2. Proteger a descoberta por autenticação, autorização do tenant, idempotência, rate limit e orçamento.
3. Alinhar campanha, ICP, roteiro e contexto ao caso real Giovane Carrara/MetLife, inicialmente para médicos de São José do Rio Preto.
4. Validar WhatsApp pelo canal Evolution ativo do tenant.
5. Corrigir Google Maps, execução automática, histórico e agendamentos.
6. Persistir a qualificação consultiva por critério e por evidência.
7. Separar telemetria estimada de billing real e atribuir custo a fonte, campanha, execução e lead.
8. Homologar primeiro com 10 a 20 leads sintéticos, uma fonte por vez, com parada por custo.

Fora desta fatia: rotação de segredos, coleta de dado de saúde no WhatsApp e retomada irrestrita das campanhas.

## Critérios de aceite

- Uma requisição sem sessão, de outro tenant, com campanha pausada ou fonte não habilitada não inicia descoberta.
- Repetir a mesma chave de idempotência produz uma única execução.
- Toda chamada externa de descoberta ou enriquecimento gera um evento operacional atribuído.
- Billing importado nunca é apresentado como estimativa; estimativa nunca é apresentada como billing.
- O Google Maps registra Text Search e cada Place Details, inclusive quando o lead é duplicado ou não é inserido.
- O worker automático usa `capture_sources`, `search_tags`, cidades, estado, limites e apenas campanhas ativas.
- Enriquecimento e follow-up não avançam campanha pausada.
- Enriquecimento premium só roda quando a campanha habilita `deep_enrichment` explicitamente; ativação no tenant não basta.
- A validação de WhatsApp usa `whatsapp_channels`, sem chave embutida no código.
- A exceção de homologação mantém o kill switch global ligado e só aceita campanha ativa, modo QA e lead exato em allowlist não expirada.
- A qualificação registra fatos, confiança, mensagem de origem, campos pendentes, pontuação e disposição.
- A IA faz no máximo uma pergunta objetiva por mensagem e não coleta saúde nesta fase.
- Homologação sintética passa com 10 a 20 leads e o teto interrompe a execução.
- Testes, typecheck, lint sem erros, Edge Functions e build de produção ficam verdes antes de publicar.

## Portões restantes

- [x] migrations revisadas estaticamente e teste SQL pós-deploy preparado
- [ ] migration validada no projeto vinculado e aprovada para produção
- [ ] Edge Functions publicadas e verificadas
- [ ] frontend publicado e verificado no commit auditado
- [ ] billing real fornecido por export/API dos provedores
- [ ] rodada controlada no contato autorizado, sem terceiros
- [ ] aceite para retomar a campanha

A primeira tentativa de ensaio foi revertida com OWN_TENANT_NOT_VISIBLE: o verificador omitia app_metadata exigido pelas policies legadas. O roteiro passa a simular as permissões OWNER/tenant pretendidas; o executor lê e alinha as mesmas permissões pela API administrativa oficial do Auth antes de confirmar o perfil. Não escreve diretamente em auth.*. Verifica os dois lados e restaura o escopo anterior se o perfil permanecer inalterado após falha. Execução concluída e relida no recibo v4; não é necessário repetir a operação.

Diagnóstico adicional do executor: o encapsulamento de Invoke-RestMethod em @() preservava o array JSON como um item; o filtro selecionava o conjunto e a conversão para string concatenava valores anon e service_role, causando HTTP 401. Reproduzido com duas chaves fictícias: seleção anterior incorreta e leitura direta correta. Ajustada a atribuição, com recusa de chave não escalar/espaços e validação local de papel/referência do JWT antes da chamada. Nenhuma chave foi impressa ou rotacionada. Estado remoto permanece inalterado até nova execução confirmada.

### Ensaio de isolamento e policy compartilhada — 25/11/2026

O ensaio de conta vazia foi interrompido porque três perfis de administradores eram visíveis ao cliente por uma policy antiga que checava o papel da linha, não o papel do chamador. Preparada migration `20261125135500_fix_user_tenant_visibility.sql`, com guardas do catálogo atual. Ensaio conjunto passou: conta vazia, leitura de outros usuários negada, administrador legítimo preservado, anônimo negado; restauração da policy em savepoint também passou. Nenhuma mudança persistida. Backup completo recente não confirmado; há cópia da policy, retorno ensaiado e cópia local cifrada do perfil. Aplicação aguardando autorização específica para esta regra compartilhada e exceção de backup limitada a esta operação. Evidência: `docs/qa/2026-11-25-cliente-novo-isolamento.md`.
### Autorização específica recebida em 25/11/2026

Resposta do dono à pergunta que descreveu a policy compartilhada, criação do espaço vazio e ausência de backup completo recente: "Autorizar esta correção específica com as cópias e reversão descritas". Autoriza exclusivamente a migration `20261125135500_fix_user_tenant_visibility` e a operação `2026-11-25-separate-new-client`. Exceção de backup restrita a esta aplicação: cópia da policy e sua reversão ensaiada, mais perfil anterior cifrado localmente; essas cópias não recuperam o restante do banco. Não se declara backup completo ou restauração global. Nenhum dado comercial da corretora compartilhada será removido. Não autoriza outras migrations, incluindo a de remoção de conversas ainda pendente.
Resultado final da correção compartilhada: migration 20261125135500 e separação da conta confirmadas na mesma transação após a aprovação específica. Testes com OWNER, administrador legítimo e anônimo passaram; sessão real do novo cliente confirmou ausência de dados e de acesso ao tenant anterior. WhatsApp, Calendar e conhecimento comercial não foram copiados. Nenhum envio ou campanha ativados. A pendência 20261110110000 permanece independente desta operação.

### Próximo login e publicação do onboarding — 25/11/2026

Versão pública 2ce6f2b confirmada: onboarding anterior publicado pela esteira escolhida. Ajuste local adicional no login expande o guia apenas para a identidade autenticada, mesmo se ela o minimizou antes, preservando etapas e dados. Teste em navegador falhou antes e passou depois; oito cenários de tela, seis testes de regras/roteamento, lint e typecheck passaram. Nenhuma conta ou dado de produção alterados. Esse ajuste adicional aguarda publicação automática pelo Questboard; sem commit/push nesta rodada. Evidência em docs/qa/2026-11-25-onboarding-cliente.md.
