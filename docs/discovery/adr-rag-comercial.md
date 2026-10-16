# ADR — RAG comercial contextual por tenant e roteiro

Data: 16/10/2026. Estado: aceito para implementação local; publicação depende de aprovação.

## Contexto

A resposta reativa recebia o histórico como um único texto, reaplicava a mensagem inicial em todos os turnos e anexava apenas URLs de materiais. O modelo não tinha uma fonte recuperável de habilidades ou fatos comerciais, o que favorecia saudações repetidas, perguntas já respondidas e afirmações sem fundamento.

## Decisão

- Guardar trechos comerciais versionados em `commercial_knowledge_chunks`, sempre ligados a um tenant e, opcionalmente, a um roteiro.
- Separar orientação comportamental (`SKILL`) de fato que pode sustentar uma afirmação (`PRODUCT_FACT`), além de objeção e restrição.
- Recuperar no PostgreSQL no máximo três itens aprovados e ativos, combinando busca textual, intenção, etapa, habilidade e prioridade.
- Não usar embeddings nem uma segunda chamada de IA nesta fase. Isso reduz custo e mantém a origem verificável.
- Enviar o histórico à API com os papéis reais de usuário e assistente.
- Usar a mensagem inicial apenas antes do primeiro envio e aplicar uma proteção determinística contra nova saudação nominal.
- Registrar na candidata de mensagem apenas id, versão e tipo das fontes utilizadas.
- Não baixar URLs no webhook. Links antigos continuam apenas como referência administrativa; somente conteúdo inline antigo é compatibilizado.

## Matriz de habilidade

| Estado/intenção | Habilidade principal |
|---|---|
| primeira abordagem | abertura |
| processo, método ou dor ainda não claros | descoberta |
| impacto, urgência ou consequência | implicação |
| perfil, volume, autoridade ou orçamento | qualificação |
| objeção | tratamento de objeção |
| pergunta sobre solução | construção de valor |
| qualificado | próximo passo |
| sem aderência ou sem interesse | desqualificação respeitosa |
| pedido de pessoa humana | transferência humana |

## Alternativas rejeitadas

- **Enviar todos os materiais em toda resposta:** aumenta tokens, mistura técnicas incompatíveis e piora a precisão.
- **Buscar cada URL durante a conversa:** adiciona SSRF, latência, conteúdo mutável e falhas externas.
- **Embeddings desde a primeira versão:** adicionam provedor, custo e rotina de reindexação sem necessidade para a base inicial pequena.
- **Somente um prompt maior:** não oferece aprovação, versão, isolamento, recuperação contextual nem auditoria de fonte.

## Consequências

- Uma migration precisa existir antes da nova tela e da função publicada.
- Proprietários podem criar, revisar e aprovar o conteúdo; assistentes consultam em modo somente leitura.
- Falha da recuperação não derruba o atendimento: a conversa continua com a habilidade padrão e sem fatos adicionais.
- A qualidade passa a depender também da curadoria dos itens aprovados. Mudanças de conteúdo incrementam a versão automaticamente.

## Rollback

Reverter primeiro a Edge Function para a versão anterior e depois a interface. A tabela pode permanecer sem uso para preservar a trilha; sua remoção exige exportação e autorização específica.
