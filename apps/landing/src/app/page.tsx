'use client';

import React, { useState } from 'react';

const loginUrl = process.env.NEXT_PUBLIC_LOGIN_URL || '/login';

export default function LandingPage() {
  const [leadForm, setLeadForm] = useState({ name: '', phone: '', volume: '500' });
  const [submitted, setSubmitted] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const faqs = [
    {
      q: 'Como funciona o isolamento dos dados da minha carteira?',
      a: 'A segurança é uma prioridade do Prospix. A plataforma adota controles de segregação lógica por tenant, incluindo Row Level Security (RLS) quando aplicável no banco de dados, para reduzir o risco de acesso indevido entre carteiras. Credenciais de integrações como WhatsApp e Google Calendar são tratadas em fluxos protegidos e com controles de criptografia conforme a configuração do ambiente.',
    },
    {
      q: 'A IA pode gerar banimento da minha conta do WhatsApp?',
      a: 'Nossa engine possui algoritmos integrados de aquecimento inteligente (warmup) e controle estrito de janelas de disparo que simulam a escrita humana natural, com intervalos dinâmicos (digitação gradual) entre as interações. Além disso, a IA apenas responde a leads que foram de alguma forma qualificados ou que solicitaram contato, operando dentro das políticas comerciais da Meta para evitar denúncias.',
    },
    {
      q: 'Como é feita a integração com o Google Calendar?',
      a: 'A conexão é direta e segura usando protocolo OAuth2 oficial. O Prospix lê a sua disponibilidade em tempo real (respeitando buffers de 15 minutos que configuramos para evitar reuniões coladas) e escreve o compromisso automaticamente no seu calendário assim que a IA confirma o interesse do lead. Os tokens de acesso são renovados automaticamente em ambiente seguro.',
    },
    {
      q: 'Eu posso personalizar o script e o tom de voz da IA?',
      a: 'Com certeza. Disponibilizamos um editor de roteiros onde você define o tom de voz da IA (ex: formal consultivo, mais dinâmico, uso de títulos como Dr./Dra. para médicos) e cria até 3 variações de mensagens. Nosso simulador integrado permite que você teste as respostas da inteligência artificial antes de colocá-la para rodar com leads reais.',
    },
    {
      q: 'O que acontece se o lead fizer uma pergunta muito complexa?',
      a: 'Nossos Guardrails de IA contêm regras rígidas de segurança. Se a conversa fugir do escopo comercial configurado, se o lead demonstrar irritação ou fizer uma pergunta técnica altamente específica que a IA não saiba responder, o sistema pausa a IA automaticamente, notifica você no painel e cria um alerta para escalonamento humano manual.',
    },
    {
      q: 'Quais são as fontes de captura dos leads?',
      a: 'O sistema realiza varreduras automáticas em segundo plano integradas diretamente ao Google Places (Maps). Você configura a especialidade e a região de interesse (ex: "Clínicas de Odontologia em Ribeirão Preto") e nosso worker captura, enriquece as informações cadastrais e calcula o Fit Score automaticamente com base nas receitas e dados da empresa antes de iniciar qualquer conversa.',
    },
    {
      q: 'Qual o prazo de setup inicial da plataforma?',
      a: 'Após a contratação por convite da Guilds e ativação da sua conta, o setup básico (conexão do WhatsApp, OAuth do Calendário e ativação do primeiro roteiro pré-configurado) leva menos de 10 minutos por meio do nosso checklist interativo de onboarding.',
    },
    {
      q: 'Quais as formas de pagamento e recorrência?',
      a: 'O faturamento é mensal via boleto ou PIX integrado da Asaas. Seus relatórios de consumo mostram exatamente o uso da franquia de tokens em tempo real na aba de faturamento das suas configurações.',
    },
  ];

  return (
    <div className="min-h-screen bg-bg font-sans overflow-x-hidden selection:bg-primary/20">
      {/* ── 1. NAV ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 bg-surface/80 backdrop-blur-md border-b border-border z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Logo SVG */}
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="6" className="fill-primary" />
              <path d="M10 22V10H16.5C18.9853 10 21 12.0147 21 14.5C21 16.9853 18.9853 19 16.5 19H13V22H10Z" fill="white" />
              <circle cx="16.5" cy="14.5" r="2.5" fill="#E8981C" />
            </svg>
            <span className="text-xl font-bold tracking-tight text-primary">Prospix</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-text-secondary">
            <a href="#como-funciona" className="hover:text-primary transition-colors">Como funciona</a>
            <a href="#planos" className="hover:text-primary transition-colors">Planos</a>
            <a href="#cases" className="hover:text-primary transition-colors">Cases</a>
            <a href="#faq" className="hover:text-primary transition-colors">Perguntas Frequentes</a>
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <a
              href={loginUrl}
              className="text-sm font-medium text-text-secondary hover:text-primary transition-colors"
            >
              Entrar
            </a>
            <a
              href="#contato"
              className="inline-flex items-center justify-center h-9 px-4 rounded text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-colors shadow-sm"
            >
              Falar com Guilds
            </a>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-text-secondary hover:text-primary hover:bg-surface-sunken focus:outline-none transition-colors"
              aria-expanded={isMobileMenuOpen}
              aria-label="Menu principal"
            >
              {isMobileMenuOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu Dropdown Panel */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-b border-border bg-surface px-4 pt-2 pb-6 space-y-3 shadow-lg animate-in slide-in-from-top duration-200">
            <nav className="flex flex-col gap-3">
              <a
                href="#como-funciona"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-primary hover:bg-surface-sunken transition-colors"
              >
                Como funciona
              </a>
              <a
                href="#planos"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-primary hover:bg-surface-sunken transition-colors"
              >
                Planos
              </a>
              <a
                href="#cases"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-primary hover:bg-surface-sunken transition-colors"
              >
                Cases
              </a>
              <a
                href="#faq"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-md text-base font-medium text-text-secondary hover:text-primary hover:bg-surface-sunken transition-colors"
              >
                Perguntas Frequentes
              </a>
            </nav>
            <div className="pt-4 border-t border-border-subtle flex flex-col gap-3">
              <a
                href={loginUrl}
                className="flex items-center justify-center h-10 px-4 rounded text-sm font-semibold text-text hover:bg-surface-sunken border border-border-strong transition-colors"
              >
                Entrar
              </a>
              <a
                href="#contato"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-center h-10 px-4 rounded text-sm font-semibold bg-primary text-white hover:bg-primary-hover transition-colors shadow-sm"
              >
                Falar com Guilds
              </a>
            </div>
          </div>
        )}
      </header>

      {/* ── 2. HERO SECTION ─────────────────────────────────────────────────── */}
      <section className="gradient-hero py-16 md:py-24 border-b border-border">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-text leading-tight max-w-4xl mx-auto">
            Sua máquina de prospecção que agenda{' '}
            <span className="text-primary border-b-4 border-secondary/30">reuniões qualificadas</span> no WhatsApp
          </h1>
          <p className="mt-6 text-base md:text-md text-text-secondary max-w-2xl mx-auto leading-relaxed">
            Pare de ligar para 100 contatos para falar com 10. A inteligência artificial do Prospix captura os leads ideais, inicia conversas humanas qualificadas e agenda no seu calendário. Você só aparece para vender.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#contato"
              className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-6 rounded text-sm font-semibold bg-primary text-white hover:bg-primary-hover transition-colors shadow-md"
            >
              Quero entender o funcionamento
            </a>
            <a
              href="#como-funciona"
              className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-6 rounded text-sm font-semibold bg-surface border border-border-strong text-text hover:bg-surface-sunken transition-colors shadow-sm"
            >
              Ver demonstração em 3 passos
            </a>
          </div>

          {/* Interactive Mockup Container */}
          <div className="mt-16 bg-surface rounded-lg shadow-lg border border-border overflow-hidden max-w-4xl mx-auto">
            {/* Window bar */}
            <div className="bg-surface-sunken h-10 px-4 flex items-center gap-2 border-b border-border">
              <div className="w-3 h-3 rounded-full bg-red-400"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
              <div className="w-3 h-3 rounded-full bg-green-400"></div>
              <div className="ml-4 bg-surface px-6 py-1 rounded text-2xs text-text-muted font-mono select-none">
                app.prospix.com.br/dashboard
              </div>
            </div>
            <div className="p-4 sm:p-6 bg-bg grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
              {/* Funnel card mockup */}
              <div className="bg-surface p-4 rounded border border-border-subtle shadow-sm md:col-span-2">
                <h4 className="text-xs font-semibold text-text-secondary mb-4">Etapas de Prospecção</h4>
                <div className="flex flex-col gap-2">
                  {[
                    { l: 'Capturados', c: 1420, p: 100 },
                    { l: 'WhatsApp Ativo', c: 840, p: 59 },
                    { l: 'Respondidos', c: 382, p: 27 },
                    { l: 'Qualificados (IA)', c: 180, p: 12 },
                    { l: 'Reuniões prontas', c: 42, p: 3 },
                  ].map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="w-24 text-text-secondary font-medium">{s.l}</span>
                      <div className="flex-1 bg-surface-sunken rounded-full h-4 overflow-hidden">
                        <div className="bg-primary h-full rounded-full" style={{ width: `${s.p}%` }} />
                      </div>
                      <span className="w-10 text-right font-mono font-semibold">{s.c}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Instant stats mockup */}
              <div className="flex flex-col gap-4">
                <div className="bg-surface p-4 rounded border border-border-subtle shadow-sm flex-1">
                  <span className="text-2xs text-text-muted font-semibold block uppercase">Conversas Ativas</span>
                  <span className="text-2xl font-bold text-primary font-mono">137</span>
                  <span className="text-2xs text-success-text bg-success-soft px-2 py-0.5 rounded-full inline-block mt-2">
                    ● IA Respondendo
                  </span>
                </div>
                <div className="bg-surface p-4 rounded border border-border-subtle shadow-sm flex-1">
                  <span className="text-2xs text-text-muted font-semibold block uppercase">Tempo de Resposta</span>
                  <span className="text-2xl font-bold text-text font-mono">~12s</span>
                  <span className="text-2xs text-text-secondary block mt-1">Totalmente automatizado</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. PROVA SOCIAL ─────────────────────────────────────────────────── */}
      <section className="bg-surface py-8 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <span className="text-2xs font-semibold text-text-muted uppercase block tracking-wider">
              Conexões operando nas principais seguradoras brasileiras
            </span>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12 opacity-80 filter grayscale hover:grayscale-0 transition-all">
            {/* Custom SVG MetLife */}
            <span className="text-sm font-bold tracking-tight text-text-secondary flex items-center gap-1.5">
              <svg className="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="currentColor">
                <rect width="24" height="24" rx="4" />
                <path d="M7 17V7h4v10H7zm6 0V7h4v10h-4z" fill="white" />
              </svg>
              MetLife
            </span>
            {/* Custom SVG Bradesco */}
            <span className="text-sm font-bold tracking-tight text-text-secondary flex items-center gap-1.5">
              <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 7l4 8H8l4-8z" fill="white" />
              </svg>
              Bradesco Seguros
            </span>
            {/* Custom SVG Prudential */}
            <span className="text-sm font-bold tracking-tight text-text-secondary flex items-center gap-1.5">
              <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12,4 20,18 4,18" />
              </svg>
              Prudential
            </span>
          </div>
          <div className="text-center">
            <span className="text-xl font-bold font-mono text-primary block">Fluxos auditáveis</span>
            <span className="text-2xs text-text-secondary">Operação comercial acompanhada por evidências</span>
          </div>
        </div>
      </section>

      {/* ── 4. COMO FUNCIONA ───────────────────────────────────────────────── */}
      <section id="como-funciona" className="py-20 bg-bg border-b border-border">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text">
              Sua máquina comercial em 3 passos simples
            </h2>
            <p className="mt-4 text-sm text-text-secondary">
              Nós automatizamos a parte cansativa do funil comercial para que você foque exclusivamente em fechar contratos.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Varredura & Captura',
                desc: 'Nossos robôs realizam varreduras automáticas de empresas no Google Places filtradas por especialidade e localização geográfica. Tudo de forma limpa e em conformidade.',
                icon: (
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                ),
              },
              {
                step: '02',
                title: 'Abordagem Inteligente',
                desc: 'A IA assume as conversas no WhatsApp utilizando a máscara de escrita humana. Ela contorna objeções, responde dúvidas do lead e analisa o Fit Score antes de oferecer sua agenda.',
                icon: (
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                ),
              },
              {
                step: '03',
                title: 'Compromisso Agendado',
                desc: 'Assim que o lead demonstra o interesse técnico ideal, a IA escolhe a melhor data no seu calendário integrado e confirma a reunião. Você recebe um e-mail com a notificação.',
                icon: (
                  <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ),
              },
            ].map((step, idx) => (
              <div key={idx} className="bg-surface p-6 rounded-lg border border-border-subtle shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 font-mono font-bold text-4xl text-primary/5 select-none transition-transform group-hover:scale-110">
                  {step.step}
                </div>
                <div className="bg-primary/5 p-3 rounded-full w-12 h-12 flex items-center justify-center mb-6">
                  {step.icon}
                </div>
                <h3 className="text-md font-semibold text-text">{step.title}</h3>
                <p className="mt-3 text-xs text-text-secondary leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. PARA QUEM É ─────────────────────────────────────────────────── */}
      <section className="py-20 bg-surface border-b border-border">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold tracking-tight text-text">Desenhado para quem vive de vendas ativas</h2>
            <p className="mt-4 text-sm text-text-secondary">
              Seja você um corretor autônomo ou o líder de uma estrutura corporativa, a automação multiplica sua capacidade operacional.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                t: 'Corretores Autônomos',
                p: 'Chega de perder tempo digitando "olá" ou batendo ligações frias. O Prospix atua como seu assistente comercial, enchendo sua agenda semanal enquanto você atende clientes.',
              },
              {
                t: 'Equipes de Vendas (2-5 corretores)',
                p: 'Distribua leads de forma otimizada para seus melhores vendedores. Um único painel de controle permite gerenciar as integrações de WhatsApp de todos os seus agentes.',
              },
              {
                t: 'Líderes de Expansão Regional',
                p: 'Tenha o controle consolidado de custos de IA, margens e qualidade do time em um dashboard unificado, respeitando permissões e segregação de dados por corretor.',
              },
            ].map((card, idx) => (
              <div key={idx} className="bg-bg p-6 rounded border border-border hover:shadow-md transition-shadow">
                <h3 className="text-sm font-semibold text-primary">{card.t}</h3>
                <p className="mt-4 text-xs text-text-secondary leading-relaxed">{card.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. RESULTADOS EM NÚMEROS ────────────────────────────────────────── */}
      <section className="py-20 bg-primary text-white border-b border-border">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Menos atrito operacional, mais produtividade comercial</h2>
          <p className="mt-4 text-sm text-white/80 max-w-xl mx-auto">
            Indicadores operacionais observados em simulações, pilotos e fluxos acompanhados pela equipe Guilds.
          </p>

          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div>
              <span className="text-4xl font-extrabold font-mono text-secondary block">Mais foco</span>
              <span className="text-sm font-medium mt-2 block">Agenda comercial</span>
              <span className="text-xs text-white/60 mt-1 block">Menos tempo gasto em tarefas repetitivas</span>
            </div>
            <div>
              <span className="text-4xl font-extrabold font-mono text-secondary block">Menos atrito</span>
              <span className="text-sm font-medium mt-2 block">Tempo de abordagem</span>
              <span className="text-xs text-white/60 mt-1 block">Automação assistida para reduzir trabalho manual</span>
            </div>
            <div>
              <span className="text-4xl font-extrabold font-mono text-secondary block">Visibilidade</span>
              <span className="text-sm font-medium mt-2 block">Operação e custos</span>
              <span className="text-xs text-white/60 mt-1 block">Métricas centralizadas para acompanhar eficiência</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. PLANOS ──────────────────────────────────────────────────────── */}
      <section id="planos" className="py-20 bg-surface border-b border-border">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold tracking-tight text-text">Valores simples, sem pegadinhas</h2>
            <p className="mt-4 text-sm text-text-secondary">
              Escolha o plano ideal para a sua estrutura. Todos contêm a suíte básica de segurança, isolamento e dashboard de performance.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
            {[
              {
                name: 'Essencial',
                price: 'R$ 290',
                period: '/mês',
                setup: 'Setup R$ 4.900',
                desc: 'Para corretores individuais iniciarem sua automação básica.',
                features: [
                  '1 Conexão WhatsApp ativa',
                  'Até 500 leads enriquecidos/mês',
                  'Integração Google Calendar',
                  'Filtro básico de Fit Score',
                  'Roteiro simples (1 base)',
                  'Suporte via ticket',
                ],
                recommended: false,
              },
              {
                name: 'Recomendado',
                price: 'R$ 490',
                period: '/mês',
                setup: 'Setup R$ 7.900',
                desc: 'A solução comercial completa com motor de inteligência avançado.',
                features: [
                  '1 Conexão WhatsApp ativa',
                  'Leads enriquecidos ILIMITADOS',
                  'Integração Google Calendar',
                  'Lógica avançada de Fit Score',
                  'Até 3 variações de roteiros',
                  'Histórico completo Asaas',
                  'Prioridade de suporte via WhatsApp',
                ],
                recommended: true,
              },
              {
                name: 'Premium Guilds',
                price: 'R$ 890',
                period: '/mês',
                setup: 'Setup sob consulta',
                desc: 'Para grandes corretores e líderes com múltiplos canais operando.',
                features: [
                  'Até 3 conexões de WhatsApp',
                  'Leads enriquecidos ILIMITADOS',
                  'Múltiplos calendários OAuth',
                  'Criptografia AES-256 no Secrets Vault',
                  'Suporte dedicado 1-on-1',
                  'Acesso antecipado a novos roteiros',
                ],
                recommended: false,
              },
            ].map((plan, idx) => (
              <div
                key={idx}
                className={`bg-surface rounded-lg border p-8 flex flex-col justify-between shadow-sm relative ${
                  plan.recommended ? 'border-2 border-primary ring-4 ring-primary/5' : 'border-border'
                }`}
              >
                {plan.recommended && (
                  <span className="absolute top-0 right-6 -translate-y-1/2 bg-primary text-white text-2xs font-semibold px-3 py-1 rounded-full uppercase">
                    Mais Popular ★
                  </span>
                )}
                <div>
                  <h3 className="text-md font-bold text-text">{plan.name}</h3>
                  <p className="text-2xs text-text-secondary mt-2 leading-relaxed min-h-[40px]">{plan.desc}</p>
                  <div className="mt-6">
                    <span className="text-3xl font-extrabold font-mono text-primary">{plan.price}</span>
                    <span className="text-xs text-text-secondary">{plan.period}</span>
                  </div>
                  <span className="text-2xs text-text-muted font-mono mt-1 block">{plan.setup}</span>

                  <ul className="mt-8 space-y-4 border-t border-border-subtle pt-6">
                    {plan.features.map((feat, fIdx) => (
                      <li key={fIdx} className="flex items-start gap-3 text-xs text-text-secondary">
                        <svg className="h-4 w-4 text-success flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-8">
                  <a
                    href="#contato"
                    className={`w-full inline-flex items-center justify-center h-10 rounded text-xs font-semibold transition-colors shadow-sm ${
                      plan.recommended
                        ? 'bg-primary text-white hover:bg-primary-hover'
                        : 'bg-surface border border-border-strong text-text hover:bg-surface-sunken'
                    }`}
                  >
                    Falar com time Guilds
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <a href="/planos" className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors underline">
              Ver tabela comparativa de features detalhada
            </a>
          </div>
        </div>
      </section>

      {/* ── 8. CASES SECTION ───────────────────────────────────────────────── */}
      <section id="cases" className="py-20 bg-bg border-b border-border">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center">
            <span className="text-2xs font-semibold text-primary uppercase block tracking-wider">Histórias de Sucesso</span>
            <h2 className="text-2xl font-bold tracking-tight text-text mt-2">Como Giovane Carrara otimizou seu funil MetLife</h2>
          </div>

          <div className="mt-12 bg-surface rounded-lg border border-border p-6 sm:p-10 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
            <div className="md:col-span-2 text-left">
              <p className="text-sm text-text-secondary leading-relaxed italic">
                "Eu gastava muitas horas em contatos frios e triagem manual. Com um fluxo assistido pelo Prospix, passei a chegar nas conversas comerciais com mais contexto e menos trabalho operacional repetitivo."
              </p>
              <div className="mt-6 flex items-center gap-3">
                <div className="bg-primary/10 h-10 w-10 rounded-full flex items-center justify-center font-bold text-primary">
                  GC
                </div>
                <div>
                  <h4 className="text-xs font-bold text-text">Giovane Carrara</h4>
                  <span className="text-2xs text-text-muted">Corretor Premium MetLife · SJRP</span>
                </div>
              </div>
            </div>
            <div className="bg-bg p-6 rounded border border-border-subtle text-center flex flex-col justify-center h-full">
              <span className="text-xs text-text-secondary block font-medium">Melhora do funil</span>
              <span className="text-3xl font-extrabold font-mono text-success mt-2 block">Mais cadência</span>
              <span className="text-2xs text-text-muted mt-1 block">Em acompanhamento comercial</span>
              <div className="border-t border-border my-4 pt-4">
                <a href="/cases" className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors">
                  Ler case completo →
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 9. FAQ SECTION ─────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 bg-surface border-b border-border">
        <div className="max-w-3xl mx-auto px-4">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight text-text">Dúvidas Frequentes</h2>
            <p className="mt-4 text-sm text-text-secondary">
              Encontre respostas para as principais dúvidas técnicas e comerciais.
            </p>
          </div>

          <div className="mt-12 space-y-4">
            {faqs.map((faq, idx) => (
              <div key={idx} className="border border-border rounded-lg overflow-hidden transition-colors bg-surface">
                <button
                  onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                  className="w-full flex items-center justify-between p-5 text-left font-medium text-text hover:bg-bg transition-colors focus:outline-none"
                  aria-expanded={activeFaq === idx}
                >
                  <span className="text-sm font-semibold pr-4">{faq.q}</span>
                  <svg
                    className={`w-5 h-5 text-text-muted transition-transform duration-300 ${activeFaq === idx ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    activeFaq === idx ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="p-5 border-t border-border-subtle bg-bg text-xs text-text-secondary leading-relaxed">
                      {faq.a}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 10. CTA FINAL & FORM ───────────────────────────────────────────── */}
      <section id="contato" className="py-20 bg-bg border-b border-border">
        <div className="max-w-xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-text">Bora trazer essa máquina para o seu funil?</h2>
          <p className="mt-4 text-sm text-text-secondary">
            Preencha os dados e receba um contato exclusivo do time comercial da Guilds para liberação do seu código de convite gated.
          </p>

          <div className="mt-10 bg-surface p-8 rounded-lg border border-border shadow-sm text-left">
            {submitted ? (
              <div className="py-8 text-center animate-in zoom-in-95 duration-200">
                <div className="bg-success-soft h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-md font-bold text-text">Entraremos em contato no WhatsApp!</h3>
                <p className="text-xs text-text-secondary mt-2 max-w-sm mx-auto leading-relaxed">
                  Agradecemos seu interesse. Sua solicitação foi registrada e o time comercial da Guilds fará a triagem pelo canal informado.
                </p>
              </div>
            ) : (
              <form onSubmit={handleFormSubmit} className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-xs font-semibold text-text-secondary mb-2">Nome Completo</label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={leadForm.name}
                    onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })}
                    placeholder="Seu nome"
                    className="w-full h-10 px-3 border border-border rounded bg-bg text-sm focus:bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-xs font-semibold text-text-secondary mb-2">WhatsApp para Contato</label>
                  <input
                    type="tel"
                    id="phone"
                    required
                    value={leadForm.phone}
                    onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })}
                    placeholder="+55 (11) 99999-9999"
                    className="w-full h-10 px-3 border border-border rounded bg-bg text-sm focus:bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="volume" className="block text-xs font-semibold text-text-secondary mb-2">Volume Mensal Desejado</label>
                  <select
                    id="volume"
                    value={leadForm.volume}
                    onChange={(e) => setLeadForm({ ...leadForm, volume: e.target.value })}
                    className="w-full h-10 px-3 border border-border rounded bg-bg text-sm focus:bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  >
                    <option value="500">Até 500 leads/mês</option>
                    <option value="1000">500 a 2.000 leads/mês</option>
                    <option value="5000">Mais de 2.000 leads/mês</option>
                  </select>
                </div>
                <div className="flex items-start gap-3">
                  <input type="checkbox" id="terms" required className="h-4 w-4 text-primary border-border-strong rounded mt-0.5" />
                  <label htmlFor="terms" className="text-2xs text-text-secondary leading-relaxed">
                    Autorizo a Guilds a processar meus dados cadastrais para fins comerciais e aceito os{' '}
                    <a href="/termos" className="text-primary underline underline-offset-2 hover:text-primary-hover">Termos de Uso</a> e{' '}
                    <a href="/privacidade" className="text-primary underline underline-offset-2 hover:text-primary-hover">Políticas de Privacidade</a>.
                  </label>
                </div>
                <button
                  type="submit"
                  className="w-full h-11 bg-primary text-white rounded text-sm font-semibold hover:bg-primary-hover transition-colors shadow"
                >
                  Solicitar Acesso & Código de Convite
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* ── 11. FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="bg-surface border-t border-border py-12 text-text-secondary text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-6 h-6 text-primary" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="6" className="fill-primary" />
                <path d="M10 22V10H16.5C18.9853 10 21 12.0147 21 14.5C21 16.9853 18.9853 19 16.5 19H13V22H10Z" fill="white" />
                <circle cx="16.5" cy="14.5" r="2.5" fill="#E8981C" />
              </svg>
              <span className="text-md font-bold text-primary">Prospix</span>
            </div>
            <p className="text-2xs text-text-muted leading-relaxed">
              Plataforma SaaS multi-tenant com práticas alinhadas à LGPD e controles de isolamento lógico de dados.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-text mb-3">Links do Produto</h4>
            <ul className="space-y-2">
              <li><a href="#como-funciona" className="hover:text-primary">Como Funciona</a></li>
              <li><a href="#planos" className="hover:text-primary">Tabela de Planos</a></li>
              <li><a href="#cases" className="hover:text-primary">Histórias de Sucesso</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-text mb-3">Institucional & LGPD</h4>
            <ul className="space-y-2">
              <li><a href="/lgpd" className="hover:text-primary">Central LGPD & DPIA</a></li>
              <li><a href="/termos" className="hover:text-primary">Termos de Uso</a></li>
              <li><a href="/privacidade" className="hover:text-primary">Políticas de Privacidade</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-text mb-3">Contato & Suporte</h4>
            <p className="text-2xs leading-relaxed text-text-muted mb-2">
              Dúvidas técnicas ou faturamento corporativo? Fale direto conosco.
            </p>
            <a href="mailto:contato@prospix.com.br" className="text-primary hover:underline font-semibold block mb-1">
              contato@prospix.com.br
            </a>
            <a href="/contato" className="text-primary hover:underline block">
              Página de Suporte e Tickets
            </a>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-border-subtle mt-8 pt-8 text-center text-2xs text-text-muted">
          © {new Date().getFullYear()} Prospix. Desenvolvido com orgulho pelo time de inteligência artificial da Guilds.
        </div>
      </footer>
    </div>
  );
}
