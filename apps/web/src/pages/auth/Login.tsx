import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, toast } from '@prospix/ui';
import { apiClient } from '../../lib/api-client';
import { useAuthStore } from '../../store/auth-store';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !email.includes('@')) {
      toast.error(
        'E-mail inválido',
        'Por favor, insira um e-mail válido para continuar.'
      );
      return;
    }

    if (!password.trim()) {
      toast.error(
        'Senha obrigatória',
        'Por favor, informe sua senha de acesso.'
      );
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/login', {
        email: email.trim(),
        password,
      });

      const { access_token, refresh_token, user } = response.data;

      // Save in Zustand auth store
      setSession(access_token, refresh_token, user);

      toast.success(
        'Acesso Autorizado!',
        `Olá, ${user.name}! Bem-vindo(a) de volta.`
      );

      // Redirect to main panel
      setTimeout(() => navigate('/'), 1000);
    } catch (error: any) {
      toast.error(
        'Erro ao entrar',
        error.response?.data?.message || 'E-mail ou senha incorretos. Verifique suas credenciais.'
      );
    } finally {
      setIsLoading(false);
    }
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

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
              E-mail Comercial
            </label>
            <Input
              type="email"
              placeholder="Ex: seuemail@corretora.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-500 focus-visible:bg-zinc-950/80 focus:border-blue-500/50 text-base h-12"
              disabled={isLoading}
              autoFocus
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
              Senha de Acesso
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Insira sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-500 focus-visible:bg-zinc-950/80 focus:border-blue-500/50 text-base h-12 pr-10"
                disabled={isLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 focus:outline-none"
                disabled={isLoading}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-12 rounded-xl transition-all shadow-lg shadow-blue-600/10 mt-2"
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Autenticando...</span>
              </div>
            ) : (
              'Entrar no Prospix'
            )}
          </Button>
        </form>

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
