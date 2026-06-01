'use client';

import React, { useState } from 'react';

export default function ContatoPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-bg font-sans text-text py-12 px-4">
      <div className="max-w-xl mx-auto bg-surface rounded-lg border border-border p-8 shadow-sm">
        <h1 className="text-xl font-bold text-primary">Contato & Suporte</h1>
        <p className="text-xs text-text-secondary mt-2">
          Abra um chamado de suporte ou tire suas dúvidas técnicas diretamente com a Guilds.
        </p>

        {sent ? (
          <div className="py-12 text-center animate-in zoom-in-95 duration-200">
            <div className="bg-success-soft h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-md font-bold text-text">Chamado Aberto com Sucesso!</h3>
            <p className="text-xs text-text-secondary mt-2 max-w-sm mx-auto leading-relaxed">
              Registramos sua mensagem comercial. Nossa equipe entrará em contato via e-mail ou WhatsApp em até 2 horas comerciais.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold text-text-secondary mb-2">Nome Completo</label>
              <input
                type="text"
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-10 px-3 border border-border rounded bg-bg text-sm focus:bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-text-secondary mb-2">Seu E-mail</label>
              <input
                type="email"
                id="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-10 px-3 border border-border rounded bg-bg text-sm focus:bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="subject" className="block text-xs font-semibold text-text-secondary mb-2">Assunto do Chamado</label>
              <input
                type="text"
                id="subject"
                required
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full h-10 px-3 border border-border rounded bg-bg text-sm focus:bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-xs font-semibold text-text-secondary mb-2">Detalhes da Solicitação</label>
              <textarea
                id="message"
                required
                rows={4}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="w-full p-3 border border-border rounded bg-bg text-sm focus:bg-surface focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <a href="/" className="inline-flex items-center justify-center h-10 px-4 rounded text-xs font-semibold bg-surface border border-border-strong text-text hover:bg-surface-sunken transition-colors">
                Cancelar
              </a>
              <button
                type="submit"
                className="inline-flex items-center justify-center h-10 px-6 rounded text-xs font-semibold bg-primary text-white hover:bg-primary-hover transition-colors shadow"
              >
                Enviar Chamado
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
