# Mapa de dados — prospecção e qualificação

Este mapa técnico não substitui a validação jurídica da base legal da prospecção pelo controlador.

| Dado | Titular | Finalidade | Classificação | Onde fica | Acesso | Retenção proposta | Operadores/suboperadores |
|---|---|---|---|---|---|---|---|
| nome, telefone, profissão e cidade | lead comercial | localizar, deduplicar e abordar | pessoal | `leads` | tenant e admin autorizado | enquanto houver finalidade; revisar em 90 dias após arquivamento | Supabase, Evolution |
| dados públicos de empresa/registro | lead/empresa | calcular aderência ao ICP | pessoal/comercial | `leads.metadata`, eventos | tenant e admin autorizado | mesma do lead | Google Maps, fontes cadastrais |
| mensagens | lead e operador | atender, classificar e provar consentimento/opt-out | pessoal | `messages`, fila | tenant e admin autorizado | definir com controlador; nunca indefinida | Supabase, Evolution, OpenAI |
| fatos de qualificação | lead | decidir se uma reunião faz sentido | pessoal comercial | `qualification_sessions`, `qualification_answers` | tenant e admin autorizado | mesma da conversa | Supabase, OpenAI |
| hash/ids de chamadas e custos | tenant | controle financeiro e auditoria | operacional | `provider_usage_events`, `provider_cost_ledger` | tenant (próprio) e admin | fiscal/contratual a definir | Supabase e provedores |
| opt-out | lead | impedir novo contato | pessoal essencial | `optouts` | serviço e tenant | enquanto necessário para respeitar a oposição | Supabase |

## Minimização aplicada

- Telefone e mensagem não entram em logs de aplicação; usam ids, hash ou contagem.
- O score interno e os motivos de elegibilidade não são enviados ao lead.
- Nesta fase não se coleta dado de saúde. A eventual ficha MetLife da Fase 2 exige base do art. 11, RIPD, consentimento/fluxo adequado e revisão jurídica antes de implementação.
- Dados sintéticos identificados são usados em teste e homologação.

## Pendências para o controlador/jurídico

- Confirmar base legal e transparência para primeiro contato por WhatsApp a partir de fontes públicas.
- Definir prazo definitivo de retenção de leads sem resposta, conversas e backups.
- Publicar canal do encarregado e processo para direitos do titular.
- Confirmar contratos/região e uso de dados por Evolution, OpenAI, Google e fontes de enriquecimento.
