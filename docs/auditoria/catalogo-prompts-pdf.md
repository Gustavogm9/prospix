# Catalogo dos Prompts e Diretrizes do PDF

Fonte: `C:\Users\gusta\Downloads\PromptsAuditores.pdf`.

Este arquivo nao e uma transcricao literal pagina a pagina. Ele e o catalogo operacional completo das diretrizes extraidas do PDF para o Prospix, preservando todos os blocos, fases, escalas, entregaveis, revisoes e temas obrigatorios.

## Estrutura do PDF

| Bloco | Paginas | Uso no Prospix |
|---|---:|---|
| Auditoria de arquitetura, estrutura, funcionamento e proposito | 1-38 | Base da auditoria 3D geral do sistema. |
| Auditoria de seguranca | 39-95 | Base dos gates de AppSec, IAM, RLS, dados, IA, infra e abuso. |
| Checagem de relatorio de seguranca | 96-97 | Revisor independente e controle de qualidade do parecer. |
| Auditoria de erros, logs e erros silenciosos | 98-154 | Observabilidade, confiabilidade, logs, alertas e investigacao defensiva. |

## Prompt 1 - Auditoria 3D de arquitetura, estrutura, funcionamento e proposito

### Papel do auditor

O auditor atua como auditor principal de sistemas, arquiteto senior, especialista em seguranca, confiabilidade, dados, documentacao tecnica e qualidade.

### Visao 3D obrigatoria

- Dimensao estrutural: componentes, modulos, servicos, repos, banco, APIs, integracoes, filas, jobs, infra, ambientes, dependencias, permissoes, configuracoes, artefatos, docs e assets.
- Dimensao comportamental: fluxos de negocio, dados, auth, autorizacao, eventos, chamadas internas/externas, estados, excecoes, falhas, retries, observabilidade e operacao.
- Dimensao de garantia, risco e evidencia: confiabilidade, seguranca, corretude, manutencao, riscos, lacunas e provas.

### Principios obrigatorios

- Nao inventar informacoes.
- Nao presumir fatos sem marcar como hipotese.
- Diferenciar fato comprovado, evidencia observada, inferencia tecnica, hipotese, lacuna de evidencia e item nao verificado.
- Toda afirmacao tecnica relevante precisa de evidencia, origem ou justificativa.
- Quando faltar evidencia, escrever: "Nao determinado com as evidencias disponiveis."
- Nao usar linguagem vaga sem classificar confianca.
- Nao ocultar limitacoes.
- Nao fazer testes destrutivos, intrusivos, ilegais ou fora de escopo.
- Nao expor segredos, tokens, senhas, chaves privadas ou dados pessoais sensiveis.
- Nao entregar instrucao ofensiva exploravel; descrever risco, impacto e correcao defensiva.
- Usar linguagem tecnica, formal, objetiva e auditavel.
- Priorizar precisao, evidencia e rastreabilidade.
- Nao finalizar com conclusoes absolutas em auditoria parcial.
- Toda recomendacao deve ter causa, impacto, prioridade e acao sugerida.
- Toda inconsistencia deve ser registrada.
- Todo achado deve ter severidade, confianca, evidencia e recomendacao.

### Entradas esperadas

- Nome do sistema.
- Organizacao ou area responsavel.
- Objetivo conhecido.
- Escopo e fora de escopo.
- Repositorios, arquivos, diagramas, docs, URLs, ambientes e credenciais autorizadas.
- Artefatos existentes, logs, testes, relatorios, contratos e dependencias.

### Objetivo final do relatorio

O relatorio deve conter:

- sumario executivo;
- escopo, premissas e limitacoes;
- metodologia;
- inventario de evidencias;
- visao geral;
- arquitetura em multiplas camadas;
- mapas de fluxos e dependencias;
- funcionamento interno;
- analise de componentes, dados, integracoes, seguranca, privacidade, confiabilidade, performance, observabilidade, operacao e SDLC;
- matriz de riscos, achados e controles;
- bateria de testes executados ou recomendados;
- lacunas de evidencia;
- recomendacoes priorizadas;
- roadmap de remediacao;
- apendices, glossario e conclusao formal.

### Fases obrigatorias

1. Controle de escopo e autorizacao.
2. Inventario de evidencias.
3. Identificacao do proposito do sistema.
4. Visao arquitetural 3D.
5. Inventario tecnico completo.
6. Analise de fluxos.
7. Analise de dados.
8. Analise de integracoes e dependencias.
9. Analise de seguranca.
10. Analise de privacidade e conformidade.
11. Analise de confiabilidade e resiliencia.
12. Analise de performance e capacidade.
13. Analise de observabilidade.
14. Analise de SDLC, governanca e manutencao.
15. Analise de riscos.
16. Bateria de testes.
17. Priorizacao de achados e recomendacoes.
18. Revisao critica antes da entrega.
19. Relatorio final no formato oficial.

### Inventario tecnico exigido

- Aplicacoes, servicos e APIs.
- Bancos, tabelas/colecoes, filas, topicos, eventos e jobs.
- Integracoes externas e internas.
- Ambientes e infraestrutura.
- Dependencias de software, terceiros e bibliotecas criticas.
- Segredos e credenciais, sem revelar valores.
- Certificados, dominios, endpoints, permissoes e perfis de acesso.
- Logs, dashboards, alertas, backups, testes e documentacao existente.

### Fluxos obrigatorios

- Negocio, autenticacao, autorizacao, dados, integracao, assincronos, erro, excecao, retentativa, auditoria, administrativos, deploy, backup, recuperacao e observabilidade.

### Dominios de seguranca avaliados no prompt geral

- Autenticacao, autorizacao, sessao, identidade, perfis, privilegios e segregacao de funcoes.
- Criptografia, segredos, APIs, validacao de entradas, saidas, injecoes e exposicao de dados.
- Logs, arquivos, dependencias, containers, infra, pipeline CI/CD, ambientes e hardening.
- Vulnerabilidades, monitoramento, auditoria de acoes sensiveis, incidentes, backups, superficie de ataque, fronteiras de confianca e ameacas.

### Testes recomendados

- Documentais, funcionais, integracao, seguranca defensiva, permissoes, dados, performance, resiliencia, observabilidade, backup/restauracao, deploy/rollback, conformidade, regressao, usabilidade operacional e rastreabilidade.

### Revisao critica final

Antes da entrega, verificar:

- afirmacoes sem evidencia;
- conclusoes exageradas;
- ambiguidades;
- lacunas nao declaradas;
- recomendacoes sem causa;
- riscos sem impacto;
- achados sem severidade;
- inconsistencias entre secoes;
- termos vagos;
- dados sensiveis expostos indevidamente;
- aptidao do documento como artefato oficial.

## Prompt 2 - Auditoria 3D de seguranca

### Regra central

A auditoria de seguranca deve ser defensiva, autorizada, nao destrutiva e nao ofensiva. O auditor nao deve fornecer payloads prontos, scripts de exploracao, comandos de ataque, bypasses operacionais ou passos exploraveis.

### Visao 3D de seguranca

- Dimensao estrutural: ativos, identidades, fronteiras, permissoes, dados, endpoints, cloud, containers, CI/CD, dependencias, logs e backups.
- Dimensao comportamental: como acessos, sessoes, autorizacoes, uploads, webhooks, jobs, pagamentos, IA e dados fluem.
- Dimensao adversarial e de garantia: ameacas, abusos, controles, evidencias, simulacoes defensivas e riscos residuais.

### Principios especificos

- Nao afirmar que o sistema e seguro sem evidencia suficiente.
- Nao ocultar riscos ou limitacoes.
- Nao revelar segredos encontrados.
- Toda vulnerabilidade deve ter impacto, causa provavel, evidencia, severidade, prioridade e correcao.
- Toda recomendacao deve ser pratica, priorizada e verificavel.
- Todo teste nao executado deve ter status e motivo.
- Riscos financeiros, administrativos, de dados, IA, upload e privilegio devem ser avaliados explicitamente.
- A conclusao final deve refletir nivel real de evidencia.

### Referenciais tecnicos considerados

- OWASP Top 10.
- OWASP ASVS.
- OWASP API Security Top 10.
- OWASP LLM Top 10.
- OWASP Cheat Sheet Series.
- NIST, CIS, ISO 27001 e boas praticas de AppSec/DevSecOps quando aplicavel.

### Escalas obrigatorias

- Forca da evidencia E0-E5.
- Confianca Alta, Media, Baixa.
- Severidade Critica, Alta, Media, Baixa.
- Prioridade P0-P3.
- Status de teste: Aprovado, Reprovado, Parcial, Nao executado, Nao aplicavel.

### Fases obrigatorias de seguranca

1. Escopo, autorizacao e limites.
2. Inventario de evidencias.
3. Inventario de ativos e superficie de ataque.
4. Arquitetura de seguranca 3D.
5. Autenticacao.
6. Sessoes, tokens e cookies.
7. Autorizacao, RBAC, ABAC e IDOR.
8. Administradores maliciosos, abuso interno e conta comprometida.
9. Validacao de entradas e protecao contra injecoes.
10. Seguranca de banco de dados.
11. Protecao de dados sensiveis e privacidade.
12. Logs, console, chamados e mensagens internas.
13. Uploads maliciosos, arquivos, imagens, videos, PDFs e documentos.
14. APIs, webhooks e integracoes.
15. SSRF e chamadas feitas pelo servidor.
16. Infraestrutura, cloud, containers e configuracao.
17. Codigo, SDLC, DevSecOps e supply chain.
18. Transacoes financeiras, pagamentos e regras de negocio criticas.
19. Fraude, abuso de negocio, bots e automacao abusiva.
20. Sistemas com IA, LLM, RAG, agentes e ferramentas.
21. Documentos, PDFs, imagens, videos e processamento de midia.
22. Segredos, chaves, tokens e credenciais.
23. Monitoramento, deteccao e resposta.
24. Backup, recuperacao e ransomware.
25. Terceiros, fornecedores e integracoes externas.
26. Simulacao defensiva de ataques e abuso.
27. Matriz de achados.
28. Matriz de riscos.
29. Matriz de controles.
30. Roadmap/plano de remediacao.
31. Revisao critica e relatorio final.

### Diagramas obrigatorios quando houver evidencia

- Contexto.
- Containers/blocos.
- Componentes.
- Dados.
- Autenticacao/autorizacao.
- Sessao.
- Uploads.
- Financeiro.
- IA/LLM/RAG.
- Integracoes.
- Infraestrutura/cloud.
- Logs/auditoria.
- Backup/recuperacao.

### Simulacoes defensivas de abuso

O PDF lista cenarios que devem ser avaliados conceitualmente, sem payloads ou passos ofensivos:

- usuario comum tentando acessar outro tenant/usuario;
- elevacao de privilegio;
- suporte acessando dado sensivel sem necessidade;
- admin apagando evidencia;
- admin exportando massa de dados;
- conta administrativa comprometida;
- login suspeito e credential stuffing;
- recuperacao de senha abusada;
- sessao roubada ou token reaproveitado;
- upload malicioso, PDF suspeito, imagem adulterada e arquivo compactado abusivo;
- API sem autorizacao por objeto;
- mass assignment;
- webhook falso e replay em operacao critica;
- SSRF conceitual;
- XSS/injecao conceitual;
- falha de CORS e CSRF;
- manipulacao de preco, cupom, frete, quantidade, estoque ou status;
- cobranca duplicada e race condition financeira;
- alteracao indevida de dados bancarios;
- prompt injection, injecao indireta por documento, vazamento de contexto RAG e ferramenta de IA sem autorizacao;
- segredo em log, dado em chamado, bucket publico, banco exposto, backup apagado, dependencia vulneravel e pipeline vazando segredo.

### Estrutura final do relatorio de seguranca

O relatorio deve incluir identificacao, sumario executivo, escopo, metodologia, evidencias, arquitetura, ativos, autenticacao, sessao, autorizacao, admin abuse, entradas/injecoes, banco, dados sensiveis, logs, uploads, APIs/webhooks, SSRF, infra, codigo/supply chain, financeiro, fraude, IA, midia, segredos, monitoramento, backup, terceiros, simulacoes defensivas, matriz de achados, matriz de riscos, matriz de controles, roadmap e conclusao formal.

## Prompt 3 - Checagem de relatorio de seguranca

### Papel

Revisor independente de auditoria de seguranca. Deve identificar falhas, omissoes, ambiguidades, exageros, conclusoes sem evidencia, riscos subestimados e recomendacoes fracas.

### Regras de rejeicao

- Nao aceitar conclusao sem evidencia.
- Nao aceitar recomendacao sem criterio de aceite.
- Nao aceitar risco sem impacto.
- Nao aceitar achado sem severidade.
- Nao aceitar simulacao com payload, comando, script ou passo exploravel.
- Nao aceitar declaracao absoluta de seguranca.
- Apontar inconsistencias entre secoes.
- Apontar dominios de seguranca ausentes.
- Apontar controles essenciais nao avaliados.
- Reescrever a conclusao quando ela estiver mais forte que as evidencias.

### Saida obrigatoria

1. Diagnostico da qualidade do relatorio.
2. Problemas criticos encontrados.
3. Afirmacoes sem evidencia.
4. Riscos possivelmente subestimados.
5. Lacunas de cobertura.
6. Recomendacoes fracas ou incompletas.
7. Itens que precisam de nova evidencia.
8. Correcoes sugeridas.
9. Versao revisada da conclusao formal.
10. Nota final de confiabilidade do relatorio.

## Prompt 4 - Auditoria de erros, logs e erros silenciosos

### Papel

Auditor principal de observabilidade, confiabilidade, AppSec, DevSecOps, forense defensiva, arquitetura, incident response e privacidade operacional.

### Objetivo

Determinar se o sistema:

- detecta erros corretamente;
- trata erros corretamente;
- nao esconde falhas relevantes;
- nao permite erros silenciosos;
- registra eventos tecnicos, operacionais, funcionais e de seguranca com qualidade;
- protege logs contra vazamento, adulteracao e perda;
- permite investigacao forense defensiva;
- permite rastreabilidade por usuario, requisicao, sessao, transacao, job, integracao, tenant e evento;
- gera alertas uteis;
- evita ruido excessivo;
- preserva dados sensiveis;
- fornece evidencia confiavel para auditoria, incidentes, suporte, compliance e melhoria.

### Visao 3D para erros e logs

- Dimensao estrutural: handlers, middlewares, interceptors, loggers, coletores, SDKs, pipelines, dashboards, alertas, traces, metricas, SIEM, jobs, filas, APIs e integracoes.
- Dimensao comportamental: como erros ocorrem, sobem, sao tratados, logados, correlacionados, alertados, investigados e encerrados.
- Dimensao de garantia e evidencia: se logs e alertas sao suficientes, integres, protegidos, uteis e auditaveis.

### Principios especificos

- Todo erro silencioso potencial e risco ate ser descartado por evidencia.
- Todo log sensivel e risco de vazamento.
- Todo evento critico sem log e risco de deteccao, auditoria e resposta.
- Todo erro sem correlacao e risco investigativo.
- Todo alerta ausente em evento critico e risco operacional.
- Excesso de logs tambem e risco por ruido, custo e perda de sinal.
- Stack trace em producao deve ser avaliada como risco.
- Segredo em log, console, ticket, trace ou metrica e achado critico.
- Nao concluir que logs sao adequados apenas porque existem logs.
- Nao concluir que alertas sao adequados apenas porque existem dashboards.
- Nao concluir que erros sao tratados apenas porque existe try/catch.
- Nao concluir que observabilidade e adequada sem verificar logs, metricas, traces, alertas, runbooks e resposta.

### Referenciais

- OWASP ASVS para error handling/logging.
- OWASP Top 10 A09.
- OWASP API Security Top 10.
- OWASP LLM Top 10 quando houver IA.
- NIST SP 800-92 e praticas de observabilidade, SRE e incident response defensivo.

### Fases obrigatorias

1. Escopo, autorizacao e limites.
2. Inventario de evidencias.
3. Inventario do sistema de erros e logs.
4. Arquitetura 3D de erros, logs e observabilidade.
5. Auditoria de tratamento de erros.
6. Auditoria de erros silenciosos.
7. Auditoria de mensagens de erro ao usuario.
8. Auditoria de taxonomia, codigos e padronizacao de erros.
9. Auditoria de conteudo dos logs.
10. Auditoria de dados sensiveis em logs.
11. Auditoria de protecao, integridade e acesso aos logs.
12. Auditoria de eventos obrigatorios.
13. Auditoria de niveis de log.
14. Auditoria de correlacao, rastreabilidade e tracing.
15. Auditoria de metricas, alertas e deteccao.
16. Auditoria de erros em APIs.
17. Auditoria de erros em banco de dados.
18. Auditoria de erros em filas, jobs, workers e cron.
19. Auditoria de erros em uploads e processamento de arquivos.
20. Auditoria de transacoes financeiras.
21. Auditoria de autenticacao, sessao, autorizacao e seguranca.
22. Auditoria de IA/LLM/RAG/agentes, se houver.
23. Auditoria de frontend, console e client-side logging.
24. Auditoria de CI/CD, deploy e configuracao.
25. Auditoria de incidentes, suporte e postmortems.
26. Simulacoes defensivas de erro e falha.
27. Matriz de achados.
28. Matriz de riscos.
29. Matriz de controles.
30. Plano de remediacao.
31. Revisao critica antes da entrega.
32. Relatorio final.

### Eventos obrigatorios de log/auditoria

O PDF lista eventos que devem ser considerados para log/auditoria, incluindo:

- login bem-sucedido e malsucedido;
- logout;
- troca e recuperacao de senha;
- refresh token, token invalido, revogado ou reutilizado;
- permissao negada e tentativa de IDOR;
- criacao, alteracao, desativacao de usuario;
- criacao de admin e alteracao de perfil/permissao;
- acesso administrativo e acao administrativa sensivel;
- criacao, atualizacao, exclusao, exportacao e importacao de dados;
- upload iniciado, concluido, rejeitado, suspeito e falha de antimalware;
- webhook recebido, invalido, duplicado, atrasado ou sem assinatura;
- job iniciado, concluido, reprocessado, duplicado, compensado ou falhando;
- mensagem enviada, falha de envio, opt-out e escalacao humana;
- evento financeiro, pagamento, reembolso, chargeback e divergencia de billing;
- falha de IA/LLM, prompt injection suspeito, falha de RAG e custo anormal;
- falha de backup, restauracao, deploy, rollback e alteracao de variavel de ambiente.

### Matrizes obrigatorias

- Evidencias.
- Inventario de handlers, logs, metricas, traces, dashboards e alertas.
- Erros esperados vs tratamento observado.
- Erros silenciosos potenciais.
- Mensagens ao usuario.
- Taxonomia de codigos.
- Campos obrigatorios de log.
- Dados sensiveis em logs.
- Acesso e integridade dos logs.
- Eventos obrigatorios.
- Correlacao ponta a ponta.
- Sinais, metricas, alertas, thresholds, donos e runbooks.
- Riscos e controles.
- Plano de remediacao.

### Estrutura final do relatorio

O relatorio final deve cobrir identificacao, sumario executivo, escopo, metodologia, evidencias, arquitetura de observabilidade, inventario, tratamento de erros, erros silenciosos, mensagens ao usuario, taxonomia, conteudo de logs, dados sensiveis, acesso aos logs, eventos obrigatorios, niveis, correlacao, metricas, alertas, APIs, banco, filas, uploads, financeiro, auth/security, IA, frontend, CI/CD, incidentes, simulacoes, matriz de achados, riscos, controles, remediacao, conclusao e apendices.

## Como o catalogo vira gate no Prospix

- O prompt geral alimenta [roadmap.md](roadmap.md), [squads.md](squads.md) e [checklists.md](checklists.md).
- O prompt de seguranca alimenta os achados P0/P1 em [matriz-achados.md](matriz-achados.md).
- O prompt de revisao alimenta o papel do Claude como revisor independente.
- O prompt de erros/logs alimenta os gates de observabilidade, logs sensiveis, erros publicos e readiness.

## Lacunas assumidas

- A extracao de texto do PDF apresentou caracteres corrompidos em acentuacao. O conteudo tecnico foi consolidado por bloco e fase.
- Este arquivo e um catalogo operacional completo, nao uma copia literal do PDF.
- Se houver necessidade de preservar texto literal integral, criar um anexo separado a partir do PDF original e revisar encoding antes de versionar.
