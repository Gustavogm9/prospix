'use client';

import { useState, useEffect } from 'react';
import { Smartphone, Download, Check, Share2, Plus, ArrowDown, Monitor, Wifi } from 'lucide-react';

function useIsPWA() {
  const [isPWA, setIsPWA] = useState(false);
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    setIsPWA(isStandalone);
  }, []);
  return isPWA;
}

function useIsIOS() {
  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
  }, []);
  return isIOS;
}

export default function AppMobile() {
  const isPWA = useIsPWA();
  const isIOS = useIsIOS();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') setInstalled(true);
      setDeferredPrompt(null);
    }
  };

  if (isPWA || installed) {
    return (
      <div className="space-y-5 animate-fadeIn">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#039855] to-[#027A48] flex items-center justify-center shadow-lg mb-4">
            <Check className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-[18px] font-bold text-[#0F172A] mb-2">App instalado! 🎉</h2>
          <p className="text-[13px] text-[#475569] max-w-sm leading-relaxed">
            Você já está usando o Prospix como app. Todas as funcionalidades estão disponíveis direto do seu celular.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-6 w-full max-w-xs">
            {[
              { icon: '💬', label: 'Conversas ao vivo' },
              { icon: '📅', label: 'Agenda integrada' },
              { icon: '🔔', label: 'Notificações' },
              { icon: '📊', label: 'Performance' },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5 bg-[#ECFDF3] border border-[rgba(3,152,85,0.15)] rounded-lg text-[11px] font-medium text-[#027A48]">
                <span>{f.icon}</span>
                {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Smartphone className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>App Mobile Prospix.</strong> Instale o Prospix no seu celular como um app nativo — sem precisar baixar da loja.</div>
      </div>

      {/* Features */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {[
          { icon: '💬', title: 'Conversas', desc: 'Chat ao vivo' },
          { icon: '📅', title: 'Agenda', desc: 'Reuniões e follow-up' },
          { icon: '🔔', title: 'Push', desc: 'Alertas instantâneos' },
          { icon: '📊', title: 'Métricas', desc: 'Performance real' },
          { icon: '🎯', title: 'Pipeline', desc: 'CRM completo' },
        ].map((f, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-3 bg-white border border-[#E5E7EB] rounded-xl shadow-sm">
            <span className="text-lg">{f.icon}</span>
            <div>
              <div className="text-[12px] font-semibold text-[#0F172A]">{f.title}</div>
              <div className="text-[10px] text-[#64748B]">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Install Instructions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Chrome / Android */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#EEF0F3] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1B3A6B] flex items-center justify-center">
              <Monitor className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[#0F172A]">Chrome / Android</div>
              <div className="text-[11px] text-[#64748B]">Instale em 2 cliques</div>
            </div>
          </div>
          <div className="p-5 space-y-3">
            {deferredPrompt ? (
              <button
                onClick={handleInstall}
                className="w-full h-12 bg-[#1B3A6B] hover:bg-[#142C52] text-white text-[13px] font-semibold rounded-xl flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 shadow-md"
              >
                <Download className="w-4 h-4" />
                Instalar Prospix agora
              </button>
            ) : (
              <div className="space-y-2.5">
                {[
                  { step: '1', icon: <Monitor className="w-3.5 h-3.5" />, text: 'Abra app.prospix.com.br no Chrome' },
                  { step: '2', icon: <ArrowDown className="w-3.5 h-3.5" />, text: 'Toque no menu ⋮ (3 pontos) no canto superior' },
                  { step: '3', icon: <Plus className="w-3.5 h-3.5" />, text: 'Toque em "Instalar aplicativo" ou "Adicionar à tela inicial"' },
                  { step: '4', icon: <Check className="w-3.5 h-3.5" />, text: 'Confirme e pronto! O ícone aparecerá na sua tela' },
                ].map(s => (
                  <div key={s.step} className="flex items-center gap-3 px-3 py-2.5 bg-[#F9FAFB] border border-[#EEF0F3] rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center justify-center text-[11px] font-bold shrink-0">{s.step}</div>
                    <div className="text-[12px] text-[#0F172A] flex items-center gap-1.5">{s.icon} {s.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* iOS / Safari */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#EEF0F3] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F172A] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[#0F172A]">iPhone / iPad</div>
              <div className="text-[11px] text-[#64748B]">Use o Safari para instalar</div>
            </div>
          </div>
          <div className="p-5 space-y-2.5">
            {[
              { step: '1', icon: <Monitor className="w-3.5 h-3.5" />, text: 'Abra app.prospix.com.br no Safari' },
              { step: '2', icon: <Share2 className="w-3.5 h-3.5" />, text: 'Toque no botão Compartilhar (□↑) na barra inferior' },
              { step: '3', icon: <Plus className="w-3.5 h-3.5" />, text: 'Role para baixo e toque em "Adicionar à Tela de Início"' },
              { step: '4', icon: <Check className="w-3.5 h-3.5" />, text: 'Toque "Adicionar" e o app aparecerá como ícone' },
            ].map(s => (
              <div key={s.step} className="flex items-center gap-3 px-3 py-2.5 bg-[#F9FAFB] border border-[#EEF0F3] rounded-lg">
                <div className="w-7 h-7 rounded-full bg-[rgba(15,23,42,0.08)] text-[#0F172A] flex items-center justify-center text-[11px] font-bold shrink-0">{s.step}</div>
                <div className="text-[12px] text-[#0F172A] flex items-center gap-1.5">{s.icon} {s.text}</div>
              </div>
            ))}
            {isIOS && (
              <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-[rgba(232,152,28,0.08)] border border-[rgba(232,152,28,0.2)] rounded-lg text-[11px] text-[#A56B0A]">
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span><strong>Dica:</strong> No iPhone, só funciona pelo Safari. Chrome/Firefox no iOS não suportam PWA.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Benefits */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#ECFDF3] border border-[rgba(3,152,85,0.15)] rounded-xl text-[12px] text-[#027A48]">
        <Wifi className="w-4 h-4 shrink-0" />
        <div><strong>Funciona offline!</strong> Após instalar, o app carrega mesmo sem internet e sincroniza quando voltar online.</div>
      </div>
    </div>
  );
}
