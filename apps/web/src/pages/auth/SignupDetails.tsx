import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, toast } from '@prospix/ui';
import { apiClient } from '../../lib/api-client';

export default function SignupDetails() {
  const location = useLocation();
  const navigate = useNavigate();
  const { code, tenantName, role } = location.state || {};

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [susep, setSusep] = useState('');
  const [city, setCity] = useState('');
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
      navigate('/cadastro');
    }
  }, [code, tenantName, navigate]);

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

    if (!acceptTerms) {
      toast.error('Termos de Serviço', 'Você precisa aceitar os termos de serviço e a política de privacidade.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/invitations/redeem', {
        code,
        user: {
          name,
          email,
          whatsapp: rawWhatsapp,
          susep: susep.trim() || null,
          city: city.trim() || null,
        },
        accept_terms: acceptTerms,
      });

      if (response.status === 201) {
        setIsSuccess(true);
        toast.success('Cadastro Concluído!', 'Conta criada e ativada com sucesso.');
      }
    } catch (error: any) {
      toast.error(
        'Erro no cadastro',
        error.response?.data?.message || 'Não foi possível concluir seu cadastro. Fale com o suporte.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-50 relative overflow-hidden px-4">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
        
        <div className="w-full max-w-[460px] bg-zinc-900/60 backdrop-blur-md border border-zinc-800 p-8 rounded-2xl shadow-2xl relative z-10 text-center space-y-6 animate-fadeIn">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold font-heading text-zinc-100">Cadastro Concluído!</h2>
            <p className="text-sm text-zinc-400 px-6">
              Sua conta de <span className="text-zinc-200 font-semibold">{role === 'OWNER' ? 'Proprietário' : 'Assistente'}</span> foi criada com sucesso no workspace da <span className="text-blue-400 font-semibold">{tenantName}</span>.
            </p>
          </div>

          <p className="text-sm text-zinc-400 bg-zinc-950/60 p-4 border border-zinc-800/80 rounded-xl leading-relaxed">
            Enviamos o seu **primeiro link mágico de acesso** no WhatsApp <span className="text-zinc-200 font-semibold font-mono">{whatsapp}</span>. Abra o aplicativo e clique no link para realizar o primeiro login!
          </p>

          <Button
            onClick={() => navigate('/login')}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-12 rounded-xl transition-all shadow-lg shadow-blue-600/10 mt-4"
          >
            Ir para o Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-50 relative overflow-hidden py-12 px-4">
      {/* Lights */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-500/10 blur-[100px] pointer-events-none" />

      <div className="w-full max-w-[500px] bg-zinc-900/60 backdrop-blur-md border border-zinc-800 p-8 rounded-2xl shadow-2xl relative z-10">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-blue-400 text-xs font-mono font-semibold uppercase tracking-wider mb-2">
            <span>Convite Válido</span>
            <span className="h-1 w-1 rounded-full bg-blue-400" />
            <span className="text-zinc-500">{code}</span>
          </div>
          <h2 className="text-xl font-bold font-heading text-zinc-50">Complete seu Cadastro</h2>
          <p className="text-xs text-zinc-400 mt-1">
            Você está se juntando à corretora <strong className="text-zinc-200">{tenantName}</strong> como <span className="text-blue-400 font-semibold">{role === 'OWNER' ? 'Proprietário' : 'Assistente'}</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                Nome Completo
              </label>
              <Input
                type="text"
                placeholder="Ex: Gustavo Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-700 h-11 focus:border-blue-500/50"
                disabled={isLoading}
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                E-mail Profissional
              </label>
              <Input
                type="email"
                placeholder="Ex: gustavo@corretora.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-700 h-11 focus:border-blue-500/50"
                disabled={isLoading}
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
                WhatsApp de Trabalho
              </label>
              <Input
                type="text"
                placeholder="+55 (11) 99999-9999"
                value={whatsapp}
                onChange={handleWhatsappChange}
                className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-700 h-11 focus:border-blue-500/50"
                disabled={isLoading}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1 flex items-center justify-between">
                  <span>SUSEP</span>
                  <span className="text-[10px] text-zinc-500 font-normal">Opcional</span>
                </label>
                <Input
                  type="text"
                  placeholder="Código SUSEP"
                  value={susep}
                  onChange={(e) => setSusep(e.target.value)}
                  className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-700 h-11 focus:border-blue-500/50"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1 flex items-center justify-between">
                  <span>Cidade / UF</span>
                  <span className="text-[10px] text-zinc-500 font-normal">Opcional</span>
                </label>
                <Input
                  type="text"
                  placeholder="Ex: São Paulo - SP"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-zinc-950/80 border-zinc-800 text-zinc-100 placeholder-zinc-700 h-11 focus:border-blue-500/50"
                  disabled={isLoading}
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
                className="mt-1 rounded bg-zinc-950 border-zinc-800 text-blue-600 focus:ring-blue-500/30"
                disabled={isLoading}
              />
              <span className="text-xs text-zinc-400 group-hover:text-zinc-300 leading-relaxed">
                Estou ciente e aceito os{' '}
                <a href="/termos" target="_blank" className="text-blue-400 hover:underline">
                  Termos de Uso
                </a>{' '}
                e a{' '}
                <a href="/privacidade" target="_blank" className="text-blue-400 hover:underline">
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
