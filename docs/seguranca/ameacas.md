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

## RAG comercial e humanização da conversa — 16/10/2026

Escopo: cadastro e recuperação de conhecimento comercial por tenant e roteiro, montagem do contexto da IA, geração de resposta e trilha das fontes consultadas. Nível alvo: ASVS L1. O conteúdo da base é tratado como dado interno não confiável, nunca como instrução de sistema.

| ID | Fronteira | Ameaça (frase de abuso) | STRIDE | Ativo e classe | P × I | Controle | Teste | Dono/data |
|---|---|---|---|---|---|---|---|---|
| RAG-01 | Edge Function → banco | Uma conversa recupera conhecimento de outro tenant ou de outro roteiro | I, E | estratégia comercial/sigilo | média × alta | RLS, função com `search_path` fixo, validação do tenant atual e filtro explícito de `tenant_id` e `script_id` | tenant A não recupera item de B; roteiro A não recupera item exclusivo de B | engenharia, 16/10 |
| RAG-02 | editor → base → prompt | Texto cadastrado tenta substituir as regras do sistema ou solicitar segredo/ferramenta | T, I, E | integridade do prompt/segredos | média × alta | delimitação e sanitização, aviso explícito de conteúdo não confiável, conteúdo sem autoridade para comandar ferramentas | fechamento de tag e “ignore instruções” continuam apenas como texto | engenharia, 16/10 |
| RAG-03 | base → conversa | Rascunho, versão arquivada ou fato não aprovado fundamenta uma resposta | T, R | reputação/decisão comercial | média × alta | recuperação somente de registros `APPROVED` e ativos, com versão e origem auditáveis | rascunho e arquivado não aparecem na recuperação | engenharia, 16/10 |
| RAG-04 | mensagem → busca | Entrada gigante ou termos adversariais ampliam consulta, tokens e custo | D | orçamento/disponibilidade | média × média | consulta truncada, no máximo três trechos e orçamento rígido de caracteres | texto gigante produz contexto dentro do limite | engenharia, 16/10 |
| RAG-05 | material legado → rede | Um link interno ou malicioso faz o servidor buscar localhost, metadata ou rede privada | S, I | infraestrutura/segredo | média × alta | nenhum URL é baixado pelo webhook; link é somente metadado para o administrador | documento com URL privada não provoca requisição | engenharia, 16/10 |
| RAG-06 | IA → lead | O modelo inventa capacidade, preço, condição ou caso não presente nas fontes aprovadas | I, T | reputação/comercial | média × alta | fatos separados de técnicas comportamentais, instrução de admitir desconhecimento e Guardian pós-geração | pergunta sem fonte factual não recebe afirmação inventada | engenharia, 16/10 |
| RAG-07 | histórico → IA | Histórico sem papéis ou estado defasado faz a IA repetir saudação, pergunta ou dado já respondido | T | experiência/qualificação | alta × média | mensagens com papéis reais, mensagem inicial apenas no primeiro contato, estado estruturado e proteção determinística contra nova saudação nominal | após “30 por semana”, reconhece o volume e avança sem perguntar volume outra vez | engenharia, 16/10 |
| RAG-08 | base → log | Conteúdo comercial ou dado pessoal completo aparece em log de produção | I | sigilo/LGPD | média × alta | log apenas de ids, tipo, versão e contagem dos trechos; nunca conteúdo nem consulta bruta | inspeção de log não encontra texto da base nem mensagem do lead | engenharia, 16/10 |

### Decisões específicas

- A recuperação usa busca textual no PostgreSQL e não faz uma segunda chamada de IA nem usa embeddings nesta fase.
- A resposta recebe no máximo três trechos aprovados. Técnica comercial orienta comportamento; apenas registros factuais podem sustentar afirmações sobre produto, preço ou operação.
- A Edge Function falha de forma segura: indisponibilidade da busca remove o contexto adicional, registra somente metadados e não interrompe a conversa.
- O identificador e a versão de cada trecho utilizado são associados ao evento da conversa para auditoria, sem copiar o conteúdo para o log.
- Escrita da base fica restrita a proprietário do tenant e administrador Guilds; assistente pode consultar somente o próprio tenant.

## Remoção de conversa da esteira — 10/11/2026

Escopo: ação do corretor no painel, histórico da conversa, fila de WhatsApp e atualizações recebidas do provedor. Remover significa ocultar uma conversa da esteira e parar a IA nela; não apaga o cadastro do lead nem as mensagens.

| ID | Fronteira | Ameaça | Controle | Prova |
|---|---|---|---|---|
| CONV-01 | navegador → banco | Usuário remove conversa de outro tenant, sem perfil ou com acesso desativado | Função autenticada confere papel, tenant ativo e vínculo da conversa sob bloqueio de linha | chamada com sessão ausente, outro tenant e perfil inativo é negada |
| CONV-02 | banco → fila → WhatsApp | Mensagem já enfileirada sai depois da remoção | Transação encerra conversa e cancela pendências; worker relê `removed_at` antes do envio | pendência não é reclamada nem enviada depois da remoção |
| CONV-03 | webhook → esteira | Resposta posterior do lead ou atualização atrasada faz o cartão voltar | Histórico pode receber a mensagem, mas `removed_at` permanece; consultas e estado local filtram o cartão | atualização tardia e nova mensagem não reabrem o cartão |
| CONV-04 | interface → histórico | Clique acidental apaga evidência ou todas as conversas do mesmo lead | Confirmação nomeia o lead; só o ID da conversa é marcado; mensagens e lead são preservados; evento registra autor e horário | outra conversa do mesmo lead permanece visível; repetição é idempotente |

Risco residual: um envio externo iniciado no mesmo instante da remoção pode já estar em trânsito no provedor. A confirmação e o worker reduzem essa janela; o recibo do provedor continua sendo a fonte de verdade para esse caso.

## Onboarding do cliente — 25/11/2026

Escopo: guiar OWNER e ASSISTANT da organização autenticada por WhatsApp, primeiro contato, ICP, contexto e roteiro. Dados pessoais comuns (nome, telefone e e-mail opcionais); nenhuma informação sensível solicitada. Não cria usuários Auth, não amplia grants/RLS e não envia mensagens. A regra compartilhada de usuários corrigida nesta data é uma operação independente.

| Caso de abuso | Controle | Evidência e limite |
|---|---|---|
| Cliente tenta gravar em outra organização pelo corpo ou cabeçalho | Schema estrito recusa campos extras; tenant vem do perfil autenticado; escrita usa chave pública com JWT do chamador e RLS existente | route.test.ts recusa tenant no corpo e confere tenant autenticado e cliente com JWT; não substitui teste remoto de RLS |
| Anônimo, perfil excluído ou papel administrativo usa o novo cadastro | authenticateRequest existente valida sessão/perfil; rota exige OWNER/ASSISTANT com tenant | 401 e 403 nos testes de contrato; exclusão permanece coberta pelo helper existente |
| Telefone/e-mail inválido enviado diretamente à API | Mesmo schema Zod no formulário e na rota, com erro por campo | onboarding-client.test.ts e route.test.ts |
| Duplo clique ou resposta perdida duplica contato | Bloqueio local durante envio; UUID da operação mantido no reenvio sem editar; chave primária do lead; serviço relê operação no próprio tenant | manual-lead.test.ts verifica reenvio sem INSERT e recusa reaproveitamento para outro cliente. Pedidos diferentes simultâneos com mesmo telefone dependem da unicidade legada; esta fatia não cria constraint |
| Uma conta herda as etapas ou preferência de outra | Progresso consultado no tenant atual, componente remontado por tenant/usuário, respostas anteriores ignoradas; somente preferência de minimizar local e por identidade | onboarding-progress.test.ts e load-onboarding-progress.test.ts; teste visual ignora chave global antiga |
| Falha de integração vira etapa concluída | Erro explícito, sem habilitar próxima ação; polling continua após sucesso | testes de conexão indisponível e erro de banco; teste de tela simula queda |
| Conteúdo do contato executa HTML ou aparece em logs | React escapa texto; API não registra corpo; resposta de sucesso só devolve id | revisão do diff; não foi executado ataque em produção |

Modelo de acesso mantido: ambos os perfis do painel cliente podem cadastrar contatos pelo serviço existente; administrador Guilds usa seus fluxos administrativos próprios. Etapas visuais não são novas regras de autorização nem bloqueiam rotas já permitidas pelo produto. Sem campanhas ou envios automáticos ao concluir. Validação isolada com dados fictícios e rede interceptada; sem uso de conta real para os testes de tela.
