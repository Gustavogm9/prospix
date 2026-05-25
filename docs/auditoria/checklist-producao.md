# Checklist de Producao

Data: 2026-05-23

Este checklist fecha os pontos operacionais que nao devem ficar mockados, hardcoded ou dependentes de modo demo antes do deploy.

## 1. Ambiente e segredos

- [ ] Conferir `NODE_ENV=production` em API, workers e web.
- [ ] Conferir `DEMO_MODE=false`, `VITE_ENABLE_DEMO_MODE=false` e qualquer flag equivalente.
- [ ] Remover credenciais reais de arquivos `.env`, fixtures, seeds e docs versionadas.
- [ ] Configurar segredos em secret manager ou variaveis protegidas do provedor de deploy.
- [ ] Rotacionar chaves que tenham passado por ambiente local, logs ou screenshots.
- [ ] Validar `JWT_SECRET`, `ENCRYPTION_KEY`, chaves OpenAI, WhatsApp, Google, SMTP e banco com valores diferentes de desenvolvimento.

## 2. Banco, tenants e RLS

- [ ] Aplicar migrations em staging e conferir rollback documentado.
- [ ] Rodar smoke de login, criacao de tenant, listagem de leads, conversas e agenda com dois tenants diferentes.
- [ ] Confirmar que nenhum endpoint retorna dados sem `tenantId`.
- [ ] Confirmar que os testes de isolamento multi-tenant estao ativos no CI.
- [ ] Conferir politicas de backup, retencao e restore testado.

## 3. Integracoes externas

- [ ] WhatsApp: validar webhook, assinatura, envio real e tratamento de falha.
- [ ] Google Agenda: validar OAuth, criacao de evento, remarcacao e cancelamento.
- [ ] OpenAI: validar modelo, limites, timeout, fallback operacional e logs sem prompt sensivel.
- [ ] E-mail/SMS, se ativo: validar remetente, dominios, bounce e opt-out.
- [ ] Filas: validar Redis/queue, DLQ, replay e alertas de jobs parados.

## 4. Fluxos criticos

- [ ] Criar lead manual pelo pipeline e verificar persistencia.
- [ ] Mover lead entre etapas e verificar status no banco.
- [ ] Iniciar conversa a partir da ficha do lead.
- [ ] Enviar mensagem manual em conversa existente.
- [ ] Agendar reuniao em slot vazio e verificar fila `schedule-meeting`.
- [ ] Alterar status da reuniao para confirmada, concluida e cancelada.
- [ ] Exportar CSV de leads reais.
- [ ] Verificar dashboard com tenant sem dados, tenant com dados e falha de API.

## 5. Observabilidade e seguranca

- [ ] Configurar logs estruturados com `tenantId`, `requestId` e sem segredos.
- [ ] Configurar alertas para erro 5xx, fila atrasada, DLQ, login falhando e integracao externa fora.
- [ ] Validar CORS, cookies, headers de seguranca e rate limit.
- [ ] Conferir que respostas 401/403 nao vazam detalhes internos.
- [ ] Rodar varredura por `mock`, `hardcoded`, `TODO`, `stub`, `fake`, `demo` e `localhost`.

## 6. Deploy e aceite

- [ ] Rodar `npx tsc --noEmit --project apps/api/tsconfig.json`.
- [ ] Rodar `npx tsc --noEmit --project apps/web/tsconfig.json`.
- [ ] Rodar `npm test`.
- [ ] Rodar smoke de staging com usuario real e tenant limpo.
- [ ] Criar snapshot/backup antes de migrar producao.
- [ ] Definir criterio de rollback e dono da janela de deploy.

## Bloqueios tecnicos resolvidos no codigo

- [x] Persistencia de credenciais em `Configuracoes` com backend dedicado, permissao administrativa, mascaramento e armazenamento criptografado.
- [x] Aba de `Faturamento` consumindo `tenant_usage` e `tenant_billing` reais, sem Pix/faturas mockadas no frontend.
- [x] Dados demo mantidos somente atras de flag e bloqueados em build de producao.
- [x] `VITE_API_URL`, Supabase e URLs publicas/Redis com guardas para nao subir producao apontando para localhost/default local.
- [x] Saude de tenant no Admin calculada a partir de credenciais/integracoes reais, sem derivar apenas do status comercial.

## Decisoes operacionais ainda necessarias

- Metas financeiras: manter origem em API/configuracao por tenant. Evitar valor padrao hardcoded como meta de producao.
- Credenciais reais: configurar no provedor de deploy/secret manager e rotacionar qualquer chave usada fora de ambiente controlado.
- Smoke final: validar staging com tenant limpo, usuario real e integracoes externas reais antes da janela de producao.
