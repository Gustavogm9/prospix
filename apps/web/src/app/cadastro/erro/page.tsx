'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@prospix/ui';

function InvitationErrorInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get('code') || 'PRSPX-XXXX-XXXX';
  const error = searchParams.get('error') || 'UNKNOWN_ERROR';

  const getErrorContent = () => {
    switch (error) {
      case 'INVITATION_USED':
        return {
          title: 'Código Já Utilizado',
          desc: 'Este código de convite único já foi resgatado para criar uma conta anteriormente.',
          action: 'Se você já concluiu seu cadastro, por favor, realize o login através do link de acesso ou utilize a página de login.',
        };
      case 'INVITATION_EXPIRED':
        return {
          title: 'Convite Expirado',
          desc: 'O período de validade deste convite gated expirou.',
          action: 'Os convites da plataforma possuem tempo de validade estrito por questões de segurança. Entre em contato com a equipe da Guilds para solicitar um novo convite.',
        };
      case 'INVITATION_REVOKED':
        return {
          title: 'Convite Revogado',
          desc: 'Este código de convite foi cancelado ou inativado pelo administrador.',
          action: 'Por favor, contate o owner do workspace ou o suporte da plataforma para mais informações.',
        };
      default:
        return {
          title: 'Convite Inválido',
          desc: 'Não encontramos nenhum convite atrelado a este código no nosso sistema.',
          action: 'Verifique se você digitou todos os caracteres corretamente. Lembre-se que o código deve seguir o padrão: PRSPX-XXXX-XXXX.',
        };
    }
  };

  const content = getErrorContent();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-zinc-950 text-zinc-50 relative overflow-hidden px-4">
      {/* Background lights */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-red-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-zinc-500/5 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[480px] bg-zinc-900/60 backdrop-blur-md border border-zinc-800 p-8 rounded-2xl shadow-2xl relative z-10 space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-bold font-heading text-zinc-100">{content.title}</h2>
            <p className="text-xs text-zinc-500 font-mono select-all uppercase">{code}</p>
          </div>

          <p className="text-sm text-zinc-400 leading-relaxed px-4">
            {content.desc}
          </p>
        </div>

        <div className="bg-zinc-950/80 p-4 border border-zinc-800/80 rounded-xl">
          <p className="text-xs text-zinc-400 leading-relaxed">
            {content.action}
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={() => router.push('/cadastro')}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/50 font-medium h-11 rounded-xl transition-all"
          >
            Tentar outro Código
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => router.push('/login')}
              variant="outline"
              className="w-full border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 font-medium h-11 rounded-xl transition-all"
            >
              Fazer Login
            </Button>
            <a
              href="https://wa.me/5511944556677?text=Preciso%20de%20ajuda%20com%20meu%20convite%20Prospix"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center w-full bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 font-medium h-11 rounded-xl transition-all text-sm"
            >
              Suporte Guilds
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvitationError() {
  return (
    <Suspense fallback={
      <div className="min-h-[100dvh] flex items-center justify-center bg-zinc-950">
        <div className="w-10 h-10 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
      </div>
    }>
      <InvitationErrorInner />
    </Suspense>
  );
}