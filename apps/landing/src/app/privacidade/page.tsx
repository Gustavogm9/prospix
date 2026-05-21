'use client';

import React from 'react';

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-bg font-sans text-text py-12 px-4">
      <div className="max-w-3xl mx-auto bg-surface rounded-lg border border-border p-8 sm:p-12 shadow-sm">
        <h1 className="text-xl sm:text-2xl font-bold text-primary">Políticas de Privacidade</h1>
        <p className="text-2xs text-text-muted mt-1">Última atualização: 21 de Maio de 2026</p>

        <div className="mt-8 space-y-6 text-xs text-text-secondary leading-relaxed">
          <p>
            O Prospix tem o compromisso inalienável de manter a confidencialidade e a segurança das suas informações de funil comercial. Esta política de privacidade descreve como coletamos e protegemos os seus dados de acesso em conformidade com as melhores práticas de mercado.
          </p>

          <h3 className="text-sm font-bold text-text">1. Coleta de Dados</h3>
          <p>
            Coletamos dados básicos cadastrais (nome, WhatsApp, SUSEP e e-mail) fornecidos no momento do onboarding para gerenciar sua assinatura mensal. Não armazenamos ou compartilhamos dados de conversas com empresas terceiras.
          </p>

          <h3 className="text-sm font-bold text-text">2. Criptografia no Secrets Vault</h3>
          <p>
            Suas credenciais externas de conexão, como tokens da Evolution API ou chaves de API do Google OAuth, são encriptadas de forma unidirecional usando algoritmos AES-256-GCM. A decodificação só ocorre dinamicamente na memória RAM durante a execução dos workers.
          </p>

          <h3 className="text-sm font-bold text-text">3. Direitos e Exclusão</h3>
          <p>
            Você pode requerer a remoção completa de seus dados e registros de conexão das nossas bases de dados entrando em contato direto com nosso encarregado legal.
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
