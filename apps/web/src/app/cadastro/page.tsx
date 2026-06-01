'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, toast } from '@prospix/ui';
import { apiClient } from '@/lib/api-client';

export default function SignupCode() {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  // Format code to PRSPX-XXXX-XXXX automatically
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Constrain to maximum possible length of characters
    if (value.length > 13) {
      value = value.substring(0, 13);
    }

    let formatted = '';
    if (value.startsWith('PRSPX')) {
      formatted = 'PRSPX';
      const remainder = value.substring(5);
      if (remainder.length > 0) {
        formatted += '-' + remainder.substring(0, 4);
      }
      if (remainder.length > 4) {
        formatted += '-' + remainder.substring(4, 8);
      }
    } else {
      // If user typed something else, build format anyway as best as possible
      formatted = value;
      if (formatted.length > 5) {
        formatted = formatted.substring(0, 5) + '-' + formatted.substring(5);
      }
      if (formatted.length > 10) {
        formatted = formatted.substring(0, 10) + '-' + formatted.substring(10);
      }
    }

    setCode(formatted);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check pattern PRSPX-XXXX-XXXX
    const pattern = /^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!pattern.test(code)) {
      toast.error(
        'C├│digo inv├ílido',
        'Por favor, insira o c├│digo no formato correto: PRSPX-XXXX-XXXX.'
      );
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/invitations/verify', { code });
      
      const { tenant_name, role } = response.data.data;
      toast.success(
        'Convite verificado!',
        `Bem-vindo ao workspace da ${tenant_name}.`
      );

      // Navigate to details page with verified data via query params
      const params = new URLSearchParams({ code, tenantName: tenant_name, role });
      router.push(`/cadastro/detalhes?${params.toString()}`);
    } catch (error: any) {
      const errorType = error.response?.data?.error;
      const message = error.response?.data?.message || 'Código expirado ou inválido.';
      
      // Navigate to dedicated error page
      const params = new URLSearchParams({ code, error: errorType || 'unknown', message });
      router.push(`/cadastro/erro?${params.toString()}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-dark min-h-screen flex items-center justify-center bg-bg text-text relative overflow-hidden px-4">
      {/* Visual background lights */}
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[440px] bg-surface backdrop-blur-md border border-border p-8 rounded-2xl shadow-2xl relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <span className="font-heading text-xl font-bold text-white tracking-wider">P</span>
          </div>
          <h2 className="text-2xl font-bold font-heading text-text">Resgatar Convite</h2>
          <p className="text-sm text-text-secondary mt-1 text-center">
            A Prospix ├® uma plataforma exclusiva para corretores credenciados. Digite seu c├│digo para ingressar.
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-2">
              C├│digo de Convite Gated
            </label>
            <Input
              type="text"
              placeholder="PRSPX-XXXX-XXXX"
              value={code}
              onChange={handleCodeChange}
              className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted text-center font-mono text-lg tracking-widest h-12 focus:border-blue-500/50"
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
                <span>Validando...</span>
              </div>
            ) : (
              'Verificar C├│digo'
            )}
          </Button>
        </form>

        <div className="mt-8 text-center pt-4 border-t border-border-subtle">
          <p className="text-xs text-text-muted">
            J├í possui acesso cadastrado?{' '}
            <button
              onClick={() => router.push('/login')}
              className="text-blue-400 hover:text-blue-300 font-semibold"
            >
              Fazer Login
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}