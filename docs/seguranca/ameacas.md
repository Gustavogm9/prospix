# Modelo de ameaças — prospecção, custos e qualificação

Data: 30/09/2026. Escopo: `/api/discover`, `discover-leads`, `enrich-leads`, Evolution, billing e estado de qualificação.

## Ativos e fronteiras

- Dados pessoais comerciais: nome, telefone, profissão, localização e histórico da conversa.
- Autoridade de envio do WhatsApp e reputação do número.
- Orçamento de Google Maps, CNPJá, busca, IA e mensageria.
- Configuração de campanha, ICP, roteiro e estado de qualificação.
- Fronteiras: navegador → Next.js; Next.js → Supabase; Edge Function → provedores; webhook → Edge Function; billing → importador.

## STRIDE

| ID | Fronteira | Ameaça (frase de abuso) | STRIDE | Ativo e classe | P × I | Controle | Teste | Dono/data |
|---|---|---|---|---|---|---|---|---|
| A-01 | navegador → `/api/discover` | Usuário anônimo inicia chamadas pagas | S, E, D | orçamento | alta × alta | JWT obrigatório, origem conferida e rota `no-store` | contrato: anônimo = 401; origem externa = 403 | engenharia, 30/09 |
| A-02 | rota → banco com service role | Usuário escolhe `tenant_id` ou campanha de outro tenant | E, I | multi-tenant/pessoal | alta × alta | gate atômico valida usuário, tenant, papel, campanha e fonte | matriz: outro tenant = 404/403 | engenharia, 30/09 |
| A-03 | rota → provedor | Clique duplo ou retry duplica a busca e o custo | T, D, R | orçamento | alta × alta | idempotency key + constraint única + execução com estados | duas requisições paralelas = uma execução | engenharia, 30/09 |
| A-04 | navegador/cron → descoberta | Campanha pausada, fonte desabilitada ou tenant suspenso continua consumindo | E, D | orçamento/reputação | alta × alta | validação no início e antes de cada lote | testes para cada estado negado | engenharia, 30/09 |
| A-05 | Edge → provedores | Chamadas reais de descoberta, enriquecimento ou mensageria não entram na contagem quando o lead é duplicado ou a resposta falha | R, T | custo | alta × alta | reserva do evento antes da chamada, com atribuição a tenant/campanha/run/lead; erro de ledger impede a chamada | fixture: erro/duplicata ainda conta | engenharia, 30/09 |
| A-06 | billing → ledger | Arquivo repetido duplica custo ou linha de outro tenant é atribuída | T, E | financeiro | média × alta | checksum, `external_row_id` único, prévia e import admin | reimportação = zero novas linhas; tenant inválido = 400 | engenharia, 30/09 |
| A-07 | webhook → conversa | Evento repetido ou fora de ordem cria duas respostas | T, R | reputação | alta × alta | assinatura/segredo, ledger do evento e idempotência de outbound | replay = sem novo efeito | engenharia, 30/09 |
| A-08 | IA → lead | Modelo inventa fato enriquecido ou revela score interno | I, T | pessoal/reputação | média × alta | fatos permitidos, score nunca exposto e Guardian de personalização | saída com score/placeholder é bloqueada | engenharia, 30/09 |
| A-09 | IA → qualificação | Modelo marca qualificado sem evidência ou empilha perguntas | T, E | decisão comercial | alta × média | estado estruturado, evidência por mensagem, regras determinísticas e G09 | sem campos obrigatórios não qualifica; >1 pergunta bloqueia | engenharia, 30/09 |
| A-10 | conversa → armazenamento | Dado de saúde é coletado sem base legal ou aparece em log | I | pessoal sensível | média × alta | fase atual proíbe coleta de saúde; log só com ids/hash | prompt e teste recusam saúde; varredura de logs | produto/jurídico, antes da Fase 2 |
| A-11 | credencial → provedor | Chave legada ou embutida é usada no enriquecimento | S, I | segredo | alta × alta | validação de WhatsApp exige canal ativo sem fallback legado; segredo somente no servidor | varredura do código e teste de fallback estrito | engenharia, 30/09 |
| A-13 | lead → crawler | URL pública enriquecida redireciona para rede privada ou metadata da nuvem | S, I | infraestrutura/segredo | média × alta | somente HTTP/S público, portas permitidas e validação de cada redirecionamento | suíte com localhost, IP privado, IPv6 e credenciais na URL | engenharia, 30/09 |
| A-14 | configuração → enriquecimento | Integração premium ativa no tenant dispara custo em toda campanha | T, D | orçamento | alta × alta | `deep_enrichment=true` obrigatório por campanha e custo unitário positivo | política: tenant ativo + campanha sem opt-in = bloqueado | engenharia, 30/09 |
| A-15 | fonte externa → prompt | Metadado enriquecido injeta instrução ou faz a IA revelar score interno | T, I | reputação/pessoal | média × alta | valores achatados, limitados e delimitados como dados não confiáveis; score não entra no prompt | teste com quebra de linha e fechamento de tag | engenharia, 30/09 |
| A-12 | scheduler → workers | Jobs rodam fora da ordem ou janela e acumulam fila | D, T | custo/reputação | média × alta | descoberta → enriquecimento → envio, janela BRT e kill switch | inspeção de runs e cron sintético | operação, 30/09 |

## Decisões de segurança

- `service_role` continua somente no servidor e só depois do gate de autorização.
- A campanha pausada e o kill switch do tenant prevalecem sobre fila, follow-up e resposta reativa; a única exceção é QA explícita, auditada e restrita ao lead exato da allowlist.
- Não há coleta de peso, altura, doença ou histórico familiar nesta entrega.
- Homologação usa registros `QA TESTE` e um contato previamente autorizado; nenhuma base real de terceiros recebe mensagem.
