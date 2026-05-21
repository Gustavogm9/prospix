'use client';

import React from 'react';

export default function CasesPage() {
  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      <header className="bg-surface border-b border-border py-6 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="6" fill="#1B3A6B"/>
              <path d="M10 22V10H16.5C18.9853 10 21 12.0147 21 14.5C21 16.9853 18.9853 19 16.5 19H13V22H10Z" fill="white"/>
              <circle cx="16.5" cy="14.5" r="2.5" fill="#E8981C"/>
            </svg>
            <span className="text-xl font-bold tracking-tight text-primary">Prospix</span>
          </a>
          <a href="/" className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors">
            ← Voltar para Home
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-16">
        <article className="bg-surface rounded-lg border border-border p-8 sm:p-12 shadow-sm text-left">
          <span className="text-2xs font-bold text-success bg-success-soft px-3 py-1 rounded-full uppercase tracking-wider">
            CASE DE SUCESSO · METLIFE
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text mt-4 leading-tight">
            Como Giovane Carrara aumentou em 3.2x seus agendamentos de seguro corporativo
          </h1>
          <div className="flex items-center gap-3 my-6 border-b border-border-subtle pb-6">
            <div className="bg-primary/10 h-10 w-10 rounded-full flex items-center justify-center font-bold text-primary">
              GC
            </div>
            <div>
              <h4 className="text-xs font-bold text-text">Giovane Carrara</h4>
              <span className="text-2xs text-text-muted">Corretor MetLife · São José do Rio Preto, SP</span>
            </div>
          </div>

          <div className="space-y-6 text-xs text-text-secondary leading-relaxed">
            <h3 className="text-sm font-bold text-text uppercase">O Desafio</h3>
            <p>
              Como corretor individual, Giovane passava até 5 horas por dia filtrando clínicas, hospitais e consultórios médicos no Google e batendo ligações "frias" para tentar agendar reuniões com sócios ou gerentes. A taxa de atendimento era inferior a 10%, gerando desgaste comercial e poucas oportunidades qualificadas na semana.
            </p>

            <h3 className="text-sm font-bold text-text uppercase">A Solução</h3>
            <p>
              Em parceria com a Guilds, Giovane conectou a API do Prospix ao seu canal do WhatsApp e ativou um fluxo de varredura automatizada focado em clínicas odontológicas e veterinárias de sua região. 
            </p>
            <p>
              A inteligência artificial do Prospix passou a capturar os contatos, cruzar dados com a BrasilAPI e ReceitaWS para calcular o Fit Score, e iniciar conversas consultivas amigáveis no WhatsApp. Caso o lead mostrasse interesse, a IA lia sua disponibilidade em tempo real no Google Calendar integrado e finalizava o agendamento.
            </p>

            <h3 className="text-sm font-bold text-text uppercase">O Resultado</h3>
            <p>
              No primeiro mês de operação, o sistema realizou a abordagem automática de 740 leads da região. A taxa de resposta atingiu 32% e, dessas, a IA agendou com sucesso <strong>42 reuniões qualificadas</strong> de seguro corporativo de forma totalmente autônoma.
            </p>
            <p className="border-l-4 border-secondary pl-4 font-mono text-sm text-primary font-semibold bg-bg p-4 rounded">
              "Hoje eu não gasto 1 minuto sequer escrevendo mensagens ou ligando. Minha única função é receber o aviso do Google Calendar, entrar no Meet na hora marcada e apresentar a cotação. Minha produtividade cresceu 3.2x."
            </p>
          </div>
        </article>
      </main>
    </div>
  );
}
