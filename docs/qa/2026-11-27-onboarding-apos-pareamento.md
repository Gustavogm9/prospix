# Onboarding após ler o QR — 27/11/2026

Base: `59806c22f85f076c27b1f8ab12ecfa28cb1f7e6e`, confirmada no domínio no início da investigação.

## Relato e limites de reprodução

Usuário gerou QR, escaneou e apresentou captura do aparelho vinculado como ativo no WhatsApp. A tela do onboarding permaneceu na primeira etapa com erro agregado de progresso e erro de geração de QR. Conta desta ocorrência foi identificada no chat; não é a conta usada nas consultas administrativas anteriores. Não inferir que as provas anteriores de outra conta comprovam este caso.

A consulta somente leitura ao servidor de operação já mapeado retornou apenas a instância de controle conectada. Os domínios de Evolution presentes no histórico apontam para servidores distintos. Essa leitura não identifica a sessão da captura. Solicitado login na conta afetada no navegador integrado para validar o retorno autenticado do Prospix. Nenhum dispositivo foi desconectado, sessão reiniciada, QR real gerado, mensagem enviada ou dado de produção alterado pelo diagnóstico.

## Defeitos reproduzidos no código

1. `loadTenantWhatsAppChannel` escolhe o canal usado pelo status, mas a rota de conexão Evolution ignorava esse resultado e relia `tenant_secrets`. Com canal ativo e registro legado divergentes, QR e status usavam servidor/instância/chave diferentes. Teste falhou antes da correção: chamadas continuavam no host legado.
2. Sessão já aberta podia responder sem imagem QR. O backend não a reconhecia, e o cliente exigia uma imagem e lançava `QR_UNAVAILABLE`. Testes antes da correção falharam ao esperar resposta conectada e aceitação no cliente.
3. Prazo do progresso agregado não limitava a leitura do JSON após as cinco requisições resolverem. Teste com corpo que nunca termina falhou após 10 segundos, permanecendo sem resultado.

## Correção

- Conexão usa o mesmo resolvedor de canal que o status. Provisionamento legado permanece somente quando não há canal resolvido. Nenhum fallback muda o vínculo de um canal existente.
- Antes de criar/pedir QR, faz consulta autenticada ao canal escolhido. Se estiver aberto, retorna `connected` sem recriar instância, alterar webhook ou estado do guardião. Estado desconhecido retorna erro e impede escrita no provedor.
- Se o pareamento terminar durante a resposta do QR, reconfirma a conexão no provedor e retorna conectado. Ausência de QR sem conexão confirmada continua erro.
- O onboarding aceita resposta conectada, reconsulta o progresso e avança somente com confirmação do status. Configurações também aceita esse retorno.
- Prazo cobre toda a consulta de progresso, incluindo corpo da resposta. Falhas passam a identificar etapa e código seguros; o console registra apenas esses metadados, sem resposta bruta, identificador de conta, token ou dado do banco.

## Verificação

Regressões direcionadas verdes após a correção. Suíte completa: 203 testes em 48 arquivos passaram. Lint e build de produção passaram, incluindo checagem de tipos e geração das 90 páginas. Os 23 cenários de navegador no build de produção local passaram; evidência em `.local/onboarding-pareamento-qa/production/`. Fluxos de navegador verificam avanço automático pelo polling sem gerar outro QR e resposta já conectada sem alerta de QR. O relógio do cenário de polling é instalado antes da navegação; a primeira tentativa do teste falhou por instalar o relógio após a criação do intervalo nativo, sem apontar defeito do produto.

A validação de navegador usa rede interceptada e conta fictícia. A causa efetiva da falha nesta conta e o avanço após seu pareamento real continuam pendentes de acesso à sessão afetada; não declarar o relato encerrado com base nesses testes.
