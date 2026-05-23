# Execucao Multiagente Prospix

Este documento define como varios agentes podem trabalhar em paralelo sem perder rastreabilidade, ownership ou criterio de aceite. A regra central: agente implementa, squad revisa evidencias, Codex decide gate, Claude desafia achados altos/criticos e Gustavo decide risco excepcional.

## Objetivos

- Transformar specs em pacotes de tarefa pequenos, auditaveis e delegaveis.
- Evitar conflito de arquivos entre agentes.
- Padronizar saida, evidencias, handoff e decisao.
- Manter uma matriz operacional separada da matriz de achados.
- Fazer o gate Codex acontecer antes de staging, main ou producao.

## Fluxo oficial

1. Gustavo ou Codex cria um pacote de tarefa usando [template-pacote-tarefa.md](template-pacote-tarefa.md).
2. A tarefa entra em [matriz-execucao-multiagente.md](matriz-execucao-multiagente.md) com ID, frente, squad, agente e status.
3. O agente executa apenas o escopo permitido e registra evidencias.
4. Quando houver troca de dono, bloqueio ou termino parcial, o agente entrega [template-handoff.md](template-handoff.md).
5. O PR usa [../../.github/pull_request_template.md](../../.github/pull_request_template.md) com gate Codex preenchido.
6. O squad dono revisa evidencias tecnicas.
7. Codex decide `LIBERADO`, `LIBERADO COM RESSALVA`, `BLOQUEADO` ou `NAO DETERMINADO`.
8. Claude revisa achados altos/criticos ou conclusoes contestadas.
9. Gustavo decide somente aceite excepcional de risco usando [template-aceite-risco.md](template-aceite-risco.md).
10. Codex atualiza [matriz-achados.md](matriz-achados.md) e [matriz-execucao-multiagente.md](matriz-execucao-multiagente.md).

## Estados operacionais

| Estado | Uso |
|---|---|
| `Backlog` | Tarefa existe, mas ainda nao foi alocada. |
| `Pronto para agente` | Escopo, arquivos permitidos, criterios e comandos estao claros. |
| `Em execucao` | Agente esta trabalhando no pacote. |
| `Aguardando evidencia` | Codigo existe, mas faltam comandos, testes ou prova. |
| `Aguardando auditoria` | PR pronto para gate Codex. |
| `Bloqueado por auditoria` | P0/P1, lacuna critica ou conflito impedem avancar. |
| `Aguardando Claude` | Revisor independente precisa validar achado alto/critico. |
| `Aguardando Gustavo` | Ha decisao excepcional de risco/produto. |
| `Liberado` | Gate Codex aprovado. |
| `Concluido` | Merge/release/registro final feito. |

## Regras de paralelismo

- Um pacote deve ter arquivos permitidos explicitos.
- Dois agentes nao editam o mesmo arquivo ao mesmo tempo sem handoff registrado.
- Mudanca em Prisma, RLS, OpenAPI, shared-types, auth, billing, prompts, workers ou CI exige gate reforcado.
- PR sem evidencia e tratado como `NAO DETERMINADO`, mesmo que pareca correto.
- Se a evidencia contradiz o PRD, docs/agents ou codigo real, abrir conflito conforme [protocolo-conflitos.md](protocolo-conflitos.md).

## Convencao de IDs

- Tarefa multiagente: `MA-YYYYMMDD-NN`
- Handoff: `HO-YYYYMMDD-NN`
- Conflito: `CF-YYYYMMDD-NN`
- Achado: `AUD-P<prioridade>-NNN`

## Personas de agente

Cada execucao multiagente recebe um nome de cientista/filosofo (Avicenna, Hypatia, Newton, Sartre, Plato, Lovelace, Darwin, Laplace, Singer, Mencius, McClintock, Bohr, Copernicus, Socrates, Mendel, Epicurus, Ampere, Gibbs, Dalton, James, Lorentz, Anscombe, Popper, Herschel, Raman, etc). A persona representa uma rodada de contexto isolada, com escopo restrito ao pacote da tarefa. Codex coordena a matriz e atribui personas ao alocar pacotes; o nome aparece na coluna `Agente` de [matriz-execucao-multiagente.md](matriz-execucao-multiagente.md). Persona nao indica modelo distinto necessariamente, e sim uma execucao auditavel separada.

## Labels recomendadas

- `agent:codex`
- `agent:claude`
- `agent:gemini`
- `squad:security`
- `squad:api-contracts`
- `squad:workers-ia-whatsapp`
- `squad:frontend-ux`
- `squad:devex-ci-docs`
- `squad:produto-compliance`
- `needs-audit`
- `blocked-by-audit`
- `needs-claude-review`
- `needs-risk-acceptance`
- `ready-for-staging`

## Limite de trabalho em paralelo

- No maximo 1 pacote P0 por squad em execucao.
- No maximo 2 pacotes P1 por squad em execucao.
- Pacote que toca RLS/auth/secrets/billing fica sozinho no arquivo ou modulo afetado.
- Pacote bloqueado por mais de 24h precisa de handoff ou decisao de Gustavo/Codex.

## Saida obrigatoria de qualquer agente

Todo agente deve terminar sua resposta ou PR com:

- `Resumo`: o que foi feito.
- `Arquivos tocados`: paths exatos.
- `Evidencias`: comandos, testes, prints ou arquivos.
- `Lacunas`: o que nao foi verificado.
- `Riscos`: riscos residuais e severidade.
- `Handoff`: proximo dono ou "nenhum".
- `Gate esperado`: liberado, ressalva, bloqueado ou nao determinado.

## Quando parar e pedir gate

O agente deve parar e pedir gate quando:

- descobrir vazamento cross-tenant, auth bypass ou perda de dados;
- precisar tocar segredo real ou dado pessoal sensivel;
- encontrar divergencia material entre PRD, spec e codigo real;
- precisar mudar contrato compartilhado com consumidor desconhecido;
- nao conseguir rodar teste obrigatorio para uma area P0/P1;
- depender de aceite de risco.
