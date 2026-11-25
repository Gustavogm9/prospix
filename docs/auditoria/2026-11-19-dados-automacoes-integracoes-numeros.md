# Prospix: dados, automações, integrações e auditoria de números

Data: 19/11/2026. Escopo: código no commit `50d99dd2dff7a3085d54c8bfcabe0c0681620b0d`, recálculo das fórmulas e consulta somente leitura ao banco de produção às 15h47 de São Paulo. A rota pública `/api/version` devolveu o mesmo SHA nesta data. Isso confirma a versão web publicada; o snapshot do banco abaixo complementa a verificação, sem comprovar a saúde dos provedores externos nem a versão de todas as Edge Functions.

## Dados do primeiro cliente

- Há contexto documentado: corretor parceiro MetLife em São José do Rio Preto, público inicial de médicos, linguagem de proteção de renda e objetivo de prospecção/qualificação (`docs/PRD.md:4`, `docs/discovery.md:42`). Há um endereço de login anotado em `supabase/seed.ts:198`, mas essa anotação não comprova o estado atual do acesso.
- Existe uma configuração inicial específica no banco, se a migration foi aplicada e seus IDs guardados ainda correspondem ao tenant: campanha, roteiro, ICP e contexto comercial (`supabase/migrations/20260930172000_giovane_metlife_alignment.sql:6`, `:28`, `:173`, `:195`, `:236`). A própria migration deixa campanha pausada e descoberta automática desligada (`:195`). É material de configuração, não comprovação de aprovação pelo corretor.
- O cadastro exige nome da operação, identificador, plano, mensalidade, nome do proprietário, e-mail válido e WhatsApp. Template, chave OpenAI própria e nome da instância WhatsApp são opcionais. A instância ainda requer conexão depois (`apps/web/src/app/admin/tenants/novo/page.tsx:15`, `:111`, `:386`, `:425`; `apps/web/src/app/api/admin/tenants/route.ts:28`). Portanto, **e-mail é necessário para identidade/convite de acesso; não é necessário conectar a caixa postal para a prospecção por WhatsApp**.
- Antes de ativar uma campanha real, faltam confirmação pelo cliente do e-mail/WhatsApp de acesso, produto e alegações permitidas, critérios do ICP, público/cidades, limites de volume/custo, exemplos reais anonimizados de conversa, respostas a objeções, material comercial aprovado, horários/calendário e número de WhatsApp autorizado. O checklist de discovery pede esses materiais (`docs/discovery/checklist-pre-sessao.md:12`, `docs/discovery/formulario-async.md:20`). Não há evidência de que esses itens tenham sido todos recebidos ou aprovados.

## Automações encontradas no código

| Fluxo | Para que serve | Evidência e limite |
|---|---|---|
| Descoberta diária | Busca leads nas fontes habilitadas de campanhas ativas | `supabase/migrations/20260930171000_prospecting_cron_alignment.sql:96`; `supabase/functions/discover-leads/index.ts:1760`. Depende de `discovery_auto_enabled`; não confirma que uma campanha específica esteja ativa. |
| Enriquecimento e validação | Acrescenta dados públicos/empresariais e elegibilidade dos leads | `supabase/migrations/20260930171000_prospecting_cron_alignment.sql:87`; `supabase/functions/enrich-leads/index.ts:392`. A disponibilidade varia por fonte e chave. |
| Envio inicial e fila | Envia abordagem e respostas já enfileiradas com limites e guardiões | `supabase/migrations/20260930171000_prospecting_cron_alignment.sql:86`; `supabase/functions/send-messages/index.ts:1`, `:289`. Depende de campanha, canal e controles de saída. |
| Respostas por WhatsApp | Recebe webhook, classifica intenção, gera resposta por IA e enfileira envio | `supabase/functions/webhook-evolution/index.ts:3`, `:1544`, `:3335`; WAHA também possui webhook próprio. |
| Acompanhamento | Detecta conversa parada há 24 h e prepara follow-up sujeito a bloqueios | `supabase/migrations/20260930171000_prospecting_cron_alignment.sql:88`; `supabase/functions/process-followups/index.ts:227`, `:304`. |
| Monitoramento administrativo | Verifica pendências/desconexões e pode enviar alerta/relatório no WhatsApp | `supabase/migrations/20260722082000_admin_monitoring_dedicated_cron.sql:126`; `supabase/functions/admin-monitoring-dispatcher/index.ts:1033`. |
| Solicitação de indicação | Pode pedir indicação após fechamento, com critérios de segurança | `supabase/functions/cron-referrals/index.ts:288`. Não há agendamento correspondente em `supabase/migrations` nem em `apps/web/vercel.json`; execução automática não comprovada. |
| Resumo diário no painel | Cria notificações internas de atividade | `apps/web/src/app/api/notifications/daily-summary/route.ts:12`. A rota diz que um cron a chama, mas `apps/web/vercel.json` não contém `crons`; agendamento externo não comprovado. |
| Agenda Google | A tela de agenda cria reunião e, se conectada, tenta enviar ao Calendar | `apps/web/src/app/(dashboard)/agenda/page.tsx:260`. Esse é um fluxo iniciado pelo usuário. O comando `schedule_meeting` da IA só altera status e cria notificação; não cria reunião com data/horário nem evento no Google (`supabase/functions/webhook-evolution/index.ts:3360`). |

## Integrações e estado verificável

| Integração | Necessidade para a jornada | Estado verificado |
|---|---|---|
| Supabase Auth e banco | Essencial para contas, leads, conversas e campanhas | Consulta Management API ao banco de produção concluída em 19/11 às 15h47. Operação do cliente com status ACTIVE. O login Auth não foi testado. |
| Evolution API ou WAHA | Essencial para envio e recebimento no WhatsApp | Conexão, estado e webhooks implementados (`apps/web/src/app/api/integrations/whatsapp/connect/route.ts:17`, `status/route.ts:600`). Sem confirmação do canal externo hoje. |
| OpenAI | Essencial para classificação/resposta automática atual | Chamadas no webhook e no worker (`supabase/functions/webhook-evolution/index.ts:941`, `supabase/functions/send-messages/index.ts:1451`). Chave/uso atual não verificados. |
| Google Maps Places e provedores CNPJ | Necessários se a descoberta/enriquecimento automáticos dessas fontes forem usados | Chamadas implementadas (`supabase/functions/discover-leads/index.ts:614`; `supabase/functions/enrich-leads/index.ts:392`, `:511`). Chaves, quotas e chamadas recentes não verificadas. |
| Google Calendar | Necessário se a promessa for agendar na agenda do corretor | OAuth, leitura e escrita implementados (`apps/web/src/app/api/integrations/google/oauth/route.ts:18`, `apps/web/src/app/api/integrations/calendar/sync/route.ts:9`, `push-event/route.ts:7`). Há um refresh token salvo para o cliente, sem teste de validade ou chamada ao Google. O agendamento automático ponta a ponta não está implementado no fluxo da IA. |
| E-mail | Necessário como identificador da conta; caixa postal não é requisito do fluxo atual de WhatsApp | Não foi encontrada integração ativa com Gmail/Outlook, SMTP, Resend ou envio de e-mail no aplicativo. O cadastro cria conta Auth diretamente com e-mail confirmado (`apps/web/src/app/api/auth/invitations/redeem/route.ts:53`). Eventuais e-mails nativos do Supabase exigem verificação da configuração externa. |
| Asaas | Só necessário se cobrança automática for parte da oferta | A interface menciona Asaas, mas não há cliente/API/webhook Asaas no código atual; a tela administrativa registra pagamento offline manual (`apps/web/src/app/admin/faturamento/page.tsx:84`). A afirmação pública de integração automática não está comprovada (`apps/web/src/app/page.tsx:82`). |

A página administrativa de configurações monta os cartões de integrações com estado fixo `unverified`; ela não é um teste de saúde dos provedores (`apps/web/src/app/admin/configuracoes/page.tsx:54`). Na agenda, a resposta HTTP da tentativa de envio ao Google não é inspecionada e uma exceção é registrada apenas no console; a confirmação da interface ainda diz que o compromisso foi sincronizado (`apps/web/src/app/(dashboard)/agenda/page.tsx:280`, `apps/web/src/lib/api-fetch.ts:15`). Isso pode dar um falso positivo ao operador.

## Auditoria manual dos números

1. **Indicadores de demonstração exibidos como números.** Na página pública, 1.420 capturados, 840 com WhatsApp, 382 respondidos, 180 qualificados, 42 reuniões, 137 conversas e cerca de 12 segundos estão escritos no componente (`apps/web/src/app/page.tsx:238`, `:259`, `:266`). Recalculei: 840/1.420 = 59,15% (59% exibidos); 382/1.420 = 26,90% (27%); 180/1.420 = 12,68% (**deveria arredondar para 13%, não 12%**); 42/1.420 = 2,96% (3%). Esses valores são ilustração, não medição do cliente.
2. **Receita projetada usa premissas fixas.** O início usa `reuniões de hoje × 30 × 35% × R$ 5.500`, rotulando o resultado como projeção de 90 dias (`apps/web/src/app/(dashboard)/inicio/page.tsx:607`). Recalculei: uma reunião hoje produz R$ 57.750, mostrado como R$ 58 mil; duas produzem R$ 115.500, mostrado como R$ 116 mil. Não há evidência de que 30, 35% e R$ 5.500 sejam dados aprovados do cliente. Não deve ser apresentado como previsão confiável.
3. **MRR, lucro e margem misturam períodos e fontes.** O painel admin soma MRR dos tenants ativos/em onboarding e subtrai **todos os registros históricos** de `tenant_usage`, sem filtrar mês (`apps/web/src/app/admin/(dashboard)/page.tsx:25`, `:32`, `:47`, `:52`, `:65`). Recalculei com exemplo simples: MRR R$ 150 e custo R$ 20 em cada um de dois meses → painel mostra R$ 110 e 73,3%; usando somente o mês atual seriam R$ 130 e 86,7%, antes de outros custos. O texto chama o MRR de “faturado via Asaas” e o saldo de “lucro líquido real” (`:124`, `:136`), embora a fonte seja valor contratual e contador de custos estimados. O ledger de custo verificado do provedor é separado de `tenant_usage` (`supabase/migrations/20260729170000_provider_cost_ledger.sql:1`).
4. **Preços públicos divergentes.** A página pública fixa R$ 290/490/890 (`apps/web/src/app/page.tsx:451`), enquanto a configuração admin fixa R$ 150/350 (`apps/web/src/app/admin/configuracoes/page.tsx:29`). Nenhuma das duas listas lê o contrato do tenant. Precisam de aprovação comercial antes de apresentar preço.
5. **Erro de consulta pode parecer zero.** O resumo de hoje devolve contagens `0` quando a consulta falha e usa início de dia em UTC (`apps/web/src/app/api/dashboard/today/route.ts:10`, `:27`, `:32`). Às 22h de São Paulo, UTC já está no dia seguinte; o “hoje” deixa de cobrir a manhã e a tarde locais. A consulta alternativa do painel também substitui erro por zero (`apps/web/src/lib/queries.ts:2511`). Zero não prova ausência de atividade.
6. **Alegações comerciais não verificadas.** A landing exibe um depoimento/case nominal do primeiro cliente como texto fixo (`apps/web/src/app/page.tsx:555`), sem evidência no repositório de aprovação ou medição correspondente. Não usar como resultado comprovado.

## Verificação do banco de produção em 19/11/2026, 15h47

Fonte: `.tmp/audit-prospix-live-2026-11-19.json`, produzido por `.tmp/audit-prospix-live-2026-11-19.ps1` via Supabase Management API com `read_only=true`, após conferir o projeto vinculado. O token não foi salvo no resultado.

### Operação vinculada ao e-mail do cliente

| Item | Resultado |
|---|---|
| Operação do cliente | ACTIVE |
| Campanhas ativas | 0 |
| Campanhas ativas com descoberta automática habilitada | 0 |
| Canal ativo, habilitado para envio e com status CONNECTED em `whatsapp_channels` | 0 |
| Última checagem de canal ativo nessa tabela | Sem registro |
| Credencial Google Calendar armazenada | 1 refresh token |
| Roteiros com status ACTIVE | 12 registros |
| ICPs | 3 registros |
| Conhecimento comercial aprovado e ativo | 0 registros |
| Contexto comercial em `tenant_business_context` | 0 registros |
| Descobertas com sucesso ou falha nos últimos 7 dias | 0 registros |
| Mensagens recebidas nos últimos 7 dias | 0 registros |
| Mensagens enviadas com ID de provedor nos últimos 7 dias | 0 registros |
| Eventos de uso de provedor com sucesso nos últimos 7 dias | 0 registros |

Zero campanhas ativas impede a jornada de prospecção dessas campanhas. Os roteiros e ICPs registrados não substituem a ativação da campanha e a base comercial validada. A implantação da RAG no teste interno anterior não comprova que o tenant do cliente esteja alimentado: ele não tem nenhum item aprovado ativo na consulta.

O resultado de canal cobre `whatsapp_channels`. O código pode recorrer à configuração antiga em `tenant_secrets` (`supabase/functions/_shared/whatsapp-provider.ts:281`), que esta consulta não examinou. Portanto, não há comprovação de conexão funcional do WhatsApp, mas tampouco se conclui somente por essa contagem que inexista configuração legada. Presença de token Calendar não comprova autorização válida.

### Agendamentos do servidor

Os oito jobs consultados estão ativos, incluindo as variantes de sábado. Nas últimas 24 horas, o agendador registrou:

| Rotina | Execuções com sucesso no agendador | Falhas no agendador |
|---|---:|---:|
| Monitoramento administrativo | 288 | 0 |
| Descoberta diária | 1 | 0 |
| Enriquecimento | 36 | 0 |
| Acompanhamento | 18 | 0 |
| Envios | 108 | 0 |

As variantes de sábado não tinham execução nas últimas 24 horas; a última execução registrada foi em 14/11, coerente com o calendário. O total de 451 sucessos refere-se à execução do comando SQL agendado. Como o cron agenda requisições com `net.http_post`, esse sucesso **não comprova** resposta HTTP bem-sucedida da Edge Function ou execução comercial. Isso é compatível com zero atividade recente no tenant do cliente.

### Reconferência com os valores reais do banco

O consolidado administrativo retornou R$ 890,00 de MRR contratual; quatro registros históricos de consumo somam R$ 7,70. Não existe registro de consumo do mês corrente.

Pela fórmula do painel: R$ 890,00 − R$ 7,70 = **R$ 882,30**, e R$ 882,30 ÷ R$ 890,00 × 100 = **99,1348%**, exibido como **99,1%**. A aritmética está coerente, mas a classificação como lucro líquido real está incorreta: o cálculo mistura mensalidade com consumo histórico e não concilia faturas, pagamentos e demais despesas. Ausência de registros no mês corrente não comprova custo real zero.

### Conclusão e pendência

Foram conferidos código, versão web publicada, registros operacionais do banco e fórmulas com os valores retornados. **Não houve revisão humana independente nem conciliação com faturas dos provedores.** A operação do cliente não está pronta para comprovar a jornada automática: falta campanha ativa, não há base comercial aprovada/contexto cadastrado e a conexão externa de WhatsApp/Calendar ainda precisa de teste. Também permanece a lacuna de agendamento automático identificada no código. Pendências: validar materiais e configurações com o cliente, conferir a configuração legada do canal, testar WhatsApp/IA/Calendar com contato autorizado e comparar custos com faturas/exportações reais antes de apresentar resultados comerciais.

## Correções autorizadas em 19/11/2026, após a auditoria

A base comercial foi preparada no tenant do cliente e relida às 16h21: 11 orientações/restrições aprovadas, contexto, novo roteiro e campanha de demonstração pausada. Nenhuma campanha real foi ativada. A consulta ao provedor confirmou a instância interna em estado open; a instância antiga do cliente retornou 404. A validação da agenda e o pareamento do cliente permanecem pendentes.

Os problemas de números, rótulos e confirmação de calendário foram corrigidos no código e cobertos pela regressão. O release do backend parou antes de qualquer escrita por falta de backup recente confirmado. O código da interface ainda não foi publicado, pois o endereço antigo da esteira abriu outra tela. Estado, evidências e roteiro de conclusão: `docs/qa/2026-11-19-preparacao-apresentacao.md`. Os achados acima são o retrato anterior às correções, não a afirmação de que a configuração comercial continua vazia.
