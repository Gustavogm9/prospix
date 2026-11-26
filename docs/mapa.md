# Mapa do onboarding

Escopo atualizado em 25/11/2026; base `928d4ac`. Onboarding de uma etapa por vez, com ações na própria rota.

- `apps/web/src/app/(dashboard)/layout.tsx:83`: guarda de sessão preservada; provedor de progresso envolve a rota dedicada e o shell.
- `apps/web/src/components/OnboardingFlow.tsx:50`: única consulta de progresso, refresh após gravação e polling de 20 s; descarta resposta após troca de identidade/geração.
- `apps/web/src/components/onboarding/OnboardingProgressContext.tsx:1`: compartilha a mesma confirmação entre o observador e a tela, eliminando a segunda consulta.
- `apps/web/src/components/OnboardingChecklist.tsx:18`: wizard, com uma etapa visível, progresso, erro/retry e continuar depois.
- `apps/web/src/components/onboarding/WhatsAppStep.tsx:8`: QR Code na etapa; chama o endpoint de conexão existente por ação explícita do OWNER; só sai após status confirmado.
- `apps/web/src/components/onboarding/NewLeadForm.tsx:10`: formulário compartilhado entre a etapa 2 e `/leads/novo`, mantendo validação e Idempotency-Key existentes.
- `apps/web/src/components/onboarding/SetupForms.tsx:17`: perfil ideal usando `icpsQueries.create`.
- `apps/web/src/components/onboarding/SetupForms.tsx:50`: contexto comercial, preservando campos existentes; sucesso exige resposta com o tenant esperado.
- `apps/web/src/components/onboarding/SetupForms.tsx:91`: roteiro com revisão explícita; reutiliza create/update existentes e confere status ACTIVE e texto retornados. Retém ID após criação para não duplicar no retry da ativação.
- `apps/web/src/lib/load-onboarding-progress.ts:5`: confirmação de conexão e cadastros em paralelo, com deadline e cancelamento de 10 s.
- `apps/web/src/app/api/integrations/whatsapp/status/route.ts:609`: `view=connection` consulta só canal ativo e provedor, sem diagnósticos/monitor da IA; tenant vem do gate existente e resposta é privada/no-store.
- `apps/web/src/app/login/page.tsx:74`: inicia sessão do guia por usuário/tenant.
- `apps/web/src/lib/onboarding-session.ts:1`: continuidade por identidade; estado local nunca comprova conclusão.
- `apps/web/src/app/(dashboard)/onbording/page.tsx:1`: rota dedicada; `/onboarding` continua redirecionando para ela.
- `apps/web/src/layout/AppShell.tsx:161`: retomada por Primeiros passos; o tutorial existente continua disponível manualmente.
- `apps/web/src/components/TutorialModal.tsx:52`: tutorial Como funciona abre após conclusão confirmada da última etapa.

Nenhum schema, migration, job ou policy alterados. Testes de integração usam rede interceptada e dados fictícios; não comprovam publicação nem o estado do banco remoto.

## Composição visual — 26/11/2026

- `apps/web/src/app/(dashboard)/onbording/page.tsx:1`: remove o limite de 768 px e usa a composição fluida.
- `apps/web/src/components/onboarding/onboarding-shell.module.css:1`: estrutura responsiva de até 1680 px, painel lateral de progresso, área principal e orientações contextuais; ajustes para celular e desktop baixo.
- `apps/web/src/components/OnboardingChecklist.tsx:1`: mesma etapa e mesmas confirmações, com resumo lateral não interativo e orientações para o formulário atual.
- `apps/web/src/components/onboarding/WhatsAppStep.tsx:1`: hierarquia visual, instruções numeradas e QR em destaque. Lógica de geração/verificação preservada.

Mudança somente de apresentação e composição; nenhum contrato de API, campo persistido ou política alterados.
