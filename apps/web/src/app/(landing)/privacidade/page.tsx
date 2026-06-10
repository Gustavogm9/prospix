'use client';

import React from 'react';

export default function PrivacidadePage() {
  return (
    <div className="min-h-[100dvh] bg-bg font-sans text-text py-12 px-4">
      <div className="max-w-3xl mx-auto bg-surface rounded-lg border border-border p-8 sm:p-12 shadow-sm">
        <h1 className="text-xl sm:text-2xl font-bold text-primary">Políticas de Privacidade</h1>
        <p className="text-2xs text-text-muted mt-1">Última atualização: 21 de Maio de 2026</p>

        <div className="mt-8 space-y-6 text-xs text-text-secondary leading-relaxed">
          <p>
            O Prospix se compromete a tratar informações do funil comercial com confidencialidade e controles de segurança compatíveis com uma aplicação SaaS multi-tenant. Esta política de privacidade descreve como coletamos, usamos e protegemos dados pessoais de acordo com a LGPD e com as práticas adotadas pela plataforma.
          </p>

          <h3 className="text-sm font-bold text-text">1. Coleta de Dados</h3>
          <p>
            Coletamos dados básicos cadastrais (nome, WhatsApp, SUSEP e e-mail) fornecidos no onboarding, além de informações necessárias para operar convites, autenticação, suporte, faturamento e fluxos comerciais configurados pelo cliente. Dados de conversas podem ser tratados quando necessários para executar, auditar ou melhorar a operação contratada, e não são vendidos a terceiros.
          </p>

          <h3 className="text-sm font-bold text-text">2. Proteção de Credenciais</h3>
          <p>
            Credenciais externas de conexão, como tokens da Evolution API ou chaves de API do Google OAuth, são protegidas por controles técnicos de acesso e criptografia quando aplicável. O uso dessas credenciais ocorre apenas para executar integrações configuradas pelo cliente e dentro dos limites necessários à operação.
          </p>

          <h3 className="text-sm font-bold text-text">3. Direitos e Exclusão</h3>
          <p>
            Você pode solicitar acesso, correção ou exclusão de dados pessoais entrando em contato com nosso canal de privacidade. Cada solicitação será avaliada conforme a LGPD, os contratos aplicáveis e eventuais obrigações de retenção legal ou segurança.
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
