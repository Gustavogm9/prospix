'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, toast } from '@prospix/ui';
import { useAdminAuthStore } from '@/store/admin-auth-store';
import { supabaseAdmin } from '@/lib/supabase';
import { ShieldCheck, Lock, Mail } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { setAdminSession } = useAdminAuthStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Campos vazios', 'Por favor, preencha todos os campos para autenticar.');
      return;
    }

    setIsLoading(true);

    try {
      const { data, error: authError } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw new Error(authError.message);
      }

      // Fetch user profile and verify admin role
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, name, email, role')
        .eq('id', data.user.id)
        .single();

      if (userError || !userData) {
        throw new Error('Não foi possível carregar os dados do usuário.');
      }

      if (userData.role !== 'GUILDS_ADMIN') {
        await supabaseAdmin.auth.signOut();
        throw new Error('Acesso negado. Apenas administradores GUILDS podem acessar este painel.');
      }

      // Persist admin user metadata in Zustand store
      setAdminSession({
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: userData.role as 'GUILDS_ADMIN',
      });

      toast.success('Acesso Autorizado', 'Conexão ativa com o banco de dados.');
      router.push('/admin');
    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message
        : 'Credenciais inválidas ou erro ao conectar com o servidor.';
      toast.error('Erro de Autenticação', message);
    } finally {
      setIsLoading(false);
    }
  };

  const EyeIcon = ({ open }: { open: boolean }) => open ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-50 relative overflow-hidden px-4">
      {/* Background gradients â€” same as broker login */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-amber-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-red-500/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[420px] bg-zinc-900/60 backdrop-blur-md border border-zinc-800 p-8 rounded-2xl shadow-2xl relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-amber-500 to-red-500 flex items-center justify-center shadow-lg shadow-amber-500/20 mb-4">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold font-heading text-zinc-50">Prospix Admin</h2>
          <p className="text-xs text-zinc-400 mt-1 text-center font-mono uppercase tracking-wider">
            Super-Admin Gate Â· Guilds
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
              E-mail de Acesso
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                type="email"
                placeholder="admin@guilds.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 pl-10 placeholder-zinc-500 focus-visible:bg-zinc-950/80 focus:border-amber-500/50 text-sm h-12"
                disabled={isLoading}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
              Chave Secreta
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 pl-10 pr-10 placeholder-zinc-500 focus-visible:bg-zinc-950/80 focus:border-amber-500/50 text-sm h-12"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 focus:outline-none"
                disabled={isLoading}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-amber-700 hover:bg-amber-600 text-white font-bold h-12 rounded-xl transition-all shadow-lg shadow-amber-600/10 flex items-center justify-center gap-2 mt-2"
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

        <div className="mt-8 text-center border-t border-zinc-800 pt-4">
          <p className="text-[10px] text-zinc-400 font-mono">
            ConexÃ£o direta com privilÃ©gios de bypass RLS PostgreSQL ativo via backend role.
          </p>
        </div>
      </div>
    </div>
  );
}
