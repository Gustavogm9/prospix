'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input, toast } from '@prospix/ui';


function SignupDetailsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get('code') || '';
  const tenantName = searchParams.get('tenantName') || '';
  const role = searchParams.get('role') || '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [susep, setSusep] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Auto redirect if page is accessed without active invite verification state
  useEffect(() => {
    if (!code || !tenantName) {
      toast.error(
        'Acesso inválido',
        'Por favor, insira e valide um código de convite antes de preencher os dados.'
      );
      router.push('/cadastro');
    }
  }, [code, tenantName, router]);

  // Handle WhatsApp masking
  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 0 && !value.startsWith('55') && value.length >= 10) {
      value = '55' + value;
    }

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

    if (!name.trim()) {
      toast.error('Nome obrigatório', 'Por favor, informe seu nome completo.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      toast.error('E-mail inválido', 'Por favor, informe um e-mail válido.');
      return;
    }
    
    const rawWhatsapp = getRawWhatsapp(whatsapp);
    if (rawWhatsapp.length < 12) {
      toast.error('WhatsApp inválido', 'Por favor, informe um WhatsApp válido com DDI e DDD.');
      return;
    }

    if (!password) {
      toast.error('Senha obrigatória', 'Por favor, defina uma senha para sua conta.');
      return;
    }

    if (password.length < 6) {
      toast.error('Senha fraca', 'A senha deve conter pelo menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Senhas não coincidem', 'A senha e a confirmação de senha estão diferentes.');
      return;
    }

    if (!acceptTerms) {
      toast.error('Termos de Serviço', 'Você precisa aceitar os termos de serviço e a política de privacidade.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/invitations/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          user: {
            name,
            email,
            whatsapp: rawWhatsapp,
            susep: susep.trim() || null,
            city: city.trim() || null,
            password,
          },
          accept_terms: acceptTerms,
        }),
      });

      if (res.status === 201 || res.ok) {
        setIsSuccess(true);
        toast.success('Cadastro Concluído!', 'Conta criada e ativada com sucesso.');
      } else {
        const json = await res.json();
        toast.error(
          'Erro no cadastro',
          json?.message || 'Não foi possível concluir seu cadastro. Fale com o suporte.'
        );
      }
    } catch (_error: any) {
      toast.error(
        'Erro no cadastro',
        'Não foi possível concluir seu cadastro. Fale com o suporte.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="auth-dark min-h-[100dvh] flex items-center justify-center bg-bg text-text relative overflow-hidden px-4">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
        
        <div className="w-full max-w-[460px] bg-surface backdrop-blur-md border border-border p-8 rounded-2xl shadow-2xl relative z-10 text-center space-y-6 animate-fadeIn">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold font-heading text-text">Cadastro Concluído!</h2>
            <p className="text-sm text-text-secondary px-6">
              Sua conta de <span className="text-text font-semibold">{role === 'OWNER' ? 'Proprietário' : 'Assistente'}</span> foi criada com sucesso no workspace da <span className="text-blue-400 font-semibold">{tenantName}</span>.
            </p>
          </div>

          <p className="text-sm text-text-secondary bg-[var(--surface-sunken)] p-4 border border-border rounded-xl leading-relaxed">
            Sua conta está ativada! Você já pode fazer login utilizando seu e-mail <span className="text-text font-semibold font-mono">{email}</span> e a senha cadastrada.
          </p>

          <Button
            onClick={() => router.push('/login')}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-12 rounded-xl transition-all shadow-lg shadow-blue-600/10 mt-4"
          >
            Acessar com E-mail e Senha
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-dark min-h-[100dvh] flex items-center justify-center bg-bg text-text relative overflow-hidden py-12 px-4">
      {/* Lights */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-500/10 blur-[100px] pointer-events-none" />

      <div className="w-full max-w-[500px] bg-surface backdrop-blur-md border border-border p-8 rounded-2xl shadow-2xl relative z-10">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-blue-400 text-xs font-mono font-semibold uppercase tracking-wider mb-2">
            <span>Convite Válido</span>
            <span className="h-1 w-1 rounded-full bg-blue-400" />
            <span className="text-text-muted">{code}</span>
          </div>
          <h2 className="text-xl font-bold font-heading text-text">Complete seu Cadastro</h2>
          <p className="text-xs text-text-secondary mt-1">
            Você está se juntando à corretora <strong className="text-text">{tenantName}</strong> como <span className="text-blue-400 font-semibold">{role === 'OWNER' ? 'Proprietário' : 'Assistente'}</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                Nome Completo
              </label>
              <Input
                type="text"
                placeholder="Ex: Gustavo Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted h-11 focus:border-blue-500/50"
                disabled={isLoading}
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                E-mail Profissional
              </label>
              <Input
                type="email"
                placeholder="Ex: gustavo@corretora.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted h-11 focus:border-blue-500/50"
                disabled={isLoading}
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                WhatsApp de Trabalho
              </label>
              <Input
                type="text"
                placeholder="+55 (11) 99999-9999"
                value={whatsapp}
                onChange={handleWhatsappChange}
                className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted h-11 focus:border-blue-500/50"
                disabled={isLoading}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1 flex items-center justify-between">
                  <span>SUSEP</span>
                  <span className="text-[10px] text-text-muted font-normal">Opcional</span>
                </label>
                <Input
                  type="text"
                  placeholder="Código SUSEP"
                  value={susep}
                  onChange={(e) => setSusep(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted h-11 focus:border-blue-500/50"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1 flex items-center justify-between">
                  <span>Cidade / UF</span>
                  <span className="text-[10px] text-text-muted font-normal">Opcional</span>
                </label>
                <Input
                  type="text"
                  placeholder="Ex: São Paulo - SP"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted h-11 focus:border-blue-500/50"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                  Senha de Acesso
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Mín. 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted h-11 focus:border-blue-500/50 pr-10"
                    disabled={isLoading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 focus:outline-none"
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                  Confirmar Senha
                </label>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border-border text-text placeholder-text-muted h-11 focus:border-blue-500/50"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-start gap-3 cursor-pointer group select-none">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-1 rounded bg-bg border-border text-blue-600 focus:ring-blue-500/30"
                disabled={isLoading}
              />
              <span className="text-xs text-text-secondary group-hover:text-text leading-relaxed">
                Estou ciente e aceito os{' '}
                <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  Termos de Uso
                </a>{' '}
                e a{' '}
                <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  Política de Privacidade
                </a>{' '}
                da Prospix, incluindo o tratamento de dados segundo as diretrizes da LGPD.
              </span>
            </label>
          </div>

          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-12 rounded-xl transition-all shadow-lg shadow-blue-600/10 mt-6"
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Criando sua conta...</span>
              </div>
            ) : (
              'Concluir Onboarding & Ativar Conta'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function SignupDetails() {
  return (
    <Suspense fallback={
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg">
        <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    }>
      <SignupDetailsInner />
    </Suspense>
  );
}