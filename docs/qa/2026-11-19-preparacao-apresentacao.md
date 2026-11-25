# Preparação da apresentação do Prospix

Autorização: pedido de 19/11/2026 para corrigir e validar WhatsApp, agenda, base comercial e números do painel. Publicação pela esteira do Questboard, conforme preferência do usuário. Escopo de mensagem real restrito ao contato interno já autorizado; campanhas de clientes permanecem pausadas durante a preparação.

## Critérios de aceite e roteiro

1. Painel lê contratos e consumo do mesmo mês em America/Sao_Paulo; ausência de registro aparece como não apurado. Falha do banco aparece como erro. A apresentação não usa projeções sem dados ou depoimentos não comprovados.
2. WhatsApp consulta a instância do canal ativo e exige estado operante do provedor. Testar entrada e resposta no contato interno autorizado, com ID do provedor; não inferir conexão pelo registro antigo.
3. Agenda lê o Google e confirma criação somente com recibo de evento e vínculo persistido. Nova tentativa do mesmo evento não duplica. Falha mostra reunião local salva e sincronização pendente. Autorizações inválidas exigem reconexão pelo titular.
4. A base comercial contém orientações consultivas, restrições e fatos com origem confirmada. Não contém prêmio, cobertura ou estatística sem aprovação. No cliente, preparar contexto e roteiro sem liberar disparos públicos.
5. Executar regressão, tipos, lint e build. Verificar desktop e celular. Conferir banco antes da publicação e SHA depois dela.
6. Demonstração: entrar como OWNER, conferir conexão, abrir um lead de teste, qualificar sem inventar fatos, encaminhar para atendimento e criar uma reunião identificada como QA TESTE sem convite de terceiros. Conferir o evento e o painel.

## Linha de base

- Web publicada e código local: `50d99dd2dff7a3085d54c8bfcabe0c0681620b0d`.
- 32 arquivos / 132 testes passando antes das alterações; typecheck sem erros.
- O comando pnpm disponível tentou reinstalar dependências e falhou por acesso à rede; as verificações usam os executáveis locais já instalados.
- Banco: histórico remoto comum com local; migration `20261110110000` ainda ausente. A web já contém consultas a `removed_at`; aplicar a migration revisada é dependência para validar a interface.
- Provedor consultado em leitura às 16h09: instância interna `open` (HTTP 200); instância do cliente devolveu 404. A tabela antiga não era prova de conexão.
- Consulta Google pela interface publicada: a tentativa retorna sem confirmação visível. O código ignorava resposta HTTP de erro. Autorização salva não foi aceita como prova de funcionamento.

## Evidências e pendências

- Testes de regressão escritos e executados antes das correções: duplicação/recibo Google, mês/fuso e erro convertido em zero.
- Aguardar resultados finais das verificações locais e do teste externo. Não há aprovação de prontidão enquanto WhatsApp e Calendar não tiverem confirmação ponta a ponta.
- Uma conta humana do cliente precisa confirmar materiais e operar o pareamento/autorização das suas contas quando necessário. Senhas, tokens e telefones não entram neste relatório.

## Resultado desta rodada

| Área | Evidência | Estado |
|---|---|---|
| Base comercial | Ensaio com ROLLBACK e releitura após aplicação: 11 itens aprovados, contexto presente, novo roteiro, campanha pausada, saída de IA pausada | Aplicado em produção às 16h21, sem mensagens |
| WhatsApp interno | Consulta direta ao provedor: HTTP 200, estado open | Estado operante confirmado; entrada e resposta desta rodada ainda pendentes |
| WhatsApp do cliente | Consulta à instância cadastrada: HTTP 404 | Exige configuração e pareamento pelo titular |
| Google Calendar | Credencial armazenada, porém leitura/escrita ainda sem comprovação completa | Exige validação e eventual reconexão pelo titular |
| Indicadores | Período e fuso corrigidos; estimativa identificada; ausência de consumo não vira zero; retiradas projeção e alegações sem fonte | Corrigido localmente |
| Agenda | Recibo obrigatório, conflito de ID reconciliado sem novo evento, falha de vínculo vira pendência; status salvo reconfirmado no Google | Corrigido localmente, com regressão |
| Atendimento da IA | Pedido de reunião é encaminhado à equipe; sem confirmação falsa de reserva. A criação do evento é feita pela agenda | Corrigido localmente |
| Regressão | 39 arquivos / 148 testes passando; tipos, lint e Deno sem erro | Verificado localmente |
| Release de backend | Preflight parou com `RECENT_BACKUP_NOT_CONFIRMED_NO_WRITES_PERFORMED` | Nenhuma migration nem função publicada nesta rodada |
| Interface | Endereço antigo do Questboard abriu Testgrounds, sem painel de projetos | Aguardando endereço atual da esteira; código ainda não publicado |

O build de produção local final passou após os últimos ajustes de texto e onboarding. Saídas resumidas em `.tmp/presentation-final-tests.log`, `.tmp/presentation-final-lint.log`, `.tmp/presentation-final-build.log` e `.tmp/presentation-edge-check.log` (arquivos locais de evidência, sem credenciais).

A página pública do build foi aberta no navegador: exemplos fictícios, preços sob consulta e explicação do encaminhamento humano presentes. O controle de viewport retornou larguras efetivas diferentes das solicitadas e a captura ficou parcial; não se declara revisão visual completa de desktop/celular nem teste das telas autenticadas corrigidas. A prévia local foi encerrada após a conferência.

### O que mudou no produto

- O painel administrativo usa mensalidades contratuais e consumo estimado do mesmo mês. Não chama esse saldo de lucro líquido e não usa faturas Asaas inexistentes como origem.
- O início exibe conversas como conversas e registros históricos como histórico; não converte contagem de conversas em mensagens ou pessoas, não inventa atualização há 14 segundos e não afirma que uma campanha pausada está rodando.
- O gráfico de leads mostra a quantidade atualmente registrada em cada etapa. Descartes e vendas não são convertidos em recibos de mensagem ou reserva; o gráfico não declara conversão para reunião sem evento confirmado.
- O checklist de WhatsApp consulta o estado real; histórico de conversa não comprova conexão atual.
- A página pública identifica a demonstração como fictícia, corrige o arredondamento e deixa os preços sujeitos ao contrato. O exemplo comercial não é apresentado como depoimento medido de cliente.
- As telas de conexões e agenda mostram confirmação, falha ou verificação pendente em vez de inferir sucesso a partir de uma chave salva.

### Integrações e limites da apresentação

| Integração | Para que serve | O que foi confirmado nesta rodada |
|---|---|---|
| Supabase | Acesso, cadastros, conversas e filas | Leitura e preparação comercial com releitura confirmadas. Uma migration antiga continua pendente por backup não confirmado. |
| WhatsApp / Evolution | Receber e enviar mensagens | Instância interna respondeu `open`; instância cadastrada do cliente respondeu 404. Recebimento e resposta novos ainda não foram exercitados. WAHA é alternativa, não uma segunda conexão obrigatória. |
| Google Calendar | Consultar agenda e criar eventos | Existe autorização salva; ela não comprova funcionamento. Faltam leitura e evento QA confirmados no Google. O fluxo atual exige que a equipe registre a reunião; a IA encaminha o interesse. |
| Provedor de IA | Gerar respostas e qualificar com roteiro e base comercial | Código e verificações locais conferidos. Falta uma nova conversa completa com recibos após publicação. |
| Google Maps e enriquecimento | Buscar e complementar contatos | Implementação identificada; não foi feita nova captura nesta rodada. Campanhas e descoberta automática do cliente permanecem pausadas. |
| E-mail | Identidade de acesso e possível destinatário de convite do Calendar | Não existe automação de caixa de entrada ou campanha por e-mail comprovada nesta versão. Convite do Calendar depende da criação efetiva do evento e da opção de envio. |
| Cobrança | Registrar contratos, pagamentos e consumo | Integração automática Asaas não implementada. Estimativas de consumo não são faturas nem lucro auditado. |

Os cálculos foram refeitos e confrontados com os registros consultados. Não houve conferência independente por uma pessoa nem conciliação com faturas nesta rodada; esse aceite permanece pendente.

### Portões externos restantes

1. Backup recente confirmado ou exceção explícita do dono para a migration aditiva já versionada, conforme `olima-migrations`; nunca declarar restauração ensaiada sem evidência.
2. Endereço atual do Questboard, publicação do commit com CI e conferência do SHA servido.
3. Pareamento do número do cliente e autorização Google válida pelo titular.
4. Teste de mensagem com resposta e recibo no contato interno autorizado, criação de evento QA sem convite de terceiros e conferência dos registros.
5. Conferência humana e aceite do material comercial; faturas reais para validar despesas cobradas.

**A apresentação ponta a ponta ainda não está homologada.** O status só muda após os portões externos e os testes de destino.
