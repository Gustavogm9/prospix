# Onboarding — causa na integração WhatsApp

Data: 27/11/2026. Base: `49bab07d878d556fd598457b9eda794b6f29f7fd`.

## Evidência e causa

O onboarding consulta a conexão real e mais quatro grupos de cadastros. A investigação anterior confirmou a estrutura e as leituras dos cadastros. O aviso geral era disparado quando o status da conexão retornava `unavailable`. A mensagem foi revisada anteriormente, sem corrigir a integração.

Nesta rodada, a consulta somente leitura ao Evolution ativo retornou HTTP 200 e estado `open` para a instância de controle. A instância configurada no histórico da conta afetada retornou HTTP 404 com o corpo abaixo (identificador anonimizado). O mesmo estado já constava no recibo operacional de 19/11; a consulta de 27/11 confirmou que persiste. Nenhuma instância foi criada ou alterada por essa investigação.

```json
{"status":404,"error":"Not Found","response":{"message":["The \"qa_onboarding\" instance does not exist"]}}
```

`probeEvolutionConnection` convertia todo HTTP não-2xx em `unavailable`. A verificação agregada rejeitava esse resultado e exibia erro para a página inteira. Uma instância ainda não provisionada deve manter o WhatsApp pendente e permitir a geração do QR, sem invalidar os outros cadastros.

Segundo defeito: o host público do Evolution respondeu HTTP 401 com `WWW-Authenticate: Basic realm="traefik"`. O probe já incluía Basic através do helper existente, mas as três chamadas da rota de conectar (criação, webhook e QR) enviavam apenas `apikey`. Isso impedia a autenticação no proxy quando a proteção Basic estava configurada.

## Correção

- Normalização estrita do HTTP 404 estruturado do Evolution quando a mensagem identifica exatamente a instância consultada como inexistente: `disconnected`, motivo `instance_not_found`.
- HTTP 401/403/5xx, 404 de rota inválida e falhas de rede continuam indisponíveis; não são tratados como conectados ou desconectados por suposição.
- Conexão/QR usa o mesmo helper de autenticação Basic já utilizado pelo status. Credencial Basic só segue para o host explicitamente autorizado.
- Prazo de 5 segundos em cada uma das três chamadas de conexão; o cliente mantém seu prazo global e retry por ação explícita.
- Nenhuma mudança em permissões, provedor selecionado, dados da conta, campanhas, mensagens, esquema ou migrations.

## Testes e limites

Antes da correção: teste com a resposta 404 real anonimizada falhou recebendo `unavailable` em vez de `disconnected`; teste da rota QR falhou pela ausência do cabeçalho Basic.

Depois: 194 testes em 48 arquivos passaram; lint, tipos e build de produção passaram (90 páginas). A suíte completa de navegador no build de produção local passou: 21 cenários. Evidência em `.local/onboarding-instancia-qa/production/`. Cenário de navegador direcionado passou: instância ausente, quatro etapas preservadas, QR fictício na mesma tela e avanço/tour somente após conexão confirmada.

O navegador de teste usa rede interceptada, dado fictício e bitmap sintético. Não comprova pareamento real nem a presença das variáveis Basic no runtime da hospedagem. O acesso CLI disponível à hospedagem não possui o projeto publicado. Solicitada sessão do Prospix no navegador integrado para smoke autenticado. A versão pública inicial conferida foi a base acima.
