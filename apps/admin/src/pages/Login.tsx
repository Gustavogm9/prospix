import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, toast } from '@prospix/ui';
import { useAdminAuthStore } from '../store/admin-auth-store';
import { ShieldCheck, Lock, Mail } from 'lucide-react';
import axios, { AxiosError } from 'axios';
import { API_BASE_URL } from '../lib/api-client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { setAdminSession } = useAdminAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Campos vazios', 'Por favor, preencha todos os campos para autenticar.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/auth/admin-login`, {
        email,
        password,
      });

      const { access_token, user } = response.data;

      setAdminSession(access_token, {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });

      toast.success('Acesso Autorizado', 'Conexão ativa com o banco de dados.');
      navigate('/');
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Credenciais inválidas ou erro ao conectar com o servidor.'
        : 'Credenciais inválidas ou erro ao conectar com o servidor.';
      toast.error('Erro de Autenticação', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg text-text relative overflow-hidden px-4">
      {/* Soft gradients for premium Light Mode look */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/5 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[420px] bg-white border border-border p-8 rounded-2xl shadow-xl relative z-10 animate-in fade-in duration-300">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-primary to-primary-hover flex items-center justify-center shadow-lg shadow-primary/10 mb-4 animate-bounce">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold font-heading text-text">Prospix Admin</h2>
          <p className="text-xs text-text-secondary mt-1 text-center font-mono uppercase tracking-wider">
            Super-Admin Gate · Guilds
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">
              E-mail de Acesso
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary/60" />
              <Input
                type="email"
                placeholder="admin@guilds.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-sunken/40 border-border text-text pl-10 placeholder-text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm h-11"
                disabled={isLoading}
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">
              Chave Secreta
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary/60" />
              <Input
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-sunken/40 border-border text-text pl-10 placeholder-text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/10 text-sm h-11"
                disabled={isLoading}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary-hover text-white font-bold h-11 rounded-xl transition-all shadow-md shadow-primary/10 flex items-center justify-center gap-2"
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Autenticando...</span>
              </div>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Entrar no Console</span>
              </>
            )}
          </Button>
        </form>

        <div className="mt-8 text-center border-t border-border pt-4">
          <p className="text-[10px] text-text-muted font-mono">
            Conexão direta com privilégios de bypass RLS PostgreSQL ativo via backend role.
          </p>
        </div>
      </div>
    </div>
  );
}
