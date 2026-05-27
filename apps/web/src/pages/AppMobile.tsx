import { useState } from 'react';
import { Smartphone, QrCode, Download, Info, Check, Mail } from 'lucide-react';

export default function AppMobile() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Smartphone className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>App Mobile Prospix.</strong> Acesse suas conversas, agenda e pipeline direto do celular. Receba notificações em tempo real quando um lead responder.</div>
      </div>

      {/* App preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#1B3A6B] to-[#E8981C] flex items-center justify-center shadow-lg">
                <Smartphone className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-[16px] font-semibold text-[#0F172A]">Prospix Mobile</div>
                <div className="text-[12px] text-[#94A3B8] flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[rgba(232,152,28,0.14)] text-[#A56B0A]">NOVO</span>
                  Em breve na App Store e Google Play
                </div>
              </div>
            </div>

            <div className="space-y-2.5 mb-5">
              {[
                { icon: '💬', title: 'Conversas ao vivo', desc: 'Acompanhe e assuma conversas direto do celular' },
                { icon: '📅', title: 'Agenda integrada', desc: 'Veja reuniões, confirme e marque resultados' },
                { icon: '🔔', title: 'Notificações push', desc: 'Receba alertas quando um lead pedir ligação' },
                { icon: '📊', title: 'Performance', desc: 'Acompanhe métricas e resultados em tempo real' },
                { icon: '🎯', title: 'Campanhas', desc: 'Pause, retome e acompanhe campanhas' },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-[#F9FAFB] border border-[#EEF0F3] rounded-lg hover:bg-[rgba(27,58,107,0.04)] transition-colors">
                  <span className="text-lg">{f.icon}</span>
                  <div>
                    <div className="text-[12.5px] font-semibold text-[#0F172A]">{f.title}</div>
                    <div className="text-[11px] text-[#475569]">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Waitlist form */}
          <div className="px-6 pb-6">
            {submitted ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-[#ECFDF3] border border-[rgba(3,152,85,0.2)] rounded-xl text-[12.5px] text-[#027A48]">
                <Check className="w-4 h-4 shrink-0" />
                <div><strong>Você está na lista!</strong> Avisaremos quando o app estiver disponível.</div>
              </div>
            ) : (
              <form onSubmit={handleWaitlist} className="flex gap-2">
                <div className="flex-1 relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Seu melhor e-mail"
                    className="w-full h-10 pl-9 pr-3 rounded-lg text-[12px] border border-[#E5E7EB] bg-white text-[#0F172A] placeholder-[#94A3B8] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                    required
                  />
                </div>
                <button type="submit" className="h-10 px-4 bg-[#1B3A6B] hover:bg-[#142C52] text-white text-[12px] font-semibold rounded-lg flex items-center gap-2 transition-all hover:-translate-y-0.5 shadow-sm">
                  <Download className="w-4 h-4" />
                  Entrar na lista
                </button>
              </form>
            )}
          </div>
        </div>

        {/* QR Code */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="w-48 h-48 bg-[#F1F3F6] border border-[#E5E7EB] rounded-2xl flex items-center justify-center mb-4 relative overflow-hidden">
            <QrCode className="w-24 h-24 text-[#94A3B8]" />
            <div className="absolute inset-0 bg-gradient-to-t from-white/80 to-transparent flex items-end justify-center pb-3">
              <span className="text-[10px] font-semibold text-[#1B3A6B] bg-white px-2 py-0.5 rounded-full border border-[#E5E7EB]">Em breve</span>
            </div>
          </div>
          <div className="text-[14px] font-semibold text-[#0F172A] mb-1">Escaneie para acessar</div>
          <div className="text-[12px] text-[#475569] max-w-xs leading-relaxed">Aponte a câmera do celular para acessar a versão web otimizada para mobile enquanto o app nativo não está disponível.</div>
          <a href="https://prospix.com.br" target="_blank" rel="noopener noreferrer" className="mt-4 text-[11px] text-[#1B3A6B] font-semibold hover:underline">prospix.com.br/app ↗</a>
          
          {/* Platform badges */}
          <div className="flex items-center gap-3 mt-5">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F172A] rounded-lg text-white">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
              <span className="text-[10px] font-medium">App Store</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F172A] rounded-lg text-white">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.807 1.626a1 1 0 010 1.732l-2.807 1.626L15.206 12l2.492-2.492zM5.864 2.658L16.8 8.99l-2.302 2.302-8.635-8.635z"/></svg>
              <span className="text-[10px] font-medium">Google Play</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(27,58,107,0.04)] rounded-lg text-[12px] text-[#475569]">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div>O app mobile está em desenvolvimento e será lançado em breve. Enquanto isso, você pode acessar o painel pelo navegador do celular.</div>
      </div>
    </div>
  );
}
