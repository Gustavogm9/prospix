'use client';

import React from 'react';

export default function PlanosPage() {
  const features = [
    { name: 'WhatsApp Web API', base: 'Sim (1 canal)', advanced: 'Sim (1 canal)', premium: 'Sim (Até 3 canais)' },
    { name: 'Leads do Google Maps', base: 'Limitado (500/mês)', advanced: 'ILIMITADO', premium: 'ILIMITADO' },
    { name: 'Algoritmo de Fit Score', base: 'Sim (Regras simples)', advanced: 'Sim (Lógica complexa)', premium: 'Sim (Lógica complexa)' },
    { name: 'Editor de Roteiros (Engine)', base: 'Apenas mensagem base', advanced: 'Base + 3 variações', premium: 'Base + 3 variações' },
    { name: 'OAuth Google Calendar', base: 'Sim', advanced: 'Sim', premium: 'Múltiplos calendários' },
    { name: 'Dashboard em Tempo Real', base: 'Sim', advanced: 'Sim (SWR cache)', premium: 'Sim (SWR cache)' },
    { name: 'Notificações por Email/SMS', base: 'Sim', advanced: 'Sim', premium: 'Sim' },
    { name: 'Isolamento de Banco (RLS)', base: 'Sim (Row Level)', advanced: 'Sim (Row Level)', premium: 'Sim (Row Level)' },
    { name: 'Chaves Criptografadas no Vault', base: 'Sim', advanced: 'Sim (AES-256)', premium: 'Sim (AES-256)' },
    { name: 'Faturamento Integrado Asaas', base: 'Sim', advanced: 'Sim', premium: 'Sim' },
    { name: 'Suporte Técnico', base: 'Email / Ticket', advanced: 'WhatsApp Prioritário', premium: 'Gerente Dedicado 24h' },
  ];

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      {/* Header */}
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

      {/* Hero */}
      <section className="py-12 md:py-16 text-center max-w-4xl mx-auto px-4">
        <h1 className="text-2xl md:text-4xl font-bold text-text">Estrutura Detalhada de Features</h1>
        <p className="text-sm text-text-secondary mt-3">
          Compara os limites técnicos e operacionais de cada um dos nossos planos comerciais.
        </p>
      </section>

      {/* Comparison Table */}
      <section className="max-w-4xl mx-auto px-4 pb-20">
        <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border bg-bg">
                  <th className="p-4 font-bold text-text w-1/3">Funcionalidade / Recursos</th>
                  <th className="p-4 font-bold text-text-secondary text-center">Essencial</th>
                  <th className="p-4 font-bold text-primary text-center bg-primary/5">Recomendado ★</th>
                  <th className="p-4 font-bold text-text-secondary text-center">Premium</th>
                </tr>
              </thead>
              <tbody>
                {features.map((feat, idx) => (
                  <tr key={idx} className="border-b border-border-subtle hover:bg-bg/50 transition-colors">
                    <td className="p-4 font-semibold text-text">{feat.name}</td>
                    <td className="p-4 text-center text-xs text-text-secondary">{feat.base}</td>
                    <td className="p-4 text-center text-xs text-primary font-semibold bg-primary/5">{feat.advanced}</td>
                    <td className="p-4 text-center text-xs text-text-secondary">{feat.premium}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pricing CTA */}
        <div className="mt-12 p-8 bg-surface border border-border rounded-lg shadow-sm text-center">
          <h3 className="text-md font-bold text-text">Pronto para começar?</h3>
          <p className="text-xs text-text-secondary mt-2">
            Disponibilizamos planos adequados a partir de R$ 290/mês. Fale com nossos consultores da Guilds para receber seu convite de ativação imediata.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/#contato" className="w-full sm:w-auto inline-flex items-center justify-center h-10 px-6 rounded text-xs font-semibold bg-primary text-white hover:bg-primary-hover transition-colors shadow">
              Falar com o Comercial
            </a>
            <a href="/" className="w-full sm:w-auto inline-flex items-center justify-center h-10 px-6 rounded text-xs font-semibold bg-surface border border-border-strong text-text hover:bg-surface-sunken transition-colors">
              Voltar para a Home
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
