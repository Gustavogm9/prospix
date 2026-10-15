'use client';

import { useEffect } from 'react';

export const SERVICE_WORKER_UPDATE_EVENT = 'prospix:service-worker-update';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let disposed = false;
    let updateTimer: ReturnType<typeof setInterval> | undefined;
    let registration: ServiceWorkerRegistration | undefined;

    const announceUpdate = () => {
      if (!disposed && registration?.waiting) {
        window.dispatchEvent(new Event(SERVICE_WORKER_UPDATE_EVENT));
      }
    };

    const checkForUpdate = () => {
      void registration?.update().catch(() => {
        // A ausência de rede não deve interromper o uso da versão instalada.
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registeredWorker) => {
        if (disposed) return;

        registration = registeredWorker;
        announceUpdate();

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration?.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', () => {
            if (
              installingWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              announceUpdate();
            }
          });
        });

        updateTimer = setInterval(checkForUpdate, 5 * 60 * 1000);
        document.addEventListener('visibilitychange', handleVisibilityChange);
      })
      .catch(() => {
        // O app continua disponível no navegador quando o registro não é suportado.
      });

    return () => {
      disposed = true;
      if (updateTimer) clearInterval(updateTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}
