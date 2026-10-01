# Ciclo de desenvolvimento do Prospix

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
