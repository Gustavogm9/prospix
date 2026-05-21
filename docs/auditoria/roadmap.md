# Roadmap de Auditoria Oficial

## Objetivo

Transformar o Prospix em um projeto auditavel por design: cada frente entrega codigo, evidencia e criterios de aceite, enquanto a auditoria bloqueia riscos criticos antes que cheguem a staging, main ou producao.

## Fase 0 - Normalizacao

Entregaveis:

- Criar `docs/auditoria` como fonte oficial da auditoria.
- Registrar taxonomia de evidencia, severidade, prioridade, confianca e status.
- Atualizar docs que ainda dizem que a implementacao nao iniciou ou que o plano tem apenas 5 frentes.
- Marcar o trabalho do Claude como baseline novo, sujeito a auditoria.

Gate de saida:

- Todos os documentos de auditoria existem.
- Matriz inicial de achados esta preenchida.
- `docs/agents/README.md` e `docs/dev-plan.md` citam Codex como gate bloqueante.

## Fase 1 - Inventario auditavel

Mapear:

- apps: API, web tenant, admin, landing;
- pacotes: shared-types, UI, mocks;
- banco: Prisma schema, SQL RLS, seed, migrations;
- rotas: auth, admin, tenant, webhooks;
- workers: captura, enriquecimento, IA, mensagens, agendamento, billing, uso;
- integracoes: Evolution, Google Maps, BrasilAPI, Google Calendar, Asaas, OpenAI/Anthropic/Google AI;
- CI/CD, Docker, scripts e docs.

Gate de saida:

- Cada ativo tem dono de squad.
- Cada item critico tem status de evidencia.
- Lacunas usam a frase: "Nao determinado com as evidencias disponiveis."

## Fase 2 - Gates criticos

Gates P0/P1:

- RLS provado por teste DB-backed com Postgres, seed e SQL aplicado.
- Separacao entre `test:unit`, `test:integration` e `test:multi-tenant`.
- Validacao de `set_config`, transacoes e pool Prisma.
- Validacao de `SET ROLE guilds_admin` e reset de role no pool.
- CORS nao permissivo em producao.
- Mensagens de erro publicas sem vazamento interno.
- Logs sem segredos, tokens, payloads sensiveis ou PII desnecessaria.
- Uso de `executeRawUnsafe` revisado e substituido quando houver interpolacao evitavel.

Gate de saida:

- Nenhum achado P0 aberto.
- Todo P1 tem fix, mitigacao ou aceite formal de risco.
- CI diferencia teste unitario de teste com infraestrutura.

## Fase 3 - Auditoria por frente

Cada frente A-F deve entregar:

- checklist proprio preenchido;
- comandos rodados;
- testes verdes ou lacuna justificada;
- arquivos tocados;
- impactos em contratos;
- riscos residuais.

Gate de saida:

- PRs seguem ownership.
- Mudancas sensiveis tem revisao reforcada.
- OpenAPI, shared-types e mocks nao divergem sem registro.

## Fase 4 - Go-live readiness

Validar:

- smoke E2E capturar -> enriquecer -> conversar -> agendar;
- opt-out efetivo e rastreavel;
- LGPD, termos, privacidade e retencao;
- backup/restore, alertas, dashboards, runbooks e rollback;
- custos de IA/WhatsApp/Maps e billing;
- treinamento operacional do primeiro cliente.

Gate de saida:

- Relatorio final de auditoria emitido.
- Riscos aceitos aparecem com aprovador, data, escopo e prazo.
- Go-live recebe decisao `APROVADO` ou `APROVADO COM RESSALVAS`.

## Cadencia

- Diariamente: triagem de novos achados P0/P1.
- Por PR: revisao de evidencias e gate.
- Semanalmente: consolidacao da matriz, riscos aceitos e status dos squads.
- Pre-go-live: auditoria completa 3D.
