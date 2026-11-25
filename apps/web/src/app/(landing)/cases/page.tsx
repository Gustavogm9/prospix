'use client';

import React from 'react';

export default function CasesPage() {
  return (
    <div className="min-h-[100dvh] bg-bg font-sans text-text">
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
            EXEMPLO DE USO · DEMONSTRAÇÃO
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text mt-4 leading-tight">
            Como conduzir uma demonstração de prospecção consultiva
          </h1>
          <div className="flex items-center gap-3 my-6 border-b border-border-subtle pb-6">
            <div className="bg-primary/10 h-10 w-10 rounded-full flex items-center justify-center font-bold text-primary">
              GC
            </div>
            <div>
              <h4 className="text-xs font-bold text-text">Cenário ilustrativo</h4>
              <span className="text-2xs text-text-muted">Sem resultado comercial medido</span>
            </div>
          </div>

          <div className="space-y-6 text-xs text-text-secondary leading-relaxed">
            <h3 className="text-sm font-bold text-text uppercase">O Desafio</h3>
            <p>
              Um corretor precisa organizar a busca de contatos, a qualificação e o próximo atendimento. A demonstração percorre essas etapas com um contato interno autorizado.
            </p>

            <h3 className="text-sm font-bold text-text uppercase">A Solução</h3>
            <p>
              Configure região e público, prepare um roteiro com informações confirmadas e conecte os serviços que serão usados. Teste cada conexão antes de iniciar uma campanha.
            </p>
            <p>
              A IA pode conduzir a conversa e registrar a qualificação conforme o roteiro. Havendo interesse, a equipe confirma disponibilidade e registra a reunião; o painel confirma a sincronização somente após resposta do Google.
            </p>

            <h3 className="text-sm font-bold text-text uppercase">O que conferir</h3>
            <p>
              Confira a mensagem no WhatsApp, os fatos da qualificação, o evento no calendário e os registros do painel. Este exemplo não representa um depoimento ou resultado medido de cliente.
            </p>
            <p className="border-l-4 border-secondary pl-4 font-mono text-sm text-primary font-semibold bg-bg p-4 rounded">
              Antes de ativar a operação, valide conexões, conteúdo comercial, destinatários e limites com o responsável.
            </p>
          </div>
        </article>
      </main>
    </div>
  );
}
