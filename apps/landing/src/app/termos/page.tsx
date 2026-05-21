'use client';

import React from 'react';

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-bg font-sans text-text py-12 px-4">
      <div className="max-w-3xl mx-auto bg-surface rounded-lg border border-border p-8 sm:p-12 shadow-sm">
        <h1 className="text-xl sm:text-2xl font-bold text-primary">Termos de Uso</h1>
        <p className="text-2xs text-text-muted mt-1">Última atualização: 21 de Maio de 2026</p>

        <div className="mt-8 space-y-6 text-xs text-text-secondary leading-relaxed">
          <p>
            Bem-vindo ao Prospix. Ao contratar nossos planos ou utilizar nosso software multi-tenant de prospecção comercial inteligente, você aceita de forma irrestrita estes Termos de Uso.
          </p>

          <h3 className="text-sm font-bold text-text">1. Objeto</h3>
          <p>
            O Prospix disponibiliza licenças de uso de software por prazo determinado, fornecendo infraestrutura técnica isolada para atuar em segundo plano automatizando mensagens, capturas no Google Places e agendamento de reuniões comerciais.
          </p>

          <h3 className="text-sm font-bold text-text">2. Responsabilidades do Usuário (Controlador)</h3>
          <p>
            O contratante é o único responsável pela legalidade das bases de dados que processa e pela autorização jurídica para iniciar abordagens comerciais pelo WhatsApp. O Prospix atua estritamente como ferramenta tecnológica de execução automática.
          </p>

          <h3 className="text-sm font-bold text-text">3. Faturamento e Suspensão</h3>
          <p>
            A recorrência mensal é faturada pela Asaas via boleto bancário ou PIX. Conforme nossa régua financeira, atrasos superiores a 15 dias corridos (D+15) ensejam suspensão técnica imediata da licença de uso do software até a devida regularização de saldos.
          </p>
        </div>

        <div className="mt-8 border-t border-border-subtle pt-6 flex justify-end">
          <a href="/" className="inline-flex items-center justify-center h-10 px-4 rounded text-xs font-semibold bg-primary text-white hover:bg-primary-hover transition-colors shadow">
            Voltar para a Home
          </a>
        </div>
      </div>
    </div>
  );
}
