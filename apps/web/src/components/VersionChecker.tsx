'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { SERVICE_WORKER_UPDATE_EVENT } from '@/components/ServiceWorkerRegistrar';

export function VersionChecker() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const handleServiceWorkerUpdate = () => {
      setClosed(false);
      setHasUpdate(true);
    };

    window.addEventListener(SERVICE_WORKER_UPDATE_EVENT, handleServiceWorkerUpdate);

    // Only run in production (Vercel provides this automatically)
    const currentVersion = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    if (!currentVersion) {
      return () => {
        window.removeEventListener(SERVICE_WORKER_UPDATE_EVENT, handleServiceWorkerUpdate);
      };
    }

    // Check for updates every 1 minute
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.version && data.version !== 'dev' && data.version !== currentVersion) {
            setHasUpdate(true);
            clearInterval(interval);
          }
        }
      } catch {
        // Ignore network errors
      }
    }, 60000);

    return () => {
      clearInterval(interval);
      window.removeEventListener(SERVICE_WORKER_UPDATE_EVENT, handleServiceWorkerUpdate);
    };
  }, []);

  const applyUpdate = async () => {
    if (!('serviceWorker' in navigator)) {
      window.location.reload();
      return;
    }

    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration?.waiting) {
      window.location.reload();
      return;
    }

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    );
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  if (!hasUpdate || closed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] bg-white border border-[#E5E7EB] shadow-2xl rounded-xl p-4 sm:p-5 max-w-[340px] w-[calc(100vw-32px)] flex items-start gap-4 animate-slideIn">
      <div className="w-10 h-10 bg-[#EFF6FF] rounded-full flex items-center justify-center shrink-0 mt-0.5">
        <RefreshCw className="w-5 h-5 text-[#1B3A6B]" />
      </div>
      <div className="flex-1">
        <div className="flex items-start justify-between mb-1">
          <h4 className="text-[14px] font-bold text-[#0F172A]">Nova atualização</h4>
          <button 
            onClick={() => setClosed(true)}
            aria-label="Fechar aviso de atualização"
            className="-mr-3 -mt-3 flex min-h-11 min-w-11 items-center justify-center text-[#64748B] transition-colors hover:text-[#334155] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[12px] text-[#475569] leading-relaxed mb-4">
          O sistema recebeu uma nova versão com melhorias. Recarregue a página para continuar usando com estabilidade.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void applyUpdate()}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1B3A6B] px-3 py-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#142C52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] focus-visible:ring-offset-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar agora
          </button>
        </div>
      </div>
    </div>
  );
}
