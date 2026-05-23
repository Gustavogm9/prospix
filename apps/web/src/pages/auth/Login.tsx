import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, toast } from '@prospix/ui';
import { apiClient } from '../../lib/api-client';

export default function Login() {
  const [whatsapp, setWhatsapp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const navigate = useNavigate();

  // Handle WhatsApp masking: +55 (XX) XXXXX-XXXX
  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    
    // Auto prefix 55 if user didn't type it and types 10+ digits
    if (value.length > 0 && !value.startsWith('55') && value.length >= 10) {
      value = '55' + value;
    } else if (value.length === 0) {
      value = '';
    }

    // Format visual mask
    let formatted = '';
    if (value.length > 0) {
      formatted += '+' + value.substring(0, 2);
    }
    if (value.length > 2) {
      formatted += ' (' + value.substring(2, 4) + ')';
    }
    if (value.length > 4) {
      formatted += ' ' + value.substring(4, 9);
    }
    if (value.length > 9) {
      formatted += '-' + value.substring(9, 13);
    }

    setWhatsapp(formatted);
  };

  const getRawWhatsapp = (formatted: string) => {
    return formatted.replace(/\D/g, '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawNumber = getRawWhatsapp(whatsapp);
    
    if (rawNumber.length < 12) {
      toast.error(
        'Número inválido',
        'Por favor, insira o número do WhatsApp com o DDD e o DDI (ex: +55 (11) 99999-9999).'
      );
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/magic-link', {
        whatsapp: rawNumber,
      });

      if (response.data.success) {
        setIsSent(true);
        setCountdown(60);
        toast.success(
          'Link Enviado!',
          'Enviamos um link mágico de acesso para o seu WhatsApp cadastrado.'
        );
      }
    } catch (error: any) {
      toast.error(
        'Erro ao enviar',
        error.response?.data?.message || 'Verifique se este número está cadastrado.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isSent && countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [isSent, countdown]);

  const handleResend = async () => {
    if (countdown > 0) return;
    setIsSent(false);
    handleSubmit({ preventDefault: () => {} } as React.FormEvent);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-50 relative overflow-hidden px-4">
      {/* Background gradients for premium look */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[420px] bg-zinc-900/60 backdrop-blur-md border border-zinc-800 p-8 rounded-2xl shadow-2xl relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <span className="font-heading text-xl font-bold text-white tracking-wider">P</span>
          </div>
          <h2 className="text-2xl font-bold font-heading text-zinc-50">Acessar Prospix</h2>
          <p className="text-sm text-zinc-400 mt-1 text-center">
            A forma mais inteligente de prospectar apólices pelo WhatsApp.
          </p>
        </div>

        {!isSent ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
                Número do WhatsApp
              </label>
              <Input
                type="text"
                placeholder="+55 (11) 99999-9999"
                value={whatsapp}
                onChange={handleWhatsappChange}
                className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-500 focus-visible:bg-zinc-950/80 focus:border-blue-500/50 text-base h-12"
                disabled={isLoading}
                autoFocus
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-12 rounded-xl transition-all shadow-lg shadow-blue-600/10"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Enviando link...</span>
                </div>
              ) : (
                'Receber Link Mágico via WhatsApp'
              )}
            </Button>
          </form>
        ) : (
          <div className="text-center space-y-6 animate-fadeIn">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 19v-8.93a2 2 0 01.89-1.664l8-5.333a2 2 0 012.22 0l8 5.333A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-zinc-100">Verifique seu WhatsApp</h3>
              <p className="text-sm text-zinc-400 px-4">
                Enviamos uma mensagem contendo o link de autenticação de clique único. Toque nele para acessar o painel.
              </p>
            </div>

            <div className="pt-4 border-t border-zinc-800/60">
              {countdown > 0 ? (
                <p className="text-xs text-zinc-400">
                  Aguarde <span className="text-zinc-400 font-mono font-medium">{countdown}s</span> para reenviar.
                </p>
              ) : (
                <button
                  onClick={handleResend}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold underline underline-offset-4"
                >
                  Não recebeu? Enviar novamente
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-xs text-zinc-400">
            Ainda não tem conta?{' '}
            <button
              onClick={() => navigate('/cadastro')}
              className="text-blue-400 hover:text-blue-300 font-semibold"
            >
              Inscreva-se com um convite
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
