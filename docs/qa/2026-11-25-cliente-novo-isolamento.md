# Conta de cliente nova e isolada

## Pedido e causa do problema

O usuário esclareceu que `gustavo.macedo@guilds.com.br` é um cliente novo e deve começar sem informações herdadas. O vínculo anterior à Corretora de Teste foi uma suposição incorreta do executor, registrada e substituída pelo pedido atual.

A criação do novo espaço foi ensaiada com rollback e todas as tabelas comerciais estavam vazias. A verificação com papel `authenticated`, porém, encontrava três outros usuários. O catálogo confirmou a causa: `tenant_isolation_users` concedia acesso por `role = 'GUILDS_ADMIN'` da **linha consultada**, além do tenant. Assim, um cliente conseguia ler perfis de administradores de fora da sua organização.

O diagnóstico consultou somente contagens, catálogo e definições de helpers; não fez tentativa de escrita com credencial de cliente em contas de terceiros.

## Correção preparada

- Migration `20261125135500_fix_user_tenant_visibility.sql`: troca a condição da linha pelo papel do chamador, mantendo acesso ao próprio tenant e o acesso legítimo dos administradores globais. A policy continua com o mesmo nome, comando e público; `WITH CHECK` explicita a mesma condição.
- Roteiro de conta `ops/2026-11-25-separate-new-client.sql`: cria organização exclusiva em ONBOARDING, sem templates, campanhas, leads, histórico, conhecimento comercial ou credenciais herdados; limpa apenas o perfil deste usuário, preservando identidade e senha.
- Executor de mesmo nome: alinha os metadados pela API administrativa do Auth, confirma o login real e encerra globalmente as sessões de renovação dessa conta. Não declara invalidação imediata de todo JWT já emitido; a entrada seguinte usa o novo escopo.
- Preserva registros comerciais e vínculos de outras pessoas na Corretora de Teste. Não aplica a migration de remoção de conversas ainda pendente, pois ela é independente desta correção.

## Evidência do ensaio

Recibo local protegido: `.local/new-client-2026-11-25/result.json`, estágio `awaiting_policy_approval` em 25/11/2026 às 10h53 de Brasília.

| Verificação | Resultado |
|---|---|
| Contraexemplo antes da correção | 3 perfis de outros usuários visíveis; dados comerciais do espaço novo = 0 |
| Leads, conversas, mensagens e reuniões no novo tenant | 0 |
| Campanhas, roteiros e conhecimento comercial no novo tenant | 0 |
| Canais WhatsApp | 0 |
| Autorização Google Calendar | Ausente |
| Perfil herdado | Limpo no ensaio |
| Saída automática | Pausada |
| Cliente consulta outro tenant ou outro usuário | Negado com a policy corrigida |
| Administrador legítimo | Consulta de usuários e tenants preservada |
| Anônimo | Leitura de usuários negada |
| Restauração da policy em savepoint | Passou |
| Rollback do ensaio completo | Estado original confirmado; novo tenant não persistiu |

Não houve commit em produção até este estágio. A cópia cifrada do perfil é local e depende do usuário Windows; não equivale a backup completo do projeto. A definição atual da policy e o comando de retorno foram guardados em `.local/new-client-2026-11-25/user-policy-before.sql`.

## Aplicação pendente

A policy é compartilhada, portanto foi solicitada autorização específica para a alteração e para a exceção limitada de backup, conforme `olima-migrations`, regra 21. Nenhum arquivo de continuação da aplicação pode ser emitido antes dessa resposta.

Após aprovação, schema/histórico e separação da conta são confirmados na mesma transação. O resultado final exige perfil/Auth no tenant novo, login com a senha atual, leitura do próprio perfil, tabelas comerciais vazias e ausência de acesso à antiga corretora na sessão nova.

O checklist de onboarding publicado guarda progresso em uma chave global do navegador. Ele não é dado comercial do banco. Um primeiro acesso em janela privada evita reutilizar esse progresso local; a correção de persistência por tenant permanece uma pendência de interface, sem publicação nesta operação.

Autorização específica recebida: o dono autorizou esta correção com as cópias e reversão descritas. Exceção limitada de backup registrada em docs/ciclo.md. Aplicação liberada no executor pelos hashes dos arquivos aprovados; aguarda senha atual no campo mascarado e recibo final.

## Resultado aplicado e verificado

Recibo final: `applied=true`, `login_verified=true`, `empty_workspace_verified=true`, `profile_reset=true`, `sessions_signout_confirmed=true` com escopo global desta conta. Perfil e metadados Auth apontam para o tenant exclusivo, sem duplicar identidade. Corretora de Teste passou de três para dois membros, preservando os outros vínculos e todos os registros comerciais.

Leads, conversas, mensagens, reuniões, campanhas, roteiros, conhecimento comercial e canais WhatsApp = 0; Calendar sem autorização; saída automática pausada. A sessão real do cliente leu o próprio perfil limpo e não encontrou a antiga corretora ou dados comerciais. A nova senha validada na operação anterior foi mantida. A policy corrigida e o histórico da migration foram incluídos no mesmo commit transacional que cria o espaço e muda o vínculo; não houve deploy de interface nesta operação.

Próximo passo do titular: novo login no domínio publicado. Um primeiro acesso em janela privada evita aproveitar progresso local de onboarding que a versão web atual ainda guarda sem separar tenants. Nenhuma conta comercial real deve ser inferida como colaboradora de um tenant existente apenas pelo domínio do e-mail.