'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="min-h-[100dvh] bg-zinc-950 text-zinc-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900/80 border border-zinc-800 p-8 rounded-2xl text-center space-y-4">
          <div className="h-14 w-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <svg className="h-7 w-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold font-heading">Algo deu errado</h2>
          <p className="text-sm text-zinc-400">
            Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte.
          </p>
          {error.digest && (
            <p className="text-[10px] text-zinc-500 font-mono">Ref: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
