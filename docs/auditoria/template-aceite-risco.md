# Template de Aceite Formal de Risco

Use este documento somente quando um risco nao puder ser corrigido antes do marco atual e precisar de decisao explicita. O aceite nao remove o achado da matriz; ele muda o status para `Aceito com risco` com prazo de revisita.

## Identificacao

- ID do achado: `AUD-`
- ID da tarefa: `MA-`
- PR/branch:
- Agente executor:
- Titulo:
- Squad dono:
- Severidade: Critica / Alta / Media / Baixa
- Prioridade: P0 / P1 / P2 / P3
- Data do aceite:
- Marco afetado: PR / staging / homologacao / go-live / producao

## Evidencia

- Evidencia atual E0-E5:
- Comandos, testes ou arquivos observados:
- Lacunas conhecidas:
- Itens nao verificados:

## Risco aceito

- Descricao objetiva do risco:
- Impacto possivel:
- Escopo exato do aceite:
- O que fica fora do aceite:
- Prazo maximo de revisita:
- Condicao de expiracao automatica:
- Impacto no gate Codex: bloqueia / libera com ressalva / nao determinado

## Mitigacoes temporarias

- Controles compensatorios:
- Monitoramento ou alerta:
- Plano de rollback:
- Responsavel pela mitigacao:

## Decisao

- Aprovador Gustavo:
- Data/hora:
- Condicoes impostas:
- Revisao Claude obrigatoria para severidade Alta/Critica: Sim / Nao
- Resultado da revisao Claude:
- Decisao Codex Auditor Oficial: Aceito com risco / Bloqueado / Nao determinado

## Atualizacao obrigatoria

Depois do aceite, atualizar:

- [ ] [matriz-achados.md](matriz-achados.md) com status `Aceito com risco`.
- [ ] PR relacionado com link para este aceite.
- [ ] Prazo de revisita no backlog ou issue.
- [ ] Documentacao afetada, se houver mudanca de comportamento ou operacao.
