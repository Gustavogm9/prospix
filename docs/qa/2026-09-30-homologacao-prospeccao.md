# Homologação: prospecção e qualificação, 30/09/2026

## Resultado e escopo

Rodada sintética concluída. Foram processados 10 leads fictícios, uma única fonte e nenhuma chamada ou mensagem externa. Produção permanece sem campanha automática liberada.

Ambientes: testes locais com fixtures; produção somente depois dos portões de migration/deploy e apenas no contato autorizado.

## Roteiro

1. Criar 10 leads sintéticos do segmento médico com combinações de fit.
2. Rodar Google Maps simulado e comprovar uma linha de uso para Text Search e cada Details.
3. Repetir a mesma requisição em paralelo e comprovar uma execução.
4. Tentar anônimo, tenant diferente, campanha pausada e fonte desabilitada.
5. Enriquecer pelo canal Evolution simulado e comprovar que a chave ausente falha fechada.
6. Conversar com respostas fictícias até qualificar, verificando uma pergunta por turno e persistência por evidência.
7. Forçar custo acima do teto e comprovar `STOPPED_BUDGET` antes de nova chamada.
8. Importar a mesma fixture de billing duas vezes e comprovar que não duplica.
9. Executar uma fonte de cada vez; a seguinte só inicia se a anterior estiver abaixo do custo máximo por lead elegível.
10. Depois dos testes, validar o contato autorizado sem habilitar terceiros.

## Limites de parada da rodada

- máximo de 20 leads por execução;
- uma fonte ativa por rodada;
- nenhuma mensagem para telefone que não esteja na allowlist de homologação;
- parar quando `custo estimado / leads elegíveis` ultrapassar o limite configurado da campanha;
- parar imediatamente em 401/403 do provedor, divergência de tenant, campanha pausada ou kill switch ativo.

## Evidências automatizadas

| Verificação | Resultado |
|---|---|
| testes unitários e de contrato | 66/66 aprovados em 14 arquivos |
| tipos | aprovado (`tsc --noEmit`) |
| lint da aplicação | 0 erros; 21 avisos anteriores fora desta fatia |
| Edge Functions | 5/5 aprovadas no `deno check` |
| build de produção | aprovado; 84 páginas geradas, incluindo `/admin/custos` |
| homologação sintética | 10 chamadas simuladas, 10 processados, 5 elegíveis, parada `HOMOLOGATION_LEAD_LIMIT`, 0 chamadas e 0 mensagens externas |
| scripts de início e encerramento QA | parser PowerShell com 0 erros nos dois scripts |
| integridade do diff | `git diff --check` aprovado; nenhum arquivo, tabela ou registro excluído |
| dry-run das migrations | teste SQL pós-deploy pronto; execução remota pendente porque o projeto local não está vinculado |

## Pendências para liberação integral

| Pendência | Dono | Prazo |
|---|---|---|
| export/API de billing real dos provedores | operação | antes de liberar escala |
| validação jurídica da base legal e retenção | controlador/jurídico | antes do go-live externo |
| aprovação de migration e deploy | Gustavo | antes de produção |
| aceite explícito para reativar campanha | Gustavo | depois da rodada controlada |
