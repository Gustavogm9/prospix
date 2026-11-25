# Checklist de entrega — Prospix — 25/11/2026

Referência: conta nova solicitada nesta conversa, sem aproveitar dados da operação anterior. Evidências: auditoria de 19/11, correções incluídas na interface publicada, isolamento e login de 25/11, fonte atual e nova regressão dos números. Relatório de estado; não é aceite integral de entrega.

## O que pode ser confirmado

- Site publicado e login renderizado. /api/version retornou 578761c34680d514dfbb79e5d2172d083351506e nesta rodada; esse commit altera documentação e sucede o 54cf8c7 que contém o pop-up. Login real e abertura inicial do pop-up têm evidência registrada na rodada anterior.
- Identidade e perfil OWNER da conta nova foram criados/alinhados, em organização exclusiva. A operação de separação foi verificada com login real e base comercial vazia. Nenhuma carteira, campanha ou conversa anterior foi copiada. Cadastro administrativo de acesso é diferente de injetar dados comerciais.
- O e-mail de acesso existe e é conhecido. Registro do acesso no Questboard não foi conferido; não foi localizada rotina no código do Prospix que transmita esses cadastros ao Questboard. Isso não prova ausência de alguma rotina externa nem determina a causa da falta do registro.
- Onboarding em pop-up publicado e testado localmente com 13 cenários e 170 testes totais da web na última entrega; abertura inicial observada na conta real. A transição real ao parear WhatsApp ainda não foi observada.

## Dados que faltam para configurar a conta nova

Número/pareamento do WhatsApp autorizado; descrição da operação e produtos/serviços; público ideal, região e critérios de qualificação; roteiro, objeções e alegações permitidas; horários e limites de envio/custo; contato inicial autorizado; autorização do calendário se usado; condições contratuais aprovadas para preencher valores administrativos. Não inferir dados do primeiro cliente ou da conta de homologação para esta conta nova.

## Automações inventariadas

| Automação | Finalidade | Limite de comprovação |
|---|---|---|
| Descoberta programada | Buscar contatos nas fontes de campanhas configuradas | Depende de fonte, credencial, orçamento e campanha ativa |
| Enriquecimento/validação | Complementar e validar dados públicos dos contatos | Cada fonte requer teste próprio |
| Abordagem e fila | Enviar mensagens nos horários/limites configurados | Canal conectado e recibo do provedor são necessários |
| Atendimento e qualificação por IA | Entender respostas, seguir roteiro e registrar qualificação | Necessita contexto/base aprovada e conversa real de teste |
| Follow-up | Retomar conversas paradas conforme regras | Sujeito a pausa, cadência e bloqueios |
| Encaminhamento à equipe | Sinalizar atendimento humano e interesse em reunião | Não comprova reserva automática de horário no Google |
| Monitoramento/alertas | Detectar filas, falhas e desconexões | Jobs agendados não provam execução comercial bem-sucedida |
| Onboarding sequencial | Reconhecer configuração salva e mostrar próximo passo | Abertura real provada; transição real WhatsApp ainda pendente |
| Indicações pós-venda e resumo diário | Pedidos de indicação/notificações | Código existe; agendamento automático não comprovado |

## Integrações

- Essenciais: Supabase Auth/banco; um provedor WhatsApp (Evolution ou WAHA); provedor de IA.
- Para busca automática: Google Maps e fontes públicas de enriquecimento configuradas.
- Para sincronizar agenda com Google: Google Calendar autorizado pelo titular.
- E-mail: endereço usado na identidade de acesso. Integração de caixa postal/campanha de e-mail não identificada. Entrega de mensagens nativas de Auth exige validação externa própria.
- Cobrança: registro manual/contratual; integração automática Asaas não implementada. Não é pré-requisito técnico da prospecção, salvo promessa comercial específica.

Implementação atual de WhatsApp é não oficial: o conector Evolution usa integration WHATSAPP-BAILEYS (connect/route.ts:273); WAHA é alternativa por sessão/QR. Evolution também oferece modo oficial Cloud, mas esse modo não foi encontrado na implementação do Prospix. Referências do fornecedor: https://github.com/evolution-foundation/evolution-api/blob/main/README.md e https://waha.devlike.pro/ . Classificação não comprova que o número da conta nova esteja conectado.

Auth/banco e abertura inicial do pop-up têm prova de uso real na conta nova. WhatsApp, IA, Calendar e fontes de descoberta não têm validação completa registrada nessa conta. Testes internos e configurações antigas de outra organização não fecham esses itens.

## Auditoria dos números: feito e pendente

Auditoria por IA/código e recálculo registrados em docs/auditoria/2026-11-19-dados-automacoes-integracoes-numeros.md. Correções publicadas: período/fuso alinhados, cálculo mensal de consumo, estimativa distinguida de lucro, projeção sem base retirada, exemplos públicos identificados como fictícios e preços sob consulta. Reexecução atual: nove testes em quatro arquivos passaram (financial-summary, lead-stage-summary, sao-paulo-time e dashboard/today), saída .tmp/checklist-numeros-2026-11-25.log.

Pendências encontradas na revisão atual:
- AppShell.tsx:123 fixa campaigns em 0; linhas 111–129 não conferem HTTP e substituem erro/dado ausente por zero nos contadores laterais. Não é a mesma consulta corrigida da tela principal.
- AppShell.tsx:290 mostra Plano Profissional de forma fixa, sem ler o plano contratado.
- configuracoes/page.tsx ainda usa rótulos Assinatura Ativa (Asaas)/Faturas Asaas, embora a integração automática não tenha implementação identificada.
- Landing mantém números ilustrativos fixos com aviso de dados fictícios. Não usar como resultado do cliente.
- Não há registro de conferência humana independente nem conciliação de custos com faturas dos provedores.

Portanto, a atividade de auditoria foi realizada, mas o item global números sem hardcode e integralmente validados ainda não pode ser encerrado. Os achados desta revisão foram registrados; nenhum código ou dado de produção foi alterado nesta rodada.

## Itens que continuam abertos no checklist

Registro/conferência dos acessos no Questboard; dados e materiais comerciais necessários; pareamento e teste real de WhatsApp com avanço do pop-up; conversa completa de IA; Calendar com leitura/evento confirmado; fontes de captura/enriquecimento quando ofertadas; revisão dos valores/rótulos fixos acima; conferência humana dos números e das despesas reais. Pendência de migration/release de backend de rodadas anteriores não é autorizada ou resolvida por este relatório.
