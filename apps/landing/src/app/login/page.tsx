'use client';

import { useEffect } from 'react';

export default function LoginPageRedirect() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_LOGIN_URL) {
      window.location.replace(process.env.NEXT_PUBLIC_LOGIN_URL);
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-zinc-800">
      <div className="text-center">
        {process.env.NEXT_PUBLIC_LOGIN_URL ? (
          <>
            <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-sm text-zinc-500">Redirecionando para a Central do Corretor...</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-zinc-900">Central do Corretor indisponível neste ambiente</h1>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              Configure NEXT_PUBLIC_LOGIN_URL para apontar esta landing para o app web auditado.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
