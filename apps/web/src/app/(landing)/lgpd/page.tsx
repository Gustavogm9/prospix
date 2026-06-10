'use client';

import React from 'react';

export default function LgpdPage() {
  return (
    <div className="min-h-[100dvh] bg-bg font-sans text-text py-12 px-4">
      <div className="max-w-3xl mx-auto bg-surface rounded-lg border border-border p-8 sm:p-12 shadow-sm">
        <h1 className="text-xl sm:text-2xl font-bold text-primary">Diretrizes de Proteção de Dados (LGPD)</h1>
        <p className="text-2xs text-text-muted mt-1">Última atualização: 21 de Maio de 2026</p>

        <div className="mt-8 space-y-6 text-xs text-text-secondary leading-relaxed">
          <p>
            O Prospix, operado tecnicamente pela Guilds no modelo SaaS multi-tenant, busca atuar de forma alinhada à Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/18). Em geral, atuamos como <strong>Operador</strong> no processamento dos dados comerciais inseridos por nossos clientes, que exercem o papel de <strong>Controladores</strong>.
          </p>

          <h3 className="text-sm font-bold text-text">1. Isolamento Lógico e Row Level Security (RLS)</h3>
          <p>
            Adotamos controles de segregação lógica por tenant, incluindo Row Level Security (RLS) quando aplicável, para reduzir o risco de acesso indevido entre carteiras e contatos comerciais. Esses controles fazem parte de uma estratégia mais ampla de segurança, auditoria e revisão contínua.
          </p>

          <h3 className="text-sm font-bold text-text">2. Direitos dos Titulares dos Dados</h3>
          <p>
            Como titular, você pode solicitar confirmação da existência de tratamento, acesso, correção ou exclusão de dados pessoais. Os pedidos serão analisados conforme a LGPD, os contratos aplicáveis e eventuais obrigações de retenção legal, segurança ou prevenção a fraudes.
          </p>

          <h3 className="text-sm font-bold text-text">3. Contato com o DPO</h3>
          <p>
            Para consultas relacionadas à LGPD, exclusão de contatos ou solicitações de direitos de titular, envie um e-mail para: <a href="mailto:dpo@prospix.com.br" className="text-primary hover:underline font-semibold">dpo@prospix.com.br</a>. Respondemos a todas as solicitações oficiais em até 5 dias úteis.
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
