'use client';

import { useEffect } from 'react';

export default function LoginPageRedirect() {
  useEffect(() => {
    window.location.replace('https://web-drab-chi-76.vercel.app/login');
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-zinc-800">
      <div className="text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm text-zinc-500">Redirecionando para a Central do Corretor...</p>
      </div>
    </div>
  );
}
