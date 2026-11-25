# Mapa do onboarding

Escopo: navegação e apresentação do onboarding; levantamento em 25/11/2026, base local `578761c`.

- `apps/web/src/app/login/page.tsx:74`: inicia acompanhamento apenas para a identidade autenticada. O roteamento administrativo continua independente.
- `apps/web/src/app/(dashboard)/layout.tsx:59`: guarda de sessão do dashboard, preservada também no onboarding.
- `apps/web/src/app/(dashboard)/layout.tsx:83`: observador de progresso persiste entre rotas; somente `/onbording` usa o layout sem o menu das seções.
- `apps/web/src/app/(dashboard)/onbording/page.tsx:1`: página dedicada com checklist.
- `apps/web/src/app/(dashboard)/onboarding/page.tsx:1`: compatibilidade com a URL anterior por redirecionamento.
- `apps/web/src/components/OnboardingFlow.tsx:44`: confirma progresso; etapa nova encaminha à página dedicada; conclusão abre o tutorial no painel.
- `apps/web/src/components/OnboardingChecklist.tsx:25`: carregamento, erro, nova tentativa e ações sequenciais da página; dispensa encerra o acompanhamento.
- `apps/web/src/lib/load-onboarding-progress.ts:1`: fontes existentes de conexão e cadastros confirmados no tenant; nenhuma nova persistência de progresso.
- `apps/web/src/lib/onboarding-session.ts:1`: continuidade em memória/sessionStorage por tenant e pessoa.
- `apps/web/src/app/(dashboard)/leads/novo/page.tsx:45`: retorna à nova rota após confirmação de cadastro.
- `apps/web/src/app/(dashboard)/inicio/page.tsx:559`: boas-vindas aponta para o guia dedicado, sem citar um checklist abaixo do painel.
- `apps/web/src/layout/AppShell.tsx:161`: acesso para retomar os primeiros passos.
- `apps/web/src/layout/AppShell.tsx:545`: a abertura automática e os botões manuais usam o mesmo tutorial.
- `apps/web/src/components/TutorialModal.tsx:52`: tutorial existente, com diálogo acessível, foco contido e conteúdo rolável.
- `e2e/web/onboarding.spec.ts:1`: fluxo de navegador com rede interceptada e dados fictícios.

## Limites desta alteração

Somente código local de interface e navegação. Nenhum schema, migration, job, integração ou dado remoto alterado. Catálogo do banco e versão publicada não foram revalidados nesta fatia; a prova local não declara publicação.
