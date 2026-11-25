# Cadastro inicial do cliente

POST /api/onboarding/client — OWNER ou ASSISTANT com perfil ativo e organização, autenticado por Authorization Bearer. Entrada estrita: name, whatsapp, email e city; os dois últimos podem ser vazios. Exige Idempotency-Key UUID. O tenant é obtido no servidor; a escrita usa cliente com JWT do chamador, respeitando RLS. Não envia mensagens.

Sucesso 200: { id }. Erros: 400 para campos/chave inválidos, 401 sem sessão, 403 sem perfil permitido, 409 conflito, 503 falha de configuração ou gravação. Erros da rota usam { erro: { codigo, mensagem, campos? }, idCorrelacao }; recusas do helper de autenticação mantêm o contrato legado. Respostas próprias com Cache-Control: no-store. Duplicação por reenvio da mesma chave devolve o cadastro confirmado; outra entrada com a mesma chave é recusada. Não é endpoint de criação de conta Auth.

Implementação compartilha createManualLead com leadsQueries.create, preservando o serviço de cadastro manual já usado pelo produto. O evento captured legado continua sendo uma gravação auxiliar; esta fatia não adiciona transação entre lead e evento, nem nova constraint por telefone.
