'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { apiClient } from '@/lib/api-client';
import { toast } from '@prospix/ui';

function LoginCallbackInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setErrorMessage('Token de acesso n├úo encontrado no link.');
      toast.error(
        'Token ausente',
        'Por favor, utilize o link completo enviado no seu WhatsApp.'
      );
      setTimeout(() => router.push('/login'), 3000);
      return;
    }

    const verifyToken = async () => {
      try {
        const response = await apiClient.get(`/auth/callback?token=${token}`);
        
        const { user } = response.data;
        
        // Save in Zustand
        setSession(user);
        
        setStatus('success');
        toast.success(
          'Acesso Autorizado!',
          `Ol├í, ${user.name}! Bem-vindo(a) de volta.`
        );
        
        // Redirect to main panel
        setTimeout(() => router.push('/inicio'), 1000);
      } catch (error: any) {
        setStatus('error');
        const message = error.response?.data?.message || 'Link m├ígico expirado, inv├ílido ou j├í utilizado.';
        setErrorMessage(message);
        toast.error('Erro na Autentica├º├úo', message);
        setTimeout(() => router.push('/login'), 4000);
      }
    };

    verifyToken();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router, setSession]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-50 relative overflow-hidden px-4">
      {/* Background lights */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[420px] bg-zinc-900/60 backdrop-blur-md border border-zinc-800 p-8 rounded-2xl shadow-2xl relative z-10 text-center space-y-6">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/20 mx-auto">
          <span className="font-heading text-xl font-bold text-white tracking-wider">P</span>
        </div>

        {status === 'verifying' && (
          <div className="space-y-4 animate-pulse">
            <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-zinc-100">Verificando Credenciais</h3>
              <p className="text-sm text-zinc-400">
                Processando seu token seguro de acesso ├║nico...
              </p>
            </div>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-zinc-100">Acesso Concedido</h3>
              <p className="text-sm text-zinc-400">
                Sua sess├úo foi ativada. Redirecionando para o painel...
              </p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-zinc-100">Falha no Acesso</h3>
              <p className="text-sm text-red-400 font-medium">
                {errorMessage}
              </p>
              <p className="text-xs text-zinc-500 pt-2">
                Redirecionando de volta ├á p├ígina de login...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    }>
      <LoginCallbackInner />
    </Suspense>
  );
}